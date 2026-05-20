"""
Cross-platform tests for platform_utils.

Path resolution + dialog/log fallback paths run on every host. The
LaunchAgent plist tests run on macOS only (they don't need launchctl
to actually fire — we mock subprocess and verify the plist content).
Windows registry tests run on Windows only via the existing
test_startup_registration suite.

Run from agent/:
    PYTHONPATH=src python -m unittest tests.test_platform_utils -v
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import platform_utils  # noqa: E402


# =============================================================================
# detect_platform — runs on every host
# =============================================================================

class DetectPlatformTests(unittest.TestCase):
    def test_returns_windows_for_win32(self):
        with mock.patch.object(sys, "platform", "win32"):
            self.assertEqual(platform_utils.detect_platform(), "windows")

    def test_returns_mac_for_darwin(self):
        with mock.patch.object(sys, "platform", "darwin"):
            self.assertEqual(platform_utils.detect_platform(), "mac")

    def test_returns_linux_for_anything_else(self):
        for value in ("linux", "linux2", "freebsd", "aix"):
            with mock.patch.object(sys, "platform", value):
                self.assertEqual(platform_utils.detect_platform(), "linux")


# =============================================================================
# Path resolvers
# =============================================================================

class PathResolverTests(unittest.TestCase):
    def test_windows_config_dir_uses_appdata(self):
        with mock.patch.object(sys, "platform", "win32"), \
             mock.patch.dict(os.environ, {"APPDATA": r"C:\Users\test\AppData\Roaming"}):
            p = platform_utils.get_config_dir()
            self.assertEqual(p, Path(r"C:\Users\test\AppData\Roaming") / "Groundwork")

    def test_mac_config_dir_under_application_support(self):
        with mock.patch.object(sys, "platform", "darwin"):
            p = platform_utils.get_config_dir()
            expected = Path.home() / "Library" / "Application Support" / "Groundwork"
            self.assertEqual(p, expected)

    def test_linux_config_dir_honors_xdg(self):
        with mock.patch.object(sys, "platform", "linux"), \
             mock.patch.dict(os.environ, {"XDG_CONFIG_HOME": "/custom/xdg"}, clear=False):
            p = platform_utils.get_config_dir()
            self.assertEqual(p, Path("/custom/xdg") / "groundwork")

    def test_linux_config_dir_falls_back_to_dotconfig(self):
        with mock.patch.object(sys, "platform", "linux"), \
             mock.patch.dict(os.environ, {}, clear=True):
            p = platform_utils.get_config_dir()
            self.assertEqual(p, Path.home() / ".config" / "groundwork")

    def test_log_queue_runtime_paths_derive_from_config(self):
        # Whatever platform we're on, log/queue/runtime should all sit
        # under config_dir.
        cfg = platform_utils.get_config_dir()
        self.assertEqual(platform_utils.get_log_path().parent, cfg)
        self.assertEqual(platform_utils.get_queue_path().parent, cfg)
        self.assertEqual(platform_utils.get_runtime_dir().parent, cfg)

    def test_fallback_error_log_path_windows(self):
        with mock.patch.object(sys, "platform", "win32"):
            self.assertEqual(
                platform_utils.get_fallback_error_log_path(),
                Path("C:/Users/Public/Groundwork-error.log"),
            )

    def test_fallback_error_log_path_mac(self):
        with mock.patch.object(sys, "platform", "darwin"):
            self.assertEqual(
                platform_utils.get_fallback_error_log_path(),
                Path("/tmp/Groundwork-error.log"),
            )


# =============================================================================
# Fallback error log writer
# =============================================================================

class FallbackErrorLogTests(unittest.TestCase):
    def test_write_succeeds_in_normal_environment(self):
        with tempfile.NamedTemporaryFile(suffix="-fallback.log", delete=False) as f:
            tmp = Path(f.name)
        try:
            # Redirect the fallback path to our tempfile so we don't
            # actually pollute /tmp/Groundwork-error.log on dev machines.
            with mock.patch.object(
                platform_utils, "get_fallback_error_log_path", return_value=tmp
            ):
                ok = platform_utils.write_fallback_error_log("test message line")
                self.assertTrue(ok)
                contents = tmp.read_text(encoding="utf-8")
                self.assertIn("test message line", contents)
        finally:
            if tmp.exists():
                tmp.unlink()

    def test_write_returns_false_on_unwritable_path(self):
        with mock.patch.object(
            platform_utils,
            "get_fallback_error_log_path",
            return_value=Path("/nonexistent-dir-that-cant-exist/x.log"),
        ):
            ok = platform_utils.write_fallback_error_log("test")
            self.assertFalse(ok)


# =============================================================================
# Dialog — best-effort, swallows its own errors
# =============================================================================

class FatalDialogTests(unittest.TestCase):
    def test_non_existent_dialog_tools_dont_raise(self):
        """On Linux without zenity/notify-send, dialog should return
        False but not raise. On Mac/Windows the call hits osascript /
        MessageBoxW respectively — we don't actually want a popup
        during tests, so we mock subprocess.run / ctypes."""
        with mock.patch.object(platform_utils.subprocess, "run") as run_mock:
            run_mock.side_effect = FileNotFoundError("zenity not installed")
            with mock.patch.object(sys, "platform", "linux"):
                result = platform_utils.show_fatal_dialog("title", "msg")
                self.assertFalse(result)

    def test_mac_dialog_escapes_quotes_in_message(self):
        """AppleScript string literals don't allow unescaped double
        quotes — verify the helper escapes them so a quote in the error
        message doesn't break the script."""
        captured_args = []
        def fake_run(args, **kwargs):
            captured_args.append(args)
            import subprocess as sp
            return sp.CompletedProcess(args, returncode=0, stdout=b"", stderr=b"")
        with mock.patch.object(platform_utils.subprocess, "run", side_effect=fake_run), \
             mock.patch.object(sys, "platform", "darwin"):
            platform_utils.show_fatal_dialog("Title", 'Error: "DLL not found"')
            self.assertEqual(len(captured_args), 1)
            args = captured_args[0]
            self.assertEqual(args[0], "osascript")
            # The quote inside the message should be escaped before reaching
            # osascript — \" inside the AppleScript string literal.
            script = args[2]
            self.assertIn('\\"DLL not found\\"', script)


