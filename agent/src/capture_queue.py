"""
SQLite-backed local queue for captures that failed to transmit.

When a POST to /api/captures fails (Vercel outage, employee laptop on
spotty hotel wifi, agent-side connection error, non-2xx response), the
capture is queued here and retried at the top of every subsequent
capture cycle. Five oldest items are attempted per cycle so a long
backlog drains over a few minutes rather than slamming the API in one
burst.

Drop policy: a queued item is purged when either
  - attempts >= MAX_ATTEMPTS (20), or
  - captured_at is older than MAX_AGE_HOURS (48 hours)

Both signals indicate the capture is stale or the remote is persistently
broken; further retries waste bandwidth and risk inserting hours-old
classifications into the dashboard as if they were live activity.

Replaces the older JSON-file queue (transmit_queue.json). On first init,
any existing JSON queue is migrated into SQLite and the JSON file
deleted, so v0.5.4 → v0.5.5 upgrades don't lose pending captures.

This module is intentionally defensive — every public function catches
its own exceptions and returns a safe default. The capture loop must
never crash because the queue is broken.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Callable, Optional

from groundwork_logging import get_logger


# Default queue location matches the agent's other on-disk state. The
# resolver here mirrors main.py's CONFIG_DIR computation so unit tests
# can override the path without touching env vars.
def default_queue_path() -> Path:
    return Path(os.environ.get("APPDATA", ".")) / "Groundwork" / "queue.db"


# Spec-defined limits.
MAX_ATTEMPTS = 20
MAX_AGE_HOURS = 48
FLUSH_BATCH_SIZE = 5

# Module-level connection. Held open across the agent's lifetime so we
# don't pay the open() cost every enqueue/flush. None when init failed —
# all callers must tolerate this.
_conn: Optional[sqlite3.Connection] = None
_db_path: Optional[Path] = None


# ---- schema ----------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS capture_queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    payload      TEXT    NOT NULL,
    captured_at  TEXT    NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_attempt TEXT
);
"""


# ---- lifecycle -------------------------------------------------------------

def init(db_path: Optional[Path] = None) -> bool:
    """Open the SQLite queue at db_path (or the default APPDATA path)
    and create the table if missing. Returns True on success, False
    when init failed — caller logs a warning and continues without
    queueing. Also migrates the legacy JSON queue if present.

    Safe to call repeatedly; subsequent calls with the same path are
    no-ops. Calling with a different path closes the previous handle
    and opens the new one (used by tests)."""
    global _conn, _db_path
    log = get_logger()
    target = db_path or default_queue_path()

    if _conn is not None and _db_path == target:
        return True
    if _conn is not None and _db_path != target:
        try:
            _conn.close()
        except Exception:
            pass
        _conn = None

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False: the capture loop is single-threaded,
        # but pynput's input listeners spawn daemon threads. They don't
        # touch the queue today; flag is set defensively so a future
        # cross-thread write doesn't crash.
        conn = sqlite3.connect(str(target), check_same_thread=False)
        conn.execute(_SCHEMA)
        conn.commit()
        _conn = conn
        _db_path = target
        _migrate_json_queue_if_present()
        return True
    except Exception as e:
        log.warning(
            "capture queue init failed (%s: %s); continuing without queue",
            type(e).__name__,
            e,
        )
        _conn = None
        _db_path = None
        return False


def _migrate_json_queue_if_present() -> None:
    """One-time migration from the JSON queue that v0.5.4 and earlier
    used. Called from init(); never raises."""
    if _db_path is None:
        return
    legacy = _db_path.parent / "transmit_queue.json"
    if not legacy.exists():
        return
    log = get_logger()
    try:
        items = json.loads(legacy.read_text())
        if not isinstance(items, list):
            legacy.unlink()
            return
        migrated = 0
        for item in items:
            payload = item.get("payload") if isinstance(item, dict) else None
            if not isinstance(payload, dict):
                continue
            captured_at = payload.get("captured_at") or item.get("queued_at") or _now_iso()
            _enqueue_raw(payload, captured_at)
            migrated += 1
        legacy.unlink()
        if migrated:
            log.info("migrated %d captures from transmit_queue.json to SQLite queue", migrated)
    except Exception as e:
        log.warning(
            "JSON queue migration failed (%s: %s); leaving file in place",
            type(e).__name__,
            e,
        )


def close() -> None:
    """Close the SQLite handle. Used by tests and (in principle) clean
    shutdown. Never raises."""
    global _conn, _db_path
    if _conn is None:
        return
    try:
        _conn.close()
    except Exception:
        pass
    _conn = None
    _db_path = None


# ---- public ops ------------------------------------------------------------

