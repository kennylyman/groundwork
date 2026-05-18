"""
Tests for the Windows startup-registration logic (v0.5.5).

The full winreg path is Windows-only; on macOS / Linux we only verify
that install_to_startup() and uninstall_from_startup() are no-op-safe
and don't crash. The check-before-write logic is exercised on Windows
via the unittest.mock harness below — when run on Windows, it patches
winreg and verifies the right SetValueEx calls fire.

Run from agent/:
    source venv/bin/activate
    PYTHONPATH=src python -m unittest tests.test_startup_registration -v
"""

import sys
import unittest
from pathlib import Path
from unittest import mock

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import main as agent_main  # noqa: E402


class CrossPlatformStubTests(unittest.TestCase):
    """These run on every platform — verify the no-op contract holds."""

    def test_install_returns_false_on_non_windows(self):
        with mock.patch.object(sys, "platform", "darwin"):
            self.assertFalse(agent_main.install_to_startup())

    def test_uninstall_returns_false_on_non_windows(self):
        with mock.patch.object(sys, "platform", "linux"):
            self.assertFalse(agent_main.uninstall_from_startup())

    def test_install_returns_false_when_not_frozen(self):
        # On Windows but as a regular `python main.py` (not PyInstaller exe).
        with mock.patch.object(sys, "platform", "win32"), \
             mock.patch.object(sys, "frozen", False, create=True):
            self.assertFalse(agent_main.install_to_startup())


@unittest.skipUnless(sys.platform == "win32", "winreg is Windows-only")
class WindowsRegistryTests(unittest.TestCase):
    """Run only on Windows. Patches winreg so we don't actually touch
    HKCU during the test suite."""

    def test_install_skips_write_when_already_set_to_current_exe(self):
        import winreg  # type: ignore

        fake_exe = r"C:\Users\test\AppData\Local\Programs\Groundwork.exe"
        with mock.patch.object(sys, "frozen", True, create=True), \
             mock.patch.object(sys, "executable", fake_exe), \
             mock.patch.object(winreg, "OpenKey") as open_key, \
             mock.patch.object(winreg, "QueryValueEx", return_value=(fake_exe, 1)), \
             mock.patch.object(winreg, "SetValueEx") as set_value:
            # OpenKey returns a context manager
            ctx = mock.MagicMock()
            open_key.return_value.__enter__.return_value = ctx
            result = agent_main.install_to_startup()
            self.assertTrue(result)
            set_value.assert_not_called()  # check-before-write contract

    def test_install_writes_when_value_missing(self):
        import winreg  # type: ignore

        fake_exe = r"C:\Users\test\Groundwork.exe"
        with mock.patch.object(sys, "frozen", True, create=True), \
             mock.patch.object(sys, "executable", fake_exe), \
             mock.patch.object(winreg, "OpenKey") as open_key, \
             mock.patch.object(winreg, "QueryValueEx", side_effect=FileNotFoundError), \
             mock.patch.object(winreg, "SetValueEx") as set_value:
            ctx = mock.MagicMock()
            open_key.return_value.__enter__.return_value = ctx
            result = agent_main.install_to_startup()
            self.assertTrue(result)
            set_value.assert_called_once()
            args, _ = set_value.call_args
            self.assertEqual(args[1], "Groundwork")  # value name
            self.assertEqual(args[4], fake_exe)      # registered path

    def test_install_overwrites_when_value_points_elsewhere(self):
        import winreg  # type: ignore

        old_exe = r"C:\OldLocation\Groundwork.exe"
        new_exe = r"C:\NewLocation\Groundwork.exe"
        with mock.patch.object(sys, "frozen", True, create=True), \
             mock.patch.object(sys, "executable", new_exe), \
             mock.patch.object(winreg, "OpenKey") as open_key, \
             mock.patch.object(winreg, "QueryValueEx", return_value=(old_exe, 1)), \
             mock.patch.object(winreg, "SetValueEx") as set_value:
            ctx = mock.MagicMock()
            open_key.return_value.__enter__.return_value = ctx
            result = agent_main.install_to_startup()
            self.assertTrue(result)
            set_value.assert_called_once()
            args, _ = set_value.call_args
            self.assertEqual(args[4], new_exe)

    def test_uninstall_deletes_value(self):
        import winreg  # type: ignore

        with mock.patch.object(winreg, "OpenKey") as open_key, \
             mock.patch.object(winreg, "DeleteValue") as delete_value:
            ctx = mock.MagicMock()
            open_key.return_value.__enter__.return_value = ctx
            result = agent_main.uninstall_from_startup()
            self.assertTrue(result)
            delete_value.assert_called_once()

    def test_uninstall_idempotent_when_value_missing(self):
        import winreg  # type: ignore

        with mock.patch.object(winreg, "OpenKey") as open_key, \
             mock.patch.object(winreg, "DeleteValue", side_effect=FileNotFoundError):
            ctx = mock.MagicMock()
            open_key.return_value.__enter__.return_value = ctx
            # Spec: removing an absent entry should still succeed (no error).
            result = agent_main.uninstall_from_startup()
            self.assertTrue(result)


if __name__ == "__main__":
    unittest.main()
