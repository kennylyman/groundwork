"""
Cross-platform abstraction for OS-specific agent behavior.

All code in main.py / capture.py / transmit.py / capture_queue.py /
groundwork_logging.py should go through this module instead of branching
on sys.platform inline. New platform support (Linux, future ARM-only
Windows variants) is then a single-file edit.

The functions here are deliberately conservative — each one catches its
own errors and returns a safe default rather than raising. The agent
must keep running through paths where one platform-specific operation
fails (e.g. LaunchAgent registration denied) even if it means losing
that feature.

Platform IDs used throughout: 'windows' | 'mac' | 'linux'. Mapped from
sys.platform's 'win32' / 'darwin' / 'linux' via detect_platform().
"""

from __future__ import annotations

import os
import platform as _platform
import subprocess
import sys
from pathlib import Path
from typing import Literal

Platform = Literal["windows", "mac", "linux"]


# ============================================================================
# Platform detection
# ============================================================================

def detect_platform() -> Platform:
    """Stable platform id. Falls back to 'linux' for unrecognized
    sys.platform values — never raises."""
    p = sys.platform
    if p == "win32":
        return "windows"
    if p == "darwin":
        return "mac"
    return "linux"


# ============================================================================
# Paths
# ============================================================================

def get_config_dir() -> Path:
    """Where the agent stores config.json, queue.db, groundwork.log.

    Windows: %APPDATA%\\Groundwork (roaming profile — survives reinstall,
             follows the user across domain machines).
    Mac:     ~/Library/Application Support/Groundwork (Apple's
             prescribed location for app data; NOT ~/.groundwork because
             Time Machine excludes that and Migration Assistant skips it).
    Linux:   $XDG_CONFIG_HOME/groundwork or ~/.config/groundwork.
    """
    plat = detect_platform()
    if plat == "windows":
        # APPDATA missing only happens on broken / unprivileged installs.
        # The pre-logging gate in main.py catches and surfaces the failure.
        base = os.environ.get("APPDATA")
        if base:
            return Path(base) / "Groundwork"
        # Last-ditch fallback so we don't return Path('.\\Groundwork')
        # which silently writes to the cwd. This path is wrong on most
        # setups but at least it's logged elsewhere.
        return Path.home() / "AppData" / "Roaming" / "Groundwork"
    if plat == "mac":
        return Path.home() / "Library" / "Application Support" / "Groundwork"
    # Linux
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        return Path(xdg) / "groundwork"
    return Path.home() / ".config" / "groundwork"


def get_log_path() -> Path:
    return get_config_dir() / "groundwork.log"


def get_queue_path() -> Path:
    return get_config_dir() / "queue.db"


def get_runtime_dir() -> Path:
    """PyInstaller --runtime-tmpdir target. Same persistent location on
    every platform; bootloader expands the env var on Windows, raw path
    on Mac/Linux."""
    return get_config_dir() / "runtime"


def get_fallback_error_log_path() -> Path:
    """Last-ditch error log location used when the normal config dir
    can't be written (broken APPDATA, locked-down corporate Mac, etc).
    Public-readable on each platform; survives roaming-profile issues."""
    plat = detect_platform()
    if plat == "windows":
        return Path("C:/Users/Public/Groundwork-error.log")
    # On Mac and Linux, /tmp is universally writable. Apple doesn't have
    # a "Public" equivalent that makes sense for crash reports.
    return Path("/tmp/Groundwork-error.log")


# ============================================================================
# Fallback error log
# ============================================================================

def write_fallback_error_log(message: str) -> bool:
    """Append a pre-formatted error report to the platform's fallback
    log path. Used when the normal logger is unavailable (e.g.
    CONFIG_DIR creation failed). Returns True on success.

    Best-effort: never raises. Returns False if even the fallback path
    can't be written."""
    try:
        path = get_fallback_error_log_path()
        # Don't mkdir parents — /tmp and C:\Users\Public are guaranteed
        # to exist; if they don't, the system is too broken for us to
        # diagnose anything anyway.
        with open(path, "a", encoding="utf-8") as f:
            f.write(message)
            if not message.endswith("\n"):
                f.write("\n")
        return True
    except Exception:
        return False


# ============================================================================
# Fatal user-facing dialog
# ============================================================================

def show_fatal_dialog(title: str, message: str) -> bool:
    """Surface a native error dialog to the user. Returns True if the
    dialog was successfully displayed.

    Windows: MessageBoxW via ctypes.windll.user32
    Mac:     osascript -e 'display dialog ...' (built into every Mac;
             no extra dependency needed)
    Linux:   Best-effort — try zenity, then notify-send, then no-op.
             Most Linux users running this would be devs anyway.

    Each platform's call is wrapped in try/except — a missing dialog
    library shouldn't crash the crash reporter."""
    plat = detect_platform()
    if plat == "windows":
        return _show_dialog_windows(title, message)
    if plat == "mac":
        return _show_dialog_mac(title, message)
    return _show_dialog_linux(title, message)


