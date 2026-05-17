import os
import json
from datetime import datetime, timezone
from pathlib import Path

import requests


def _utc_iso() -> str:
    """UTC ISO 8601 with Z suffix. Use for all timestamps that land in
    Supabase timestamptz columns so they're unambiguous regardless of the
    agent host's local timezone."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

QUEUE_FILE = Path(os.environ.get('APPDATA', '.')) / 'Groundwork' / 'transmit_queue.json'


def _headers(supabase_anon_key: str) -> dict:
    return {
        "apikey": supabase_anon_key,
        "Authorization": f"Bearer {supabase_anon_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def _build_payload(snapshot: dict, classification: dict, session_id: str, config: dict) -> dict:
    idle_seconds = snapshot.get("idle_seconds", 0)
    return {
        "employee_id": config["employee_id"],
        "business_id": config["business_id"],
        "session_id": session_id,
        "captured_at": snapshot.get("timestamp"),
        "task": classification.get("task"),
        "category": classification.get("category"),
        "software": classification.get("software"),
        "activity_level": classification.get("activity_level"),
        "confidence": classification.get("confidence"),
        "automation_potential": classification.get("automation_potential"),
        "workflow_step": classification.get("workflow_step"),
        "trigger": classification.get("trigger"),
        "reasoning": classification.get("reasoning"),
        "capabilities": classification.get("capabilities", []),
        "active_window": snapshot.get("active_window"),
        "active_url": snapshot.get("active_url"),
        "keystrokes": snapshot.get("keystrokes_last_90s", 0),
        "mouse_clicks": snapshot.get("mouse_clicks_last_90s", 0),
        "copy_paste_events": snapshot.get("copy_paste_events_last_90s", 0),
        "idle_seconds": idle_seconds,
        "is_idle": idle_seconds > 60,
        # raw_json + flags columns were dropped in migration 0009; the
        # classifier's `flags` output stays in the local result dict for
        # logging (see classify.print_classification) but isn't sent.
    }


def transmit_capture(snapshot: dict, classification: dict, session_id: str, config: dict) -> bool:
    """Send a classified capture to Supabase. Queues locally on failure."""
    supabase_url = config.get("supabase_url")
    supabase_key = config.get("supabase_anon_key")
    if not supabase_url or not supabase_key:
        return True  # local-only mode (dev)

    payload = _build_payload(snapshot, classification, session_id, config)

    try:
        response = requests.post(
            f"{supabase_url}/rest/v1/captures",
            headers=_headers(supabase_key),
            json=payload,
            timeout=10,
        )
        if response.status_code in (200, 201):
            return True
        print(f"Transmission failed: {response.status_code} {response.text}")
        _queue_locally(payload)
        return False
    except requests.exceptions.RequestException as e:
        print(f"Transmission error: {e}")
        _queue_locally(payload)
        return False


def _queue_locally(payload: dict) -> None:
    try:
        QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
        queue = []
        if QUEUE_FILE.exists():
            queue = json.loads(QUEUE_FILE.read_text())
        queue.append({
            "payload": payload,
            "queued_at": _utc_iso(),
            "retry_count": 0,
        })
        QUEUE_FILE.write_text(json.dumps(queue, indent=2))
    except Exception as e:
        print(f"Queue write error: {e}")


def flush_queue(config: dict) -> None:
    """Retry queued transmissions. Call at startup and periodically."""
    if not QUEUE_FILE.exists():
        return
    supabase_url = config.get("supabase_url")
    supabase_key = config.get("supabase_anon_key")
    if not supabase_url or not supabase_key:
        return

    try:
        queue = json.loads(QUEUE_FILE.read_text())
        if not queue:
            return

        print(f"Flushing {len(queue)} queued captures...")
        remaining = []
        for item in queue:
            try:
                response = requests.post(
                    f"{supabase_url}/rest/v1/captures",
                    headers=_headers(supabase_key),
                    json=item["payload"],
                    timeout=10,
                )
                if response.status_code not in (200, 201):
                    item["retry_count"] = item.get("retry_count", 0) + 1
                    if item["retry_count"] < 5:
                        remaining.append(item)
            except Exception:
                item["retry_count"] = item.get("retry_count", 0) + 1
                if item["retry_count"] < 5:
                    remaining.append(item)

        QUEUE_FILE.write_text(json.dumps(remaining, indent=2))
        if remaining:
            print(f"{len(remaining)} captures still queued for retry")
    except Exception as e:
        print(f"Queue flush error: {e}")


def create_session(config: dict) -> str:
    """Register a new session in Supabase and return its id."""
    supabase_url = config.get("supabase_url")
    supabase_key = config.get("supabase_anon_key")
    if not supabase_url or not supabase_key:
        return "local-session"

    payload = {
        "employee_id": config["employee_id"],
        "business_id": config["business_id"],
        "status": "active",
    }
    try:
        response = requests.post(
            f"{supabase_url}/rest/v1/sessions",
            headers={**_headers(supabase_key), "Prefer": "return=representation"},
            json=payload,
            timeout=10,
        )
        if response.status_code in (200, 201):
            session = response.json()
            if isinstance(session, list) and session:
                return session[0].get("id", "local-session")
        return "local-session"
    except Exception:
        return "local-session"


def end_session(session_id: str, total_captures: int, config: dict) -> None:
    supabase_url = config.get("supabase_url")
    supabase_key = config.get("supabase_anon_key")
    if not supabase_url or not supabase_key or session_id == "local-session":
        return
    try:
        requests.patch(
            f"{supabase_url}/rest/v1/sessions?id=eq.{session_id}",
            headers=_headers(supabase_key),
            json={
                "status": "completed",
                "total_captures": total_captures,
                "ended_at": _utc_iso(),
            },
            timeout=10,
        )
    except Exception:
        pass
