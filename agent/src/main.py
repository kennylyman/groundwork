import os
import sys
import json
import time
import uuid
import traceback
from datetime import datetime
from pathlib import Path

import requests

try:
    from _version import VERSION
except Exception:
    # Should never hit this in a frozen build — GitHub Actions writes
    # _version.py before PyInstaller runs. Fallback keeps `python main.py`
    # working in dev.
    VERSION = "0.0.0-dev"

CONFIG_DIR = Path(os.environ.get('APPDATA', '.')) / 'Groundwork'
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = CONFIG_DIR / 'groundwork.log'
CONFIG_FILE = CONFIG_DIR / 'config.json'

ACTIVATION_URL = os.environ.get(
    'GROUNDWORK_ACTIVATION_URL',
    'https://gwork.tech/api/activate',
)
CAPTURE_INTERVAL = 30
PAUSE_CHECK_EVERY = 5  # captures between pause-state polls
# Soft-update cadence: re-check at most once an hour, only when idle (>60s).
SOFT_UPDATE_CHECK_INTERVAL_SECONDS = 3600


def log(msg: str) -> None:
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    # PyInstaller --windowed sets sys.stdout to None on Windows; print() would crash.
    try:
        print(line)
    except Exception:
        pass
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line + '\n')
    except Exception:
        pass


def load_env_fallbacks() -> None:
    """Load .env bundled with the exe — only used as fallback for shared creds."""
    try:
        from dotenv import load_dotenv
        if getattr(sys, 'frozen', False):
            base_dir = Path(sys._MEIPASS)
        else:
            base_dir = Path(__file__).parent
        env_path = base_dir / '.env'
        if env_path.exists():
            load_dotenv(env_path)
            log(f"Loaded .env fallbacks from {env_path}")
        else:
            log(f"No .env at {env_path} (ok — fallbacks optional)")
    except Exception as e:
        log(f"dotenv load skipped: {e}")


def find_install_token() -> str | None:
    if len(sys.argv) > 1 and sys.argv[1].strip():
        return sys.argv[1].strip()
    token = os.environ.get('GROUNDWORK_INSTALL_TOKEN')
    return token.strip() if token else None


def activate(token: str) -> dict:
    log(f"Calling activation endpoint: {ACTIVATION_URL}")
    response = requests.get(ACTIVATION_URL, params={'token': token}, timeout=30)
    if response.status_code != 200:
        raise RuntimeError(
            f"HTTP {response.status_code}: {response.text[:200].strip()}"
        )
    data = response.json()
    required = ['employee_id', 'business_id', 'anthropic_api_key',
                'supabase_url', 'supabase_anon_key']
    missing = [k for k in required if not data.get(k)]
    if missing:
        raise RuntimeError(f"Response missing fields: {missing}")
    return data