def _show_dialog_windows(title: str, message: str) -> bool:
    try:
        import ctypes
        MB_OK = 0x00000000
        MB_ICONERROR = 0x00000010
        MB_SETFOREGROUND = 0x00010000
        MB_TOPMOST = 0x00040000
        ctypes.windll.user32.MessageBoxW(
            None, message, title,
            MB_OK | MB_ICONERROR | MB_SETFOREGROUND | MB_TOPMOST,
        )
        return True
    except Exception:
        return False


def _show_dialog_mac(title: str, message: str) -> bool:
    """Use osascript (AppleScript bridge) since it's installed on every
    Mac and doesn't need extra Python deps. Escapes the message for
    AppleScript string literals — double-quote inside a double-quoted
    string isn't legal so we replace " with \\".

    Trade-off: the dialog blocks until the user clicks OK. We accept
    that because the only time we show this is when we're about to
    exit anyway."""
    try:
        # AppleScript string escape: backslashes FIRST (so they don't
        # double-escape the slashes we add for quotes), then quotes.
        safe_title = title.replace("\\", "\\\\").replace('"', '\\"')
        safe_message = message.replace("\\", "\\\\").replace('"', '\\"')
        script = (
            f'display dialog "{safe_message}" '
            f'with title "{safe_title}" '
            'buttons {"OK"} default button "OK" '
            'with icon stop'
        )
        # Short timeout so a deeply-broken AppleScript host doesn't hang
        # the dying agent forever.
        subprocess.run(
            ["osascript", "-e", script],
            timeout=30,
            check=False,
            capture_output=True,
        )
        return True
    except Exception:
        return False


def _show_dialog_linux(title: str, message: str) -> bool:
    """Linux desktop environments are heterogeneous. Try zenity (GNOME)
    then notify-send. Most Linux agents will be servers without a GUI;
    return False there and let the caller proceed without a popup."""
    for cmd in (
        ["zenity", "--error", f"--title={title}", f"--text={message}"],
        ["notify-send", title, message],
    ):
        try:
            subprocess.run(cmd, timeout=5, check=False, capture_output=True)
            return True
        except Exception:
            continue
    return False


# ============================================================================
# Startup registration
# ============================================================================

def install_to_startup(exe_path: str | None = None) -> bool:
    """Register the agent for auto-launch at user login.

    Windows: HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run
    Mac:     ~/Library/LaunchAgents/com.groundwork.agent.plist
    Linux:   Not implemented (caller should fall through; systemd user
             units are the right answer but we don't ship a Linux
             agent today).

    exe_path: path to the running exe. Defaults to sys.executable, which
    is what we want when PyInstaller-frozen. Pass explicitly for tests."""
    target = exe_path if exe_path is not None else sys.executable
    plat = detect_platform()
    if plat == "windows":
        return _install_startup_windows(target)
    if plat == "mac":
        return _install_startup_mac(target)
    return False


def uninstall_from_startup() -> bool:
    """Reverse of install_to_startup. Called by the --uninstall flag.
    Idempotent — succeeds even if no entry exists."""
    plat = detect_platform()
    if plat == "windows":
        return _uninstall_startup_windows()
    if plat == "mac":
        return _uninstall_startup_mac()
    return False


# ---- Windows ---------------------------------------------------------------

_RUN_KEY_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
_RUN_KEY_VALUE = "Groundwork"


def _install_startup_windows(exe_path: str) -> bool:
    # PyInstaller --windowed builds set sys.frozen; running python main.py
    # for dev shouldn't register the dev path. The caller can override
    # by passing exe_path explicitly.
    if not getattr(sys, "frozen", False) and exe_path == sys.executable:
        return False
    try:
        import winreg  # type: ignore  (stdlib on Windows only)
    except ImportError:
        return False
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            _RUN_KEY_PATH,
            0,
            winreg.KEY_SET_VALUE | winreg.KEY_QUERY_VALUE,
        ) as key:
            try:
                existing, _ = winreg.QueryValueEx(key, _RUN_KEY_VALUE)
                if existing == exe_path:
                    return True
            except FileNotFoundError:
                pass
            winreg.SetValueEx(key, _RUN_KEY_VALUE, 0, winreg.REG_SZ, exe_path)
            return True
    except Exception:
        return False


def _uninstall_startup_windows() -> bool:
    try:
        import winreg  # type: ignore
    except ImportError:
        return False
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, _RUN_KEY_PATH, 0, winreg.KEY_SET_VALUE
        ) as key:
            try:
                winreg.DeleteValue(key, _RUN_KEY_VALUE)
            except FileNotFoundError:
                # Already removed — idempotent success.
                pass
            return True
    except Exception:
        return False


