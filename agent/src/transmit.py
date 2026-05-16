import requests
import json
import os
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
EMPLOYEE_ID = os.getenv("EMPLOYEE_ID")
BUSINESS_ID = os.getenv("BUSINESS_ID")
SESSION_ID = os.getenv("SESSION_ID")

# Local queue for failed transmissions
QUEUE_FILE = Path("../logs/transmit_queue.json")


def get_headers():
    return {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }


def transmit_capture(result: dict) -> bool:
    """
    Send a classified capture to Supabase.
    Returns True if successful, False if failed (will queue locally).
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        # Running locally without Supabase — skip transmission
        return True

    payload = {
        "employee_id": EMPLOYEE_ID,
        "business_id": BUSINESS_ID,
        "session_id": SESSION_ID,
        "captured_at": result.get("timestamp"),
        "task": result.get("task"),
        "category": result.get("category"),
        "software": result.get("software"),
        "activity_level": result.get("activity_level"),
        "confidence": result.get("confidence"),
        "automation_potential": result.get("automation_potential"),
        "workflow_step": result.get("workflow_step"),
        "trigger": result.get("trigger"),
        "reasoning": result.get("reasoning"),
        "flags": result.get("flags", []),
        "active_window": result.get("active_window"),
        "active_url": result.get("active_url"),
        "keystrokes": result.get("keystrokes", 0),
        "idle_seconds": result.get("idle_seconds", 0),
        "is_idle": result.get("idle_seconds", 0) > 60,
        "raw_json": result
    }

    try:
        response = requests.post(
            f"{SUPABASE_URL}/rest/v1/captures",
            headers=get_headers(),
            json=payload,
            timeout=10
        )

        if response.status_code in (200, 201):
            return True
        else:
            print(f"Transmission failed: {response.status_code} {response.text}")
            queue_locally(payload)
            return False

    except requests.exceptions.ConnectionError:
        print("No internet connection — queuing locally")
        queue_locally(payload)
        return False
    except requests.exceptions.Timeout:
        print("Transmission timeout — queuing locally")
        queue_locally(payload)
        return False
    except Exception as e:
        print(f"Transmission error: {e}")
        queue_locally(payload)
        return False


def queue_locally(payload: dict):
    """Save failed transmissions to local queue for retry."""
    try:
        queue = []
        if QUEUE_FILE.exists():
            with open(QUEUE_FILE, "r") as f:
                queue = json.load(f)

        queue.append({
            "payload": payload,
            "queued_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "retry_count": 0
        })

        with open(QUEUE_FILE, "w") as f:
            json.dump(queue, f, indent=2)
    except Exception as e:
        print(f"Queue write error: {e}")


def flush_queue():
    """
    Retry queued transmissions.
    Call this at agent startup and periodically.
    """
    if not QUEUE_FILE.exists():
        return

    try:
        with open(QUEUE_FILE, "r") as f:
            queue = json.load(f)

        if not queue:
            return

        print(f"Flushing {len(queue)} queued captures...")
        remaining = []

        for item in queue:
            try:
                response = requests.post(
                    f"{SUPABASE_URL}/rest/v1/captures",
                    headers=get_headers(),
                    json=item["payload"],
                    timeout=10
                )

                if response.status_code in (200, 201):
                    print(f"Queued capture transmitted successfully")
                else:
                    item["retry_count"] = item.get("retry_count", 0) + 1
                    if item["retry_count"] < 5:
                        remaining.append(item)

            except Exception:
                item["retry_count"] = item.get("retry_count", 0) + 1
                if item["retry_count"] < 5:
                    remaining.append(item)

        with open(QUEUE_FILE, "w") as f:
            json.dump(remaining, f, indent=2)

        if remaining:
            print(f"{len(remaining)} captures still queued for retry")

    except Exception as e:
        print(f"Queue flush error: {e}")


def create_session() -> str:
    """Register a new session in Supabase and return session ID."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return "local-session"

    payload = {
        "employee_id": EMPLOYEE_ID,
        "business_id": BUSINESS_ID,
        "status": "active"
    }

    try:
        response = requests.post(
            f"{SUPABASE_URL}/rest/v1/sessions",
            headers={**get_headers(), "Prefer": "return=representation"},
            json=payload,
            timeout=10
        )

        if response.status_code in (200, 201):
            session = response.json()
            if isinstance(session, list) and session:
                return session[0].get("id", "local-session")
        return "local-session"

    except Exception:
        return "local-session"


def end_session(session_id: str, total_captures: int):
    """Mark session as completed in Supabase."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY or session_id == "local-session":
        return

    try:
        requests.patch(
            f"{SUPABASE_URL}/rest/v1/sessions?id=eq.{session_id}",
            headers=get_headers(),
            json={
                "status": "completed",
                "total_captures": total_captures,
                "ended_at": time.strftime("%Y-%m-%dT%H:%M:%S")
            },
            timeout=10
        )
    except Exception:
        pass
