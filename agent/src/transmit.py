import os
from datetime import datetime, timezone

import requests

import capture_queue
from groundwork_logging import get_logger


def _utc_iso() -> str:
    """UTC ISO 8601 with Z suffix. Use for all timestamps that land in
    Supabase timestamptz columns so they're unambiguous regardless of the
    agent host's local timezone."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# Server-side ingestion endpoint. Replaces the direct anon-key POST to
# Supabase. Override with GROUNDWORK_CAPTURES_URL for dev / staging.
CAPTURES_URL = os.environ.get(
    'GROUNDWORK_CAPTURES_URL',
    'https://gwork.tech/api/captures',
)


def _server_headers(install_token: str) -> dict:
    return {
        "X-Groundwork-Install-Token": install_token,
        "Content-Type": "application/json",
    }


def _supabase_headers(supabase_anon_key: str) -> dict:
    """Legacy direct-to-Supabase headers. Used only when the agent's
    config predates the install_token-in-config rollout."""
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
        # Which monitor (mss index) was captured. Always 1 (primary) for
        # single-monitor users; 2+ when the active window was on a
        # secondary monitor. Missing in payloads from agents older than
        # v0.5.1 — server defaults to null.
        "monitor_index": snapshot.get("monitor_index"),
        # raw_json + flags columns were dropped in migration 0009; the
        # classifier's `flags` output stays in the local result dict for
        # logging (see classify.print_classification) but isn't sent.
    }


def _post_via_server(payload: dict, install_token: str) -> requests.Response:
    """New path: POST to /api/captures with the install_token in the
    header. The server validates, rewrites employee_id/business_id to
    whatever the token says, and writes with service role."""
    return requests.post(
        CAPTURES_URL,
        headers=_server_headers(install_token),
        json=payload,
        timeout=10,
    )


def _post_via_supabase(payload: dict, supabase_url: str, supabase_key: str) -> requests.Response:
    """Legacy path: direct REST insert with anon key. Kept as a fallback
    for older configs that don't have install_token persisted yet. Will
    be removed once the captures_anon_insert RLS policy is tightened."""
    return requests.post(
        f"{supabase_url}/rest/v1/captures",
        headers=_supabase_headers(supabase_key),
        json=payload,
        timeout=10,
    )


def _try_send(payload: dict, config: dict) -> bool:
    """Attempt one POST with the appropriate path for this config.
    Returns True on 2xx, False on anything else (non-2xx OR network
    error). Never raises. Used by both transmit_capture (fresh capture
    path) and flush_queue (retry path).

    A 4xx is treated identically to a 5xx — both push the payload into
    the local queue. That's slightly wasteful for genuinely-bad
    payloads, but the queue has its own attempts/age expiry, so a 4xx
    spiral self-cleans within MAX_ATTEMPTS retries.
    """
    log = get_logger()
    install_token = config.get("install_token")
    supabase_url = config.get("supabase_url")
    supabase_key = config.get("supabase_anon_key")
    try:
        if install_token:
            response = _post_via_server(payload, install_token)
        elif supabase_url and supabase_key:
            response = _post_via_supabase(payload, supabase_url, supabase_key)
        else:
            # Local-only / dev mode — no remote configured. Treat as success
            # so we don't pile captures into the queue forever.
            return True
        if response.status_code in (200, 201):
            return True
        log.warning(
            "transmit non-2xx: HTTP %s %s",
            response.status_code,
            (response.text or "")[:200],
        )
        return False
    except requests.exceptions.RequestException as e:
        log.warning("transmit network error: %s: %s", type(e).__name__, e)
        return False


def transmit_capture(snapshot: dict, classification: dict, session_id: str, config: dict) -> bool:
    """Send a classified capture to the dashboard.

    On any failure (timeout, connection error, non-2xx response) the
    payload is enqueued to the SQLite queue and flushed on subsequent
    cycles. Returns True iff the live POST succeeded; queueing on
    failure does NOT count as success — the caller still logs
    "Transmit failed — queued locally"."""
    payload = _build_payload(snapshot, classification, session_id, config)
    if _try_send(payload, config):
        return True
    # Queue and report failure. capture_queue.enqueue() is itself
    # defensive — it returns False rather than raising if the SQLite
    # init never happened, so we don't compound a transmit failure
    # with a crash.
    capture_queue.enqueue(payload)
    return False


def flush_queue(config: dict) -> tuple[int, int]:
    """Drain up to 5 queued captures oldest-first. Called at the top
    of every capture cycle and at startup.

    Returns (sent, dropped) so the caller can log progress / surface
    stuck queues. Never raises."""
    def _transmit(payload: dict) -> bool:
        return _try_send(payload, config)

    return capture_queue.flush(_transmit)


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
            headers={**_supabase_headers(supabase_key), "Prefer": "return=representation"},
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
            headers=_supabase_headers(supabase_key),
            json={
                "status": "completed",
                "total_captures": total_captures,
                "ended_at": _utc_iso(),
            },
            timeout=10,
        )
    except Exception:
        pass