def prompt_for_token_gui() -> dict | None:
    """
    Show a small setup window asking for the install token. On Continue,
    call activate() and either close on success or display the error and
    let the user retry. Returns the activated config dict, or None if the
    user closed the window without activating.
    """
    try:
        import tkinter as tk
    except Exception as e:
        log(f"tkinter unavailable: {e}")
        return None

    result: dict = {}
    root = tk.Tk()
    root.title("Groundwork Setup")
    root.resizable(False, False)
    root.configure(bg='white')

    # Size + center
    W, H = 480, 360
    sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
    root.geometry(f"{W}x{H}+{(sw - W) // 2}+{(sh - H) // 2}")

    frame = tk.Frame(root, bg='white', padx=28, pady=24)
    frame.pack(fill='both', expand=True)

    tk.Label(
        frame, text="Welcome to Groundwork",
        font=('Segoe UI', 16, 'bold'), bg='white', fg='#111',
    ).pack(anchor='w')

    tk.Label(
        frame, text="Paste your install token to activate this agent.",
        font=('Segoe UI', 10), bg='white', fg='#666', anchor='w', justify='left',
    ).pack(anchor='w', pady=(6, 18))

    tk.Label(
        frame, text="Install token",
        font=('Segoe UI', 9, 'bold'), bg='white', fg='#444',
    ).pack(anchor='w')

    entry = tk.Entry(frame, font=('Consolas', 10), relief='solid', bd=1)
    entry.pack(fill='x', pady=(4, 4), ipady=8, ipadx=6)
    entry.focus()

    tk.Label(
        frame, text="Find it in the email you received or on your install page.",
        font=('Segoe UI', 8), bg='white', fg='#999', anchor='w',
    ).pack(anchor='w', pady=(0, 14))

    status = tk.Label(
        frame, text="", font=('Segoe UI', 9), bg='white',
        anchor='w', wraplength=420, justify='left',
    )
    status.pack(anchor='w', fill='x', pady=(0, 14))

    def on_continue() -> None:
        token = entry.get().strip()
        if not token:
            status.config(text="Please paste your install token.", fg='#c00')
            return
        button.config(state='disabled', text='Verifying…')
        status.config(text='Contacting activation server…', fg='#666')
        root.update_idletasks()
        try:
            config = activate(token)
        except Exception as e:
            log(f"GUI activation error: {e}")
            button.config(state='normal', text='Continue')
            status.config(text=f"Activation failed — {e}", fg='#c00')
            return
        result['config'] = config
        root.destroy()

    button = tk.Button(
        frame, text="Continue",
        font=('Segoe UI', 10, 'bold'),
        bg='#4f46e5', fg='white',
        activebackground='#4338ca', activeforeground='white',
        relief='flat', cursor='hand2',
        padx=24, pady=10,
        command=on_continue,
    )
    button.pack(anchor='e')

    entry.bind('<Return>', lambda _e: on_continue())

    log("Showing setup window")
    root.mainloop()
    return result.get('config')


def _read_existing_config() -> dict | None:
    """Return the saved config, or None if missing/invalid."""
    if not CONFIG_FILE.exists():
        return None
    try:
        config = json.loads(CONFIG_FILE.read_text())
    except Exception as e:
        log(f"config.json unreadable ({e}) — will re-activate")
        return None
    # Apply env fallbacks for shared creds if missing from config
    for key, env_key in (
        ('anthropic_api_key', 'ANTHROPIC_API_KEY'),
        ('supabase_url', 'SUPABASE_URL'),
        ('supabase_anon_key', 'SUPABASE_ANON_KEY'),
    ):
        if not config.get(key):
            fallback = os.environ.get(env_key)
            if fallback:
                config[key] = fallback
                log(f"Applied env fallback for {key}")
    if not config.get('employee_id') or not config.get('business_id'):
        log("config.json missing employee_id/business_id — will re-activate")
        return None
    return config


def load_or_activate_config() -> dict:
    config = _read_existing_config()
    if config is not None:
        log(f"Reading config from {CONFIG_FILE}")
        _ensure_startup_installed(config)
        return config

    # No saved config — need to activate.
    token = find_install_token()
    if token:
        log("Activating with install token (from CLI/env)")
        config = activate(token)
    else:
        log("No saved config and no token — prompting user")
        config = prompt_for_token_gui()
        if config is None:
            raise RuntimeError("Setup cancelled — no install token provided")

    CONFIG_FILE.write_text(json.dumps(config, indent=2))
    log(f"Config saved to {CONFIG_FILE}")
    _ensure_startup_installed(config)
    return config


def install_to_startup() -> bool:
    """
    Register this exe in HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run
    so Windows auto-launches Groundwork on the user's next login.

    - Only runs on Windows.
    - Only acts when running as the frozen PyInstaller exe (sys.frozen).
    - No-op if already pointed at the current exe path.
    - HKCU (per-user) — no admin needed, scoped to this user's account.

    Returns True iff the registry entry is now set to this exe path.
    Returns False when skipped (not Windows / not frozen) or on error,
    so the caller can decide whether to retry on a later launch.
    """
    if sys.platform != 'win32':
        log("Skipping startup install (not Windows)")
        return False
    if not getattr(sys, 'frozen', False):
        log("Skipping startup install (not a frozen exe)")
        return False

    try:
        import winreg  # stdlib on Windows
    except ImportError as e:
        log(f"winreg unavailable: {e}")
        return False

    exe_path = sys.executable
    run_key = r"Software\Microsoft\Windows\CurrentVersion\Run"
    value_name = "Groundwork"

    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            run_key,
            0,
            winreg.KEY_SET_VALUE | winreg.KEY_QUERY_VALUE,
        ) as key:
            try:
                existing, _ = winreg.QueryValueEx(key, value_name)
                if existing == exe_path:
                    log(f"Startup entry already set: {exe_path}")
                    return True
                log(f"Updating startup entry: {existing!r} -> {exe_path!r}")
            except FileNotFoundError:
                log(f"Adding startup entry: {exe_path}")
            winreg.SetValueEx(key, value_name, 0, winreg.REG_SZ, exe_path)
            return True
    except Exception as e:
        # Non-fatal — we still want the agent to run this session even if
        # the startup hook fails.
        log(f"Could not write HKCU Run entry: {e}")
        return False


