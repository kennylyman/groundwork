import mss
import mss.tools
import base64
import time
import threading
from datetime import datetime, timezone
from PIL import Image
import io
import subprocess
import platform

from groundwork_logging import get_logger


# Shared logger — main.py calls configure_logging() at startup; capture
# events land in the same RotatingFileHandler as main loop events. If
# capture is imported standalone for smoke tests, get_logger() returns
# an unconfigured logger and .info()/.warning() calls become no-ops.
_logger = get_logger()


def _log(msg: str) -> None:
    """Compatibility shim around the shared logger so existing call
    sites in this module keep working. Routes to logger.info(); the
    capture pipeline's "skipping cycle" lines are informational, not
    errors (the operator-actionable signal is logged at WARNING by the
    main loop when it hits the consecutive-failures threshold)."""
    _logger.info(msg)


# Threshold below which an entire frame is considered "blanked" — every
# RGB channel must max out at ≤ this value. A real dark UI always has
# at least some bright pixels (cursor, badges, anti-aliased text). A
# protected-content lock from Teams/Zoom screen-share returns a
# uniformly black or near-black frame, which is what we're detecting
# here. Sending that to Claude wastes API tokens AND produces useless
# classifications ("a black rectangle, no content visible").
_BLACK_FRAME_THRESHOLD = 5


# Cross-platform input tracking
keystroke_count = 0
mouse_click_count = 0
copy_paste_count = 0
last_activity_time = time.time()
_listener_started = False
_lock = threading.Lock()

def _on_key_press(key):
    global keystroke_count, last_activity_time, copy_paste_count
    with _lock:
        keystroke_count += 1
        last_activity_time = time.time()
        try:
            from pynput.keyboard import Key, KeyCode
            # Detect copy/paste: Cmd+C, Cmd+V on Mac; Ctrl+C, Ctrl+V on Windows
            pass
        except Exception:
            pass

def _on_click(x, y, button, pressed):
    global mouse_click_count, last_activity_time
    if pressed:
        with _lock:
            mouse_click_count += 1
            last_activity_time = time.time()

def start_input_listeners():
    global _listener_started
    if _listener_started:
        return
    try:
        from pynput import keyboard, mouse
        kb_listener = keyboard.Listener(on_press=_on_key_press)
        ms_listener = mouse.Listener(on_click=_on_click)
        kb_listener.daemon = True
        ms_listener.daemon = True
        kb_listener.start()
        ms_listener.start()
        _listener_started = True
    except Exception as e:
        print(f"Input listener warning: {e}")

def get_and_reset_counts():
    global keystroke_count, mouse_click_count, copy_paste_count
    with _lock:
        k = keystroke_count
        m = mouse_click_count
        c = copy_paste_count
        keystroke_count = 0
        mouse_click_count = 0
        copy_paste_count = 0
    return k, m, c

def get_idle_seconds():
    return time.time() - last_activity_time

def _detect_active_monitor_index(sct) -> int:
    """Return the mss monitor index that contains the active window.
    Falls back to 1 (primary) on any error.

    Windows path: uses GetForegroundWindow + GetWindowRect to find the
    active window's screen rectangle, then matches the center point
    against mss.monitors[1..N] (monitors[0] is the virtual all-screens
    bounding box, not a real monitor).

    Non-Windows: returns 1 unconditionally. The Mac path could use
    NSScreen.screenContainingPoint but we don't ship the agent on Mac;
    dev runs are single-monitor in practice."""
    if platform.system() != "Windows":
        return 1
    try:
        import ctypes
        from ctypes import wintypes

        hwnd = ctypes.windll.user32.GetForegroundWindow()
        if not hwnd:
            return 1

        rect = wintypes.RECT()
        if not ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return 1

        # Minimized windows on Windows report rect coords near
        # (-32000, -32000). Treat that as "no real position" → primary.
        if rect.left < -10000 or rect.top < -10000:
            return 1

        cx = (rect.left + rect.right) // 2
        cy = (rect.top + rect.bottom) // 2

        # mss exposes monitors as a list where index 0 is the virtual
        # screen (all monitors as one bounding box) and indices 1..N are
        # the actual monitors. We iterate the real monitors and pick the
        # first one whose rectangle contains the window's center.
        for i in range(1, len(sct.monitors)):
            m = sct.monitors[i]
            left = m["left"]
            top = m["top"]
            right = left + m["width"]
            bottom = top + m["height"]
            if left <= cx < right and top <= cy < bottom:
                return i

        return 1
    except Exception:
        return 1


