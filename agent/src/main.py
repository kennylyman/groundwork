import time
import json
import os
import signal
import sys
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

from capture import build_context_snapshot, start_input_listeners
from classify import classify_snapshot, print_classification
from transmit import transmit_capture, flush_queue, create_session, end_session

# Configuration
CAPTURE_INTERVAL = 30        # seconds between captures
MAX_PREVIOUS_TASKS = 8       # how many recent tasks to include as context
IDLE_SKIP_THRESHOLD = 300    # skip capture if idle > 5 minutes (saves API costs)
LOG_DIR = Path("../logs")    # where JSON logs are stored

# State
previous_tasks = []
running = True
session_start = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
log_file = LOG_DIR / f"session_{session_start}.json"
employee_id = os.getenv("EMPLOYEE_ID", "unknown")
business_id = os.getenv("BUSINESS_ID", "comfort_keepers")


def setup():
    """Initialize logging directory and session file."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    
    session_meta = {
        "session_id": session_start,
        "employee_id": employee_id,
        "business_id": business_id,
        "started_at": datetime.now().isoformat(),
        "captures": []
    }
    
    with open(log_file, "w") as f:
        json.dump(session_meta, f, indent=2)
    
    print(f"Groundwork Agent — Session started")
    print(f"Employee:  {employee_id}")
    print(f"Business:  {business_id}")
    print(f"Log file:  {log_file}")
    print(f"Interval:  {CAPTURE_INTERVAL}s")
    print("-" * 60)
    
    # Flush any queued captures from previous sessions
    flush_queue()


def append_to_log(result: dict):
    """Append a classification result to the session log file."""
    try:
        with open(log_file, "r") as f:
            session = json.load(f)
        
        session["captures"].append(result)
        session["last_updated"] = datetime.now().isoformat()
        session["total_captures"] = len(session["captures"])
        
        with open(log_file, "w") as f:
            json.dump(session, f, indent=2)
    except Exception as e:
        print(f"Log write error: {e}")


def update_previous_tasks(result: dict):
    """Keep a rolling window of recent task descriptions for context."""
    global previous_tasks
    task_summary = f"[{result['timestamp']}] {result['task']} ({result['category']})"
    previous_tasks.append(task_summary)
    if len(previous_tasks) > MAX_PREVIOUS_TASKS:
        previous_tasks = previous_tasks[-MAX_PREVIOUS_TASKS:]


def handle_shutdown(signum, frame):
    """Graceful shutdown on Ctrl+C."""
    global running
    print("\n\nShutting down Groundwork agent...")
    print(f"Session log saved to: {log_file}")
    
    # Write final session summary
    try:
        with open(log_file, "r") as f:
            session = json.load(f)
        session["ended_at"] = datetime.now().isoformat()
        session["status"] = "completed"
        with open(log_file, "w") as f:
            json.dump(session, f, indent=2)
    except Exception:
        pass
    
    running = False
    sys.exit(0)


def run_capture_cycle(cycle_num: int):
    """Run one full capture → classify → log cycle."""
    print(f"\n[Cycle {cycle_num}] {datetime.now().strftime('%H:%M:%S')} — Capturing...")
    
    try:
        # Build context snapshot
        snapshot = build_context_snapshot(previous_tasks=previous_tasks)
        
        # Skip if deeply idle — saves API costs
        if snapshot["idle_seconds"] > IDLE_SKIP_THRESHOLD:
            print(f"[Cycle {cycle_num}] Skipping — idle for {snapshot['idle_seconds']:.0f}s")
            return
        
        # Classify with Claude Vision
        print(f"[Cycle {cycle_num}] Sending to Claude...")
        result = classify_snapshot(snapshot)
        
        # Display result
        print_classification(result)
        
        # Log result locally
        append_to_log(result)
        
        # Transmit to Supabase cloud
        transmitted = transmit_capture(result)
        if transmitted:
            print(f"  ☁️  Transmitted to cloud")
        
        # Update context for next cycle
        update_previous_tasks(result)
        
        # Flag high value automation opportunities
        if result.get("automation_potential") == "high":
            print(f"  ⚡ HIGH AUTOMATION OPPORTUNITY DETECTED")
        
        if "high_value_automation" in result.get("flags", []):
            print(f"  ⚡ HIGH VALUE AUTOMATION FLAG")
            
    except json.JSONDecodeError as e:
        print(f"[Cycle {cycle_num}] Claude response parse error: {e}")
    except Exception as e:
        print(f"[Cycle {cycle_num}] Error: {e}")
        import traceback
        traceback.print_exc()


def main():
    global running
    
    # Setup signal handler for graceful shutdown
    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)
    
    # Initialize
    setup()
    
    # Start input listeners
    print("Starting input listeners...")
    start_input_listeners()
    time.sleep(1)
    
    print("Agent running. Press Ctrl+C to stop.\n")
    
    cycle_num = 1
    
    # Run first capture immediately
    run_capture_cycle(cycle_num)
    cycle_num += 1
    
    # Then loop every CAPTURE_INTERVAL seconds
    while running:
        # Wait for next interval
        next_capture = time.time() + CAPTURE_INTERVAL
        while time.time() < next_capture and running:
            time.sleep(1)
        
        if running:
            run_capture_cycle(cycle_num)
            cycle_num += 1


if __name__ == "__main__":
    main()