def enqueue(payload: dict) -> bool:
    """Persist a capture payload for later retry. Returns True on
    success, False if the queue isn't initialized or the write failed.
    Uses payload['captured_at'] as the age-tracking timestamp; falls
    back to now if not present."""
    if _conn is None:
        return False
    log = get_logger()
    try:
        captured_at = payload.get("captured_at") if isinstance(payload, dict) else None
        if not isinstance(captured_at, str) or not captured_at:
            captured_at = _now_iso()
        return _enqueue_raw(payload, captured_at)
    except Exception as e:
        log.warning("queue enqueue failed: %s: %s", type(e).__name__, e)
        return False


def _enqueue_raw(payload: dict, captured_at: str) -> bool:
    if _conn is None:
        return False
    try:
        _conn.execute(
            "INSERT INTO capture_queue (payload, captured_at) VALUES (?, ?)",
            (json.dumps(payload), captured_at),
        )
        _conn.commit()
        return True
    except Exception:
        return False


def depth() -> int:
    """Number of items currently queued. Returns 0 when uninitialized
    or on read failure — callers can show "0 pending" without a special
    case."""
    if _conn is None:
        return 0
    try:
        cur = _conn.execute("SELECT COUNT(*) FROM capture_queue")
        row = cur.fetchone()
        return int(row[0]) if row else 0
    except Exception:
        return 0


def flush(
    transmit_fn: Callable[[dict], bool],
    max_items: int = FLUSH_BATCH_SIZE,
) -> tuple[int, int]:
    """Drain up to max_items queued captures oldest-first.

    For each item:
      - call transmit_fn(payload). True = posted successfully; row is deleted.
        False = treat as another failed attempt; increment attempts and
        update last_attempt.
      - If the resulting attempts >= MAX_ATTEMPTS OR the captured_at is
        older than MAX_AGE_HOURS, drop the row and log it.

    Also runs a stale-purge pass before the flush so a backlog of
    already-expired rows can be reaped without each one needing a real
    transmit attempt.

    Returns (sent_count, dropped_count) for caller logging. Errors are
    swallowed — the capture loop must never crash because flush failed.
    """
    if _conn is None:
        return (0, 0)
    log = get_logger()
    dropped = _purge_stale()
    sent = 0
    try:
        cur = _conn.execute(
            "SELECT id, payload, captured_at, attempts FROM capture_queue "
            "ORDER BY id ASC LIMIT ?",
            (max_items,),
        )
        rows = cur.fetchall()
    except Exception as e:
        log.warning("queue flush read failed: %s: %s", type(e).__name__, e)
        return (0, dropped)

    for row_id, payload_text, captured_at, attempts in rows:
        try:
            payload = json.loads(payload_text)
        except Exception:
            # Corrupt row — purge it rather than retry forever.
            _delete(row_id)
            dropped += 1
            log.warning("dropping unreadable queue row id=%s", row_id)
            continue

        try:
            ok = bool(transmit_fn(payload))
        except Exception as e:
            # transmit_fn isn't supposed to raise, but we promise not to
            # crash the loop regardless.
            log.warning("queue transmit_fn raised: %s: %s", type(e).__name__, e)
            ok = False

        if ok:
            _delete(row_id)
            sent += 1
            continue

        new_attempts = (attempts or 0) + 1
        if new_attempts >= MAX_ATTEMPTS or _is_stale(captured_at):
            _delete(row_id)
            dropped += 1
            log.warning(
                "dropping stale capture after %d attempts (captured_at=%s)",
                new_attempts,
                captured_at,
            )
            continue

        try:
            _conn.execute(
                "UPDATE capture_queue SET attempts = ?, last_attempt = ? WHERE id = ?",
                (new_attempts, _now_iso(), row_id),
            )
            _conn.commit()
        except Exception:
            pass
    return (sent, dropped)


# ---- helpers ---------------------------------------------------------------

def _delete(row_id: int) -> None:
    if _conn is None:
        return
    try:
        _conn.execute("DELETE FROM capture_queue WHERE id = ?", (row_id,))
        _conn.commit()
    except Exception:
        pass


def _purge_stale() -> int:
    """Drop rows that are already past the expiry thresholds. Cheap to
    run every flush; covers the case where the agent was offline for
    days and a backlog needs reaping without per-item transmit
    attempts."""
    if _conn is None:
        return 0
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=MAX_AGE_HOURS)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    try:
        cur = _conn.execute(
            "DELETE FROM capture_queue WHERE captured_at < ? OR attempts >= ?",
            (cutoff, MAX_ATTEMPTS),
        )
        _conn.commit()
        return cur.rowcount or 0
    except Exception:
        return 0


def _is_stale(captured_at: str) -> bool:
    """True iff captured_at is older than MAX_AGE_HOURS. Returns False
    on parse failure so an unparseable timestamp doesn't cause immediate
    drop — flush() will retry the row normally."""
    try:
        # Normalize the trailing Z to UTC offset for fromisoformat.
        norm = captured_at.replace("Z", "+00:00")
        ts = datetime.fromisoformat(norm)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - ts
        return age.total_seconds() >= MAX_AGE_HOURS * 3600
    except Exception:
        return False


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