def capture_screenshot() -> tuple[str, int] | None:
    """Capture the monitor containing the active window. Returns
    (base64 PNG, monitor_index) on success, None on failure.

    Failure modes that return None instead of raising:

      - mss.grab() raises an exception. Common Windows triggers:
        BitBlt access denied while another app holds the screen-share
        lock (Teams, Zoom, GoToMeeting); a monitor unplugged mid-grab;
        antivirus / EDR interfering with the screen-capture syscalls.

      - The grabbed frame is uniformly black (every RGB channel maxes
        out at ≤ _BLACK_FRAME_THRESHOLD). Windows produces these when
        protected-content / DRM screen-share is active. Sending them to
        Claude wastes API tokens and produces garbage classifications,
        so we skip the cycle.

      - Any unexpected exception inside the mss context (PIL frombytes
        on a weird buffer shape, encoder errors, etc.).

    Errors are logged with timestamp + exception type + message to
    groundwork.log. The main loop treats None as "skip this cycle":
    no classify, no transmit, sleep normally and try again.

    Index is the mss monitors[] index (1 = primary, 2+ = additional).
    """
    try:
        with mss.mss() as sct:
            monitor_index = _detect_active_monitor_index(sct)
            # Defensive: mss.monitors[] is mutable across calls; the
            # detector returned an index that should be valid for this
            # sct, but be paranoid in case a monitor was unplugged
            # between detection and grab.
            try:
                monitor = sct.monitors[monitor_index]
            except (IndexError, KeyError):
                monitor_index = 1
                monitor = sct.monitors[1]

            # Innermost guard: this is the call that fails during
            # screen-share / AV interference. Treat any failure here
            # as a cycle skip — never a process death.
            try:
                screenshot = sct.grab(monitor)
            except Exception as e:
                _log(
                    f"screenshot grab failed: {type(e).__name__}: {e} "
                    f"(monitor {monitor_index}) — skipping cycle"
                )
                return None

            img = Image.frombytes("RGB", screenshot.size, screenshot.rgb)

            # Protected-content / blanked-frame detection. extrema is
            # ((rmin, rmax), (gmin, gmax), (bmin, bmax)) for RGB. If
            # every channel maxes at near-zero, the whole frame is
            # black — a real dark UI always has at least cursor or
            # text highlights that push one channel above the threshold.
            extrema = img.getextrema()
            if all(ch[1] <= _BLACK_FRAME_THRESHOLD for ch in extrema):
                _log(
                    "protected content detected (uniformly black frame, "
                    f"max channel={max(ch[1] for ch in extrema)}), skipping cycle"
                )
                return None

            # Resize to reduce API payload — 1280px wide max
            max_width = 1280
            if img.width > max_width:
                ratio = max_width / img.width
                new_height = int(img.height * ratio)
                img = img.resize((max_width, new_height), Image.LANCZOS)

            buffer = io.BytesIO()
            img.save(buffer, format="PNG", optimize=True)
            return (
                base64.b64encode(buffer.getvalue()).decode("utf-8"),
                monitor_index,
            )
    except Exception as e:
        # Outermost belt-and-suspenders for anything that escapes the
        # inner handlers: mss() context init failure, PIL decode of a
        # malformed buffer, encoder I/O errors. Caller still gets None.
        _log(
            f"screenshot pipeline failed: {type(e).__name__}: {e} "
            "— skipping cycle"
        )
        return None

