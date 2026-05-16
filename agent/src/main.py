import os
import sys
import time
import json
import traceback
from datetime import datetime
from pathlib import Path

# Set up logging first before anything else
log_dir = Path(os.environ.get('APPDATA', '.')) / 'Groundwork'
log_dir.mkdir(parents=True, exist_ok=True)
log_file = log_dir / 'groundwork.log'

def log(msg):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{timestamp}] {msg}"
    print(line)
    with open(log_file, 'a') as f:
        f.write(line + '\n')

log("Groundwork starting...")
log(f"Python: {sys.version}")
log(f"Executable: {sys.executable}")
log(f"Log file: {log_file}")

try:
    from dotenv import load_dotenv
    
    # Find .env file
    if getattr(sys, 'frozen', False):
        base_dir = Path(sys._MEIPASS)
    else:
        base_dir = Path(__file__).parent
    
    env_path = base_dir / '.env'
    log(f"Looking for .env at: {env_path}")
    log(f".env exists: {env_path.exists()}")
    
    if env_path.exists():
        load_dotenv(env_path)
        log(".env loaded successfully")
    else:
        log("ERROR: .env file not found!")
        sys.exit(1)

    ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
    SUPABASE_URL = os.getenv('SUPABASE_URL')
    SUPABASE_ANON_KEY = os.getenv('SUPABASE_ANON_KEY')
    EMPLOYEE_ID = os.getenv('EMPLOYEE_ID')
    BUSINESS_ID = os.getenv('BUSINESS_ID')

    log(f"ANTHROPIC_API_KEY: {'set' if ANTHROPIC_API_KEY else 'MISSING'}")
    log(f"SUPABASE_URL: {'set' if SUPABASE_URL else 'MISSING'}")
    log(f"EMPLOYEE_ID: {EMPLOYEE_ID or 'MISSING'}")
    log(f"BUSINESS_ID: {BUSINESS_ID or 'MISSING'}")

    if not all([ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, EMPLOYEE_ID, BUSINESS_ID]):
        log("ERROR: Missing required environment variables")
        sys.exit(1)

    log("Importing modules...")
    from capture import take_snapshot
    from classify import classify_snapshot
    from transmit import transmit_capture
    log("All modules imported successfully")

    CAPTURE_INTERVAL = 30
    session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    log(f"Session ID: {session_id}")
    log(f"Capture interval: {CAPTURE_INTERVAL}s")
    log("Starting capture loop...")

    while True:
        try:
            log("Taking snapshot...")
            snapshot = take_snapshot()
            log(f"Snapshot taken: {snapshot.get('active_window', 'unknown')}")

            log("Classifying...")
            classification = classify_snapshot(snapshot, ANTHROPIC_API_KEY)
            log(f"Classified: {classification.get('task', 'unknown')} ({classification.get('confidence', 0)}%)")

            capture_data = {
                'employee_id': EMPLOYEE_ID,
                'business_id': BUSINESS_ID,
                'session_id': session_id,
                'captured_at': datetime.utcnow().isoformat(),
                **snapshot,
                **classification,
            }

            log("Transmitting...")
            transmit_capture(capture_data, SUPABASE_URL, SUPABASE_ANON_KEY)
            log("Transmitted successfully")

        except Exception as e:
            log(f"Capture error: {e}")
            log(traceback.format_exc())

        log(f"Sleeping {CAPTURE_INTERVAL}s...")
        time.sleep(CAPTURE_INTERVAL)

except Exception as e:
    log(f"FATAL ERROR: {e}")
    log(traceback.format_exc())
    time.sleep(30)
    sys.exit(1)
