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

def capture_screenshot():
    """Capture primary monitor screenshot, return as base64 PNG string."""
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        screenshot = sct.grab(monitor)
        img = Image.frombytes("RGB", screenshot.size, screenshot.rgb)
        
        # Resize to reduce API payload — 1280px wide max
        max_width = 1280
        if img.width > max_width:
            ratio = max_width / img.width
            new_height = int(img.height * ratio)
            img = img.resize((max_width, new_height), Image.LANCZOS)
        
        buffer = io.BytesIO()
        img.save(buffer, format="PNG", optimize=True)
        return base64.b64encode(buffer.getvalue()).decode("utf-8")

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
    Returns dict with all available signals.
    """
    keystrokes, clicks, pastes = get_and_reset_counts()
    idle = get_idle_seconds()
    
    snapshot = {
        # UTC with Z suffix. Supabase's captured_at column is timestamptz —
        # without the Z it would be parsed as local time on whichever machine
        # PostgREST runs on, which silently skews Role Discovery's
        # "mornings vs afternoons" rollups for every employee.
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "screenshot_b64": capture_screenshot(),
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
    
    print(f"Timestamp:     {snapshot['timestamp']}")
    print(f"Active window: {snapshot['active_window']}")
    print(f"Active URL:    {snapshot['active_url']}")
    print(f"Keystrokes:    {snapshot['keystrokes_last_90s']}")
    print(f"Mouse clicks:  {snapshot['mouse_clicks_last_90s']}")
    print(f"Idle seconds:  {snapshot['idle_seconds']}")
    print(f"Screenshot:    {len(snapshot['screenshot_b64'])} chars (base64)")
    print("\nCapture successful.")