def get_active_window():
    """Get active window title cross-platform."""
    system = platform.system()
    try:
        if system == "Darwin":  # Mac
            script = '''
            tell application "System Events"
                set frontApp to name of first application process whose frontmost is true
                set windowTitle to ""
                try
                    set windowTitle to name of front window of (first application process whose frontmost is true)
                end try
                return frontApp & " | " & windowTitle
            end tell
            '''
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=3
            )
            return result.stdout.strip() if result.returncode == 0 else "Unknown"
        
        elif system == "Windows":
            import ctypes
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(length + 1)
            ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
            return buf.value if buf.value else "Unknown"
    except Exception as e:
        return f"Unknown ({e})"

def get_active_url():
    """Get active URL from browser if browser is focused."""
    system = platform.system()
    try:
        if system == "Darwin":
            # Try Chrome first, then Edge, then Firefox
            for browser, script in [
                ("Google Chrome", 'tell application "Google Chrome" to return URL of active tab of front window'),
                ("Microsoft Edge", 'tell application "Microsoft Edge" to return URL of active tab of front window'),
                ("Firefox", 'tell application "Firefox" to return URL of active tab of front window'),
            ]:
                try:
                    result = subprocess.run(
                        ["osascript", "-e", script],
                        capture_output=True, text=True, timeout=3
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        return result.stdout.strip()
                except Exception:
                    continue
        
        elif system == "Windows":
            # Windows URL extraction via UI automation
            try:
                import pywinauto
                app = pywinauto.Desktop(backend="uia")
                # This will be expanded for Windows deployment
                pass
            except Exception:
                pass
    except Exception:
        pass
    return None

def build_context_snapshot(previous_tasks=None):
    """
    Build a full context bundle for Claude classification.
    Returns dict with all available signals, or None when the
    screenshot couldn't be taken (caller skips classify/transmit
    for the cycle and tries again at the next interval).

    Note: input counters (keystrokes/clicks/paste) are drained ONLY
    after a successful screenshot grab. If we returned a snapshot
    without the screenshot but with drained counters, those keystrokes
    would be lost. By draining only on success, a failed-capture cycle
    leaves the counters intact and they roll into the next successful
    snapshot — important during long meetings where the user is
    actively typing while Windows is denying screen capture.
    """
    idle = get_idle_seconds()
    shot = capture_screenshot()
    if shot is None:
        return None
    screenshot_b64, monitor_index = shot
    keystrokes, clicks, pastes = get_and_reset_counts()

    snapshot = {
        # UTC with Z suffix. Supabase's captured_at column is timestamptz —
        # without the Z it would be parsed as local time on whichever machine
        # PostgREST runs on, which silently skews Role Discovery's
        # "mornings vs afternoons" rollups for every employee.
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "screenshot_b64": screenshot_b64,
        # Which mss monitor was captured. 1 = primary (or fallback when
        # the active window couldn't be located). 2+ = the secondary
        # monitor that contained the active window. Lets the dashboard
        # spot multi-monitor employees and debug "why does this capture
        # show the wrong screen".
        "monitor_index": monitor_index,
        "active_window": get_active_window(),
        "active_url": get_active_url(),
        "keystrokes_last_90s": keystrokes,
        "mouse_clicks_last_90s": clicks,
        "copy_paste_events_last_90s": pastes,
        "idle_seconds": round(idle, 1),
        "is_idle": idle > 60,
        "previous_tasks": previous_tasks or [],
    }

    return snapshot


if __name__ == "__main__":
    print("Starting input listeners...")
    start_input_listeners()
    time.sleep(2)
    
    print("Capturing context snapshot...")
    snapshot = build_context_snapshot()
    if snapshot is None:
        print("Snapshot returned None (screenshot capture failed or frame was "
              "blanked). See groundwork.log for details.")
        raise SystemExit(1)

    print(f"Timestamp:     {snapshot['timestamp']}")
    print(f"Active window: {snapshot['active_window']}")
    print(f"Active URL:    {snapshot['active_url']}")
    print(f"Keystrokes:    {snapshot['keystrokes_last_90s']}")
    print(f"Mouse clicks:  {snapshot['mouse_clicks_last_90s']}")
    print(f"Idle seconds:  {snapshot['idle_seconds']}")
    print(f"Screenshot:    {len(snapshot['screenshot_b64'])} chars (base64)")
    print(f"Monitor:       index {snapshot['monitor_index']}")
    print("\nCapture successful.")