def _ensure_startup_installed(config: dict) -> None:
    """
    One-time post-activation hook: install the startup-registry entry and
    record a `startup_installed: true` marker in config.json so we don't
    retry on every launch (and so manual user cleanup of the Run entry
    stays sticky).

    Called both on first-time activation and when reading an existing
    config that predates this hook — so installs that activated before
    this change get retro-fitted on their next launch.
    """
    if config.get('startup_installed'):
        return
    if not install_to_startup():
        return
    config['startup_installed'] = True
    try:
        CONFIG_FILE.write_text(json.dumps(config, indent=2))
        log("Marked config.startup_installed = true")
    except Exception as e:
        log(f"Could not persist startup_installed flag: {e}")


def check_is_paused(config: dict) -> bool:
    """
    Poll Supabase for this employee's is_paused flag via the
    `is_employee_paused` RPC (SECURITY DEFINER, callable with the anon key).
    Returns False on any error — fail-open so a transient network blip
    doesn't accidentally pause an employee.
    """
    supabase_url = config.get("supabase_url")
    supabase_key = config.get("supabase_anon_key")
    employee_id = config.get("employee_id")
    if not supabase_url or not supabase_key or not employee_id:
        return False
    try:
        response = requests.post(
            f"{supabase_url}/rest/v1/rpc/is_employee_paused",
            headers={
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json",
            },
            json={"employee_id": employee_id},
            timeout=5,
        )
        if response.status_code != 200:
            log(f"Pause check failed: HTTP {response.status_code} {response.text[:100]}")
            return False
        return bool(response.json())
    except Exception as e:
        log(f"Pause check error: {e}")
        return False


def _maybe_soft_update(config: dict, last_check_at: float, idle_seconds: float) -> float:
    """Inside the capture loop. Fires a soft update at the first idle
    window after SOFT_UPDATE_CHECK_INTERVAL_SECONDS has passed. Idle =
    user is away (>60s of no input), so the swap won't interrupt active
    work.

    Returns the new "last_check_at" timestamp — same value if we skipped,
    updated if we ran a check.
    """
    if idle_seconds < 60:
        return last_check_at
    now = time.time()
    if now - last_check_at < SOFT_UPDATE_CHECK_INTERVAL_SECONDS:
        return last_check_at
    try:
        from updater import check_for_update, decide_action, perform_update
    except Exception as e:
        log(f"soft update: import failed: {e}")
        return now
    release = check_for_update(
        ACTIVATION_URL, config.get("employee_id"), VERSION, log
    )
    if not release:
        return now
    action = decide_action(VERSION, release)
    log(
        f"soft update check: current={VERSION} "
        f"latest={release.get('latest_version')} "
        f"action={action}"
    )
    if action in ("hard", "soft"):
        log(f"soft update: downloading v{release.get('latest_version')} (user idle)")
        perform_update(release, CONFIG_DIR, log)
        # If perform_update() returns, the update failed and we keep running.
    return now