# =============================================================================
# install_to_startup — Mac path
# =============================================================================

@unittest.skipUnless(sys.platform == "darwin", "Mac LaunchAgent paths only")
class MacStartupTests(unittest.TestCase):
    """Verify LaunchAgent plist generation + idempotent install/uninstall
    on the real Mac. We mock launchctl so the tests don't actually
    register a real agent."""

    def setUp(self):
        self.tmp_home = tempfile.mkdtemp(prefix="gw-mac-startup-")
        self._old_home = os.environ.get("HOME")
        os.environ["HOME"] = self.tmp_home

    def tearDown(self):
        if self._old_home is not None:
            os.environ["HOME"] = self._old_home
        import shutil
        shutil.rmtree(self.tmp_home, ignore_errors=True)

    def test_install_writes_plist_under_launchagents(self):
        fake_exe = "/Applications/Groundwork.app/Contents/MacOS/Groundwork"
        with mock.patch.object(platform_utils.subprocess, "run") as run_mock:
            import subprocess as sp
            run_mock.return_value = sp.CompletedProcess(
                args=[], returncode=0, stdout=b"", stderr=b""
            )
            ok = platform_utils._install_startup_mac(fake_exe)
        self.assertTrue(ok)
        plist_path = (
            Path(self.tmp_home) / "Library" / "LaunchAgents" /
            "com.groundwork.agent.plist"
        )
        self.assertTrue(plist_path.exists())
        content = plist_path.read_text(encoding="utf-8")
        self.assertIn("com.groundwork.agent", content)
        self.assertIn(fake_exe, content)
        self.assertIn("<key>RunAtLoad</key>", content)
        self.assertIn("<true/>", content)

    def test_install_is_idempotent(self):
        fake_exe = "/tmp/fake-groundwork"
        with mock.patch.object(platform_utils.subprocess, "run") as run_mock:
            import subprocess as sp
            run_mock.return_value = sp.CompletedProcess(
                args=[], returncode=0, stdout=b"", stderr=b""
            )
            ok1 = platform_utils._install_startup_mac(fake_exe)
            ok2 = platform_utils._install_startup_mac(fake_exe)
        self.assertTrue(ok1)
        self.assertTrue(ok2)

    def test_uninstall_removes_plist(self):
        fake_exe = "/tmp/fake-groundwork"
        with mock.patch.object(platform_utils.subprocess, "run") as run_mock:
            import subprocess as sp
            run_mock.return_value = sp.CompletedProcess(
                args=[], returncode=0, stdout=b"", stderr=b""
            )
            platform_utils._install_startup_mac(fake_exe)
            plist_path = (
                Path(self.tmp_home) / "Library" / "LaunchAgents" /
                "com.groundwork.agent.plist"
            )
            self.assertTrue(plist_path.exists())
            ok = platform_utils._uninstall_startup_mac()
        self.assertTrue(ok)
        self.assertFalse(plist_path.exists())

    def test_uninstall_idempotent_when_no_plist(self):
        with mock.patch.object(platform_utils.subprocess, "run") as run_mock:
            import subprocess as sp
            run_mock.return_value = sp.CompletedProcess(
                args=[], returncode=0, stdout=b"", stderr=b""
            )
            ok = platform_utils._uninstall_startup_mac()
        self.assertTrue(ok)


# =============================================================================
# Mac screen recording permission probe
# =============================================================================

class MacPermissionTests(unittest.TestCase):
    def test_non_mac_returns_true(self):
        with mock.patch.object(sys, "platform", "win32"):
            self.assertTrue(platform_utils.check_mac_screen_recording_permission())

    def test_mac_returns_false_when_mss_raises(self):
        with mock.patch.object(sys, "platform", "darwin"):
            # Patch mss.mss to raise on entry — simulates permission
            # denial without needing actual macOS permission state.
            import mss
            with mock.patch.object(mss, "mss") as mss_mock:
                mss_mock.side_effect = Exception("permission denied (simulated)")
                self.assertFalse(
                    platform_utils.check_mac_screen_recording_permission()
                )


if __name__ == "__main__":
    unittest.main()