# ---- macOS -----------------------------------------------------------------

_LAUNCH_AGENT_LABEL = "com.groundwork.agent"


def _get_launch_agent_plist_path() -> Path:
    """~/Library/LaunchAgents/com.groundwork.agent.plist"""
    return Path.home() / "Library" / "LaunchAgents" / f"{_LAUNCH_AGENT_LABEL}.plist"


def _build_launch_agent_plist(exe_path: str) -> str:
    """Minimal LaunchAgent plist that runs the agent at user login and
    restarts on unexpected crashes. KeepAlive is False because we
    explicitly want a crash to stay crashed until the user investigates
    (matches Windows Run-key behavior — no auto-restart loop)."""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{_LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe_path}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>{get_config_dir() / 'launchd.out.log'}</string>
    <key>StandardErrorPath</key>
    <string>{get_config_dir() / 'launchd.err.log'}</string>
</dict>
</plist>
"""


def _install_startup_mac(exe_path: str) -> bool:
    """Write a LaunchAgent plist + load it via launchctl. The plist is
    persisted to ~/Library/LaunchAgents so it auto-loads on next login
    even without launchctl. We DO try launchctl here so the registration
    takes effect this session — but a failure there is non-fatal because
    the plist is already on disk."""
    try:
        plist_path = _get_launch_agent_plist_path()
        plist_path.parent.mkdir(parents=True, exist_ok=True)
        plist_content = _build_launch_agent_plist(exe_path)

        # If an identical plist already exists, no-op for idempotency.
        if plist_path.exists():
            try:
                if plist_path.read_text(encoding="utf-8") == plist_content:
                    return True
            except Exception:
                pass

        plist_path.write_text(plist_content, encoding="utf-8")

        # Best-effort live-load. `launchctl bootstrap` is the modern
        # incantation; fall back to `load` on older macOS. Neither failure
        # should block — the plist will pick up on next login regardless.
        uid = os.getuid() if hasattr(os, "getuid") else 0
        for cmd in (
            ["launchctl", "bootstrap", f"gui/{uid}", str(plist_path)],
            ["launchctl", "load", "-w", str(plist_path)],
        ):
            try:
                result = subprocess.run(cmd, timeout=10, check=False, capture_output=True)
                if result.returncode == 0:
                    break
            except Exception:
                continue
        return True
    except Exception:
        return False


def _uninstall_startup_mac() -> bool:
    """Unload the LaunchAgent and remove the plist. Idempotent."""
    try:
        plist_path = _get_launch_agent_plist_path()
        if plist_path.exists():
            uid = os.getuid() if hasattr(os, "getuid") else 0
            for cmd in (
                ["launchctl", "bootout", f"gui/{uid}", str(plist_path)],
                ["launchctl", "unload", str(plist_path)],
            ):
                try:
                    subprocess.run(cmd, timeout=10, check=False, capture_output=True)
                except Exception:
                    continue
            try:
                plist_path.unlink()
            except Exception:
                pass
        return True
    except Exception:
        return False


# ============================================================================
# Mac screen-recording permission check
# ============================================================================

def check_mac_screen_recording_permission() -> bool:
    """Probe whether the running process has Screen Recording permission
    on macOS. Attempts a 1x1-region mss grab; on permission denial mss
    raises ScreenShotError. Returns True on success, False on denial /
    any other failure, True on non-Mac platforms (no-op).

    Note: the FIRST time an unsigned binary requests screen recording,
    macOS shows its system permission prompt. The user has to grant via
    System Settings → Privacy & Security → Screen Recording and relaunch.
    We can't auto-grant; we can only detect denial and surface a clear
    error message.
    """
    if detect_platform() != "mac":
        return True
    try:
        import mss
        with mss.mss() as sct:
            # Smallest possible grab — top-left pixel of monitor 1.
            # If permission is denied mss raises here.
            monitor = sct.monitors[1]
            sct.grab({
                "left": monitor["left"],
                "top": monitor["top"],
                "width": 1,
                "height": 1,
            })
        return True
    except Exception:
        return False


def show_mac_permission_dialog() -> None:
    """Show the user how to grant Screen Recording permission. Blocks
    until the user clicks OK. Used in main.py after the permission
    check fails — we exit cleanly after showing this so they can grant
    permission and relaunch."""
    show_fatal_dialog(
        "Groundwork — Permission needed",
        "Groundwork needs Screen Recording permission to start.\n\n"
        "1. Open System Settings (Apple menu)\n"
        "2. Go to Privacy & Security\n"
        "3. Click Screen Recording\n"
        "4. Enable the toggle next to Groundwork\n"
        "5. Relaunch Groundwork\n\n"
        "If you don't see Groundwork in the list, run it once and "
        "macOS will add it automatically — then enable the toggle.",
    )