def run_capture_loop(config: dict) -> None:
    from capture import build_context_snapshot, start_input_listeners
    from classify import classify_snapshot
    from transmit import transmit_capture, flush_queue
    log("Modules imported")

    start_input_listeners()
    log("Input listeners started")

    flush_queue(config)

    session_id = str(uuid.uuid4())
    log(f"Session: {session_id}")
    log(f"Capture interval: {CAPTURE_INTERVAL}s")
    log(f"Pause check every {PAUSE_CHECK_EVERY} captures")
    log("Entering capture loop")

    recent_tasks: list[str] = []
    capture_count = 0
    is_paused = False
    # Throttle soft-update checks. Init to "now" so the first opportunity
    # is one full interval after startup (hard check on startup already
    # ran in main()).
    last_soft_update_check = time.time()

    while True:
        try:
            # Re-poll pause state every PAUSE_CHECK_EVERY iterations (and at start).
            if capture_count % PAUSE_CHECK_EVERY == 0:
                new_paused = check_is_paused(config)
                if new_paused != is_paused:
                    log(f"Pause state changed: {is_paused} -> {new_paused}")
                is_paused = new_paused

            if is_paused:
                log("Paused — skipping capture cycle")
            else:
                snapshot = build_context_snapshot(previous_tasks=recent_tasks[-5:])
                log(f"Snapshot taken: {snapshot.get('active_window')}")

                classification = classify_snapshot(
                    snapshot,
                    config['anthropic_api_key'],
                    business_context=config.get('business_context'),
                    role_context=config.get('role_context'),
                    capabilities=config.get('capabilities'),
                )
                task = classification.get('task', 'unknown')
                confidence = classification.get('confidence', 0)
                log(f"Classified: {task} ({confidence}%)")
                recent_tasks.append(task)

                ok = transmit_capture(snapshot, classification, session_id, config)
                log("Transmitted" if ok else "Transmit failed — queued locally")

                # Opportunistic soft update at idle. perform_update() exits
                # the process on success, so anything after this line only
                # runs on no-op / failed-update paths.
                last_soft_update_check = _maybe_soft_update(
                    config,
                    last_soft_update_check,
                    snapshot.get("idle_seconds", 0),
                )

        except Exception as e:
            log(f"Capture cycle error: {e}")
            log(traceback.format_exc())

        capture_count += 1
        log(f"Sleeping {CAPTURE_INTERVAL}s")
        time.sleep(CAPTURE_INTERVAL)


def _cleanup_update_orphans() -> None:
    """Sweep up any half-finished update artifacts before doing anything
    else. Safe to call on non-Windows / non-frozen builds (no-op)."""
    try:
        from updater import cleanup_update_orphans
        cleanup_update_orphans(CONFIG_DIR, log)
    except Exception as e:
        log(f"orphan cleanup error: {e}")


def _maybe_hard_update(config: dict) -> None:
    """Check /api/agent-version before the capture loop. If the current
    build is below the min_supported floor, perform_update() exits the
    process and the updater.bat takes over. Network failures fail open —
    we log and continue.
    """
    try:
        from updater import check_for_update, decide_action, perform_update
    except Exception as e:
        log(f"update module import failed: {e}")
        return
    release = check_for_update(
        ACTIVATION_URL, config.get("employee_id"), VERSION, log
    )
    if not release:
        return
    action = decide_action(VERSION, release)
    log(
        f"update check: current={VERSION} "
        f"latest={release.get('latest_version')} "
        f"min_supported={release.get('min_supported_version')} "
        f"action={action}"
    )
    if action == "hard":
        log(f"hard update required → downloading v{release.get('latest_version')}")
        perform_update(release, CONFIG_DIR, log)
        # perform_update() exits on success. If it returned, the update
        # failed and we continue running on the current build. Logged
        # inside perform_update().


def main() -> None:
    log("=" * 60)
    log(f"Groundwork starting (agent v{VERSION})...")
    log(f"Python: {sys.version}")
    log(f"Executable: {sys.executable}")
    log(f"Config dir: {CONFIG_DIR}")

    load_env_fallbacks()

    # Clear out any half-finished update artifacts from a prior session
    # before we touch anything else. If we got this far, the running exe
    # is intact; we just need to tidy up.
    _cleanup_update_orphans()

    try:
        config = load_or_activate_config()
    except Exception as e:
        log(f"FATAL: {e}")
        log(traceback.format_exc())
        time.sleep(30)
        sys.exit(1)

    log(f"Employee: {config['employee_id']}")
    log(f"Business: {config['business_id']}")
    log(f"Supabase URL: {'set' if config.get('supabase_url') else 'MISSING'}")
    log(f"Anthropic key: {'set' if config.get('anthropic_api_key') else 'MISSING'}")

    _maybe_hard_update(config)

    run_capture_loop(config)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        log(f"FATAL ERROR: {e}")
        log(traceback.format_exc())
        time.sleep(30)
        sys.exit(1)
