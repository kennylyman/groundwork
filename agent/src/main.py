import os
import sys
import json
import time
import traceback
from datetime import datetime
from pathlib import Path

import requests

CONFIG_DIR = Path(os.environ.get('APPDATA', '.')) / 'Groundwork'
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = CONFIG_DIR / 'groundwork.log'
CONFIG_FILE = CONFIG_DIR / 'config.json'

ACTIVATION_URL = os.environ.get(
    'GROUNDWORK_ACTIVATION_URL',
    'https://gwork.tech/api/activate',
)
CAPTURE_INTERVAL = 30


def log(msg: str) -> None:
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
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
            f"Activation failed: HTTP {response.status_code} — {response.text[:300]}"
        )
    data = response.json()
    required = ['employee_id', 'business_id', 'anthropic_api_key',
                'supabase_url', 'supabase_anon_key']
    missing = [k for k in required if not data.get(k)]
    if missing:
        raise RuntimeError(f"Activation response missing fields: {missing}")
    return data


def load_or_activate_config() -> dict:
    if CONFIG_FILE.exists():
        log(f"Reading config from {CONFIG_FILE}")
        config = json.loads(CONFIG_FILE.read_text())
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
            raise RuntimeError(
                "config.json missing employee_id/business_id — "
                "delete it and re-run with an install token to re-activate."
            )
        return config

    token = find_install_token()
    if not token:
        raise RuntimeError(
            "No config.json and no install token. "
            "Pass token as first CLI arg, or set GROUNDWORK_INSTALL_TOKEN."
        )

    log("No config.json — activating with install token")
    config = activate(token)
    CONFIG_FILE.write_text(json.dumps(config, indent=2))
    log(f"Config saved to {CONFIG_FILE}")
    return config


def run_capture_loop(config: dict) -> None:
    from capture import build_context_snapshot, start_input_listeners
    from classify import classify_snapshot
    from transmit import transmit_capture, flush_queue
    log("Modules imported")

    start_input_listeners()
    log("Input listeners started")

    flush_queue(config)

    session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    log(f"Session: {session_id}")
    log(f"Capture interval: {CAPTURE_INTERVAL}s")
    log("Entering capture loop")

    recent_tasks: list[str] = []
    while True:
        try:
            snapshot = build_context_snapshot(previous_tasks=recent_tasks[-5:])
            log(f"Snapshot taken: {snapshot.get('active_window')}")

            classification = classify_snapshot(snapshot, config['anthropic_api_key'])
            task = classification.get('task', 'unknown')
            confidence = classification.get('confidence', 0)
            log(f"Classified: {task} ({confidence}%)")
            recent_tasks.append(task)

            ok = transmit_capture(snapshot, classification, session_id, config)
            log("Transmitted" if ok else "Transmit failed — queued locally")

        except Exception as e:
            log(f"Capture cycle error: {e}")
            log(traceback.format_exc())

        log(f"Sleeping {CAPTURE_INTERVAL}s")
        time.sleep(CAPTURE_INTERVAL)


def main() -> None:
    log("=" * 60)
    log("Groundwork starting...")
    log(f"Python: {sys.version}")
    log(f"Executable: {sys.executable}")
    log(f"Config dir: {CONFIG_DIR}")

    load_env_fallbacks()

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
