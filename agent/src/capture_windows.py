import mss
import mss.tools
import base64
import time
import threading
from PIL import Image
import io
import platform

# Cross-platform input tracking
keystroke_count = 0
mouse_click_count = 0
copy_paste_count = 0
last_activity_time = time.time()
_listener_started = False
_lock = threading.Lock()

# Track modifier keys for copy/paste detection
_ctrl_pressed = False
_cmd_pressed = False


def _on_key_press(key):
    global keystroke_count, last_activity_time, copy_paste_count
    global _ctrl_pressed, _cmd_pressed

    with _lock:
        keystroke_count += 1
        last_activity_time = time.time()

    try:
        from pynput.keyboard import Key
        if key == Key.ctrl_l or key == Key.ctrl_r:
            _ctrl_pressed = True
        if key == Key.cmd:
            _cmd_pressed = True

        # Detect copy/paste
        try:
            k = key.char.lower() if hasattr(key, 'char') and key.char else None
            if k in ('c', 'v', 'x') and (_ctrl_pressed or _cmd_pressed):
                with _lock:
                    copy_paste_count += 1
        except Exception:
            pass

    except Exception:
        pass


def _on_key_release(key):
    global _ctrl_pressed, _cmd_pressed
    try:
        from pynput.keyboard import Key
        if key == Key.ctrl_l or key == Key.ctrl_r:
            _ctrl_pressed = False
        if key == Key.cmd:
            _cmd_pressed = False
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
        kb_listener = keyboard.Listener(
            on_press=_on_key_press,
            on_release=_on_key_release
        )
        ms_listener = mouse.Listener(on_click=_on_click)
        kb_listener.daemon = True
        ms_listener.daemon = True
        kb_listener.start()
        ms_listener.start()
        _listener_started = True
        print("Input listeners started successfully")
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


def capture_screenshot():
    """Capture primary monitor screenshot, return as base64 PNG string."""
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        screenshot = sct.grab(monitor)
        img = Image.frombytes("RGB", screenshot.size, screenshot.rgb)

        # Resize to reduce API payload
        max_width = 1280
        if img.width > max_width:
            ratio = max_width / img.width
            new_height = int(img.height * ratio)
            img = img.resize((max_width, new_height), Image.LANCZOS)

        buffer = io.BytesIO()
        img.save(buffer, format="PNG", optimize=True)
        return base64.b64encode(buffer.getvalue()).decode("utf-8")


def get_active_window():
    """Get active window title - Windows implementation."""
    system = platform.system()

    try:
        if system == "Windows":
            import ctypes
            user32 = ctypes.windll.user32
            hwnd = user32.GetForegroundWindow()
            length = user32.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)

            # Also get process name
            try:
                import psutil
                pid = ctypes.c_ulong()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                process = psutil.Process(pid.value)
                process_name = process.name().replace('.exe', '')
                return f"{process_name} | {buf.value}" if buf.value else process_name
            except Exception:
                return buf.value if buf.value else "Unknown"

        elif system == "Darwin":  # Mac fallback
            import subprocess
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

    except Exception as e:
        return f"Unknown ({e})"


def get_active_url():
    """Get active URL from browser - Windows implementation."""
    system = platform.system()

    try:
        if system == "Windows":
            # Try to get URL via UI automation from common browsers
            try:
                import pywinauto
                from pywinauto import Desktop
                
                # Get foreground window
                desktop = Desktop(backend="uia")
                
                # Try Chrome
                try:
                    chrome = desktop.window(title_re=".*Chrome.*")
                    if chrome.exists():
                        address_bar = chrome.child_window(
                            auto_id="omnibox",
                            control_type="Edit"
                        )
                        if address_bar.exists():
                            url = address_bar.get_value()
                            if url and ('http' in url or 'www' in url):
                                return url
                except Exception:
                    pass

                # Try Edge
                try:
                    edge = desktop.window(title_re=".*Edge.*")
                    if edge.exists():
                        address_bar = edge.child_window(
                            auto_id="omnibox",
                            control_type="Edit"
                        )
                        if address_bar.exists():
                            url = address_bar.get_value()
                            if url and ('http' in url or 'www' in url):
                                return url
                except Exception:
                    pass

            except ImportError:
                pass

        elif system == "Darwin":
            import subprocess
            for browser, script in [
                ("Google Chrome", 'tell application "Google Chrome" to return URL of active tab of front window'),
                ("Microsoft Edge", 'tell application "Microsoft Edge" to return URL of active tab of front window'),
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

    except Exception:
        pass

    return None


def build_context_snapshot(previous_tasks=None):
    """Build full context bundle for Claude classification."""
    keystrokes, clicks, pastes = get_and_reset_counts()
    idle = get_idle_seconds()

    snapshot = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "screenshot_b64": capture_screenshot(),
        "active_window": get_active_window(),
        "active_url": get_active_url(),
        "keystrokes_last_interval": keystrokes,
        "mouse_clicks_last_interval": clicks,
        "copy_paste_events_last_interval": pastes,
        "idle_seconds": round(idle, 1),
        "is_idle": idle > 60,
        "platform": platform.system(),
        "previous_tasks": previous_tasks or [],
    }

    return snapshot


if __name__ == "__main__":
    print(f"Platform: {platform.system()}")
    print("Starting input listeners...")
    start_input_listeners()
    time.sleep(2)

    print("Capturing context snapshot...")
    snapshot = build_context_snapshot()

    print(f"Timestamp:     {snapshot['timestamp']}")
    print(f"Active window: {snapshot['active_window']}")
    print(f"Active URL:    {snapshot['active_url']}")
    print(f"Keystrokes:    {snapshot['keystrokes_last_interval']}")
    print(f"Mouse clicks:  {snapshot['mouse_clicks_last_interval']}")
    print(f"Idle seconds:  {snapshot['idle_seconds']}")
    print(f"Screenshot:    {len(snapshot['screenshot_b64'])} chars (base64)")
    print("\nCapture successful.")
