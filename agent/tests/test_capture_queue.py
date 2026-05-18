"""
Unit tests for the SQLite-backed local capture queue (v0.5.5).

Covers the spec's contract:
  - enqueue on transmit failure (write succeeds)
  - flush on next cycle (oldest-first, up to 5 per call)
  - retry: failed transmit increments attempts, item stays queued
  - drop after 20 attempts (with log line content)
  - drop after 48 hours (age-based purge)
  - no-op when init never ran (defensive)

Run from agent/:
    source venv/bin/activate
    PYTHONPATH=src python -m unittest tests.test_capture_queue -v
"""

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import capture_queue  # noqa: E402
from groundwork_logging import configure_logging  # noqa: E402


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _iso_hours_ago(hours: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def _sample_payload(label: str = "x") -> dict:
    return {
        "employee_id": "emp-1",
        "business_id": "biz-1",
        "task": f"task-{label}",
        "captured_at": _iso_now(),
    }


class CaptureQueueTests(unittest.TestCase):
    def setUp(self):
        # Each test gets its own SQLite file so state doesn't leak.
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        self.db_path = Path(self._tmp.name)
        # Configure logging once to a throwaway path so warning() calls
        # inside the queue don't crash on uninitialized handlers.
        configure_logging(self.db_path.with_suffix(".log"))
        capture_queue.close()  # clear any leftover state from prior tests
        ok = capture_queue.init(self.db_path)
        self.assertTrue(ok, "queue init should succeed against a fresh tempfile")

    def tearDown(self):
        capture_queue.close()
        try:
            os.unlink(self.db_path)
        except FileNotFoundError:
            pass
        log_path = self.db_path.with_suffix(".log")
        try:
            os.unlink(log_path)
        except FileNotFoundError:
            pass

    # ---- enqueue on transmit failure ----

    def test_enqueue_writes_to_queue(self):
        self.assertEqual(capture_queue.depth(), 0)
        ok = capture_queue.enqueue(_sample_payload("a"))
        self.assertTrue(ok)
        self.assertEqual(capture_queue.depth(), 1)

    def test_enqueue_persists_multiple_payloads(self):
        for i in range(7):
            capture_queue.enqueue(_sample_payload(str(i)))
        self.assertEqual(capture_queue.depth(), 7)

    # ---- flush on next cycle ----

    def test_flush_calls_transmit_for_each_item_oldest_first(self):
        for i in range(3):
            capture_queue.enqueue(_sample_payload(str(i)))
        seen_labels: list[str] = []

        def transmit_ok(payload):
            seen_labels.append(payload["task"])
            return True

        sent, dropped = capture_queue.flush(transmit_ok)
        self.assertEqual(sent, 3)
        self.assertEqual(dropped, 0)
        self.assertEqual(capture_queue.depth(), 0)
        # Oldest first: insertion order task-0, task-1, task-2.
        self.assertEqual(seen_labels, ["task-0", "task-1", "task-2"])

    def test_flush_max_5_items_per_call(self):
        for i in range(12):
            capture_queue.enqueue(_sample_payload(str(i)))

        call_count = {"n": 0}
        def transmit_ok(_):
            call_count["n"] += 1
            return True

        sent, _ = capture_queue.flush(transmit_ok)
        self.assertEqual(sent, 5)
        self.assertEqual(call_count["n"], 5)
        self.assertEqual(capture_queue.depth(), 7)  # 12 - 5

    # ---- retry on failure ----

    def test_failed_transmit_increments_attempts_keeps_item(self):
        capture_queue.enqueue(_sample_payload("retry"))
        def transmit_fail(_):
            return False
        sent, dropped = capture_queue.flush(transmit_fail)
        self.assertEqual(sent, 0)
        self.assertEqual(dropped, 0)
        self.assertEqual(capture_queue.depth(), 1)

        # Run flush a few more times — item should still be there with
        # incrementing attempts.
        for _ in range(3):
            capture_queue.flush(transmit_fail)
        self.assertEqual(capture_queue.depth(), 1)

        # Inspect the row to confirm attempts tracked.
        cur = capture_queue._conn.execute(
            "SELECT attempts FROM capture_queue"
        )
        attempts = cur.fetchone()[0]
        self.assertEqual(attempts, 4)  # 1 initial flush + 3 retry flushes

    # ---- drop after 20 attempts ----

    def test_drop_after_20_attempts(self):
        # Seed a row pre-set to attempts=19 so the next failure crosses
        # the threshold without 20 real round-trips.
        capture_queue._conn.execute(
            "INSERT INTO capture_queue (payload, captured_at, attempts) VALUES (?, ?, ?)",
            ('{"task": "near-death", "captured_at": "%s"}' % _iso_now(), _iso_now(), 19),
        )
        capture_queue._conn.commit()
        self.assertEqual(capture_queue.depth(), 1)

        def transmit_fail(_):
            return False

        sent, dropped = capture_queue.flush(transmit_fail)
        self.assertEqual(sent, 0)
        self.assertEqual(dropped, 1)
        self.assertEqual(capture_queue.depth(), 0)

    def test_does_not_drop_at_attempts_below_threshold(self):
        capture_queue._conn.execute(
            "INSERT INTO capture_queue (payload, captured_at, attempts) VALUES (?, ?, ?)",
            ('{"task": "still-trying", "captured_at": "%s"}' % _iso_now(), _iso_now(), 18),
        )
        capture_queue._conn.commit()

        def transmit_fail(_):
            return False

        sent, dropped = capture_queue.flush(transmit_fail)
        self.assertEqual(dropped, 0)
        self.assertEqual(capture_queue.depth(), 1)

    # ---- drop after 48 hours ----

    def test_drop_after_48_hours(self):
        # 49h ago — past the cutoff. _purge_stale() reaps it before
        # flush even attempts a transmit, so dropped should be 1 with
        # zero transmit_fn calls.
        capture_queue._conn.execute(
            "INSERT INTO capture_queue (payload, captured_at) VALUES (?, ?)",
            ('{"task": "ancient", "captured_at": "%s"}' % _iso_hours_ago(49), _iso_hours_ago(49)),
        )
        capture_queue._conn.commit()
        self.assertEqual(capture_queue.depth(), 1)

        calls = {"n": 0}
        def transmit_ok(_):
            calls["n"] += 1
            return True

        sent, dropped = capture_queue.flush(transmit_ok)
        self.assertEqual(sent, 0)
        self.assertEqual(dropped, 1)
        self.assertEqual(calls["n"], 0)
        self.assertEqual(capture_queue.depth(), 0)

    def test_keeps_items_under_48_hours(self):
        capture_queue._conn.execute(
            "INSERT INTO capture_queue (payload, captured_at) VALUES (?, ?)",
            ('{"task": "fresh-enough", "captured_at": "%s"}' % _iso_hours_ago(47), _iso_hours_ago(47)),
        )
        capture_queue._conn.commit()
        self.assertEqual(capture_queue.depth(), 1)

        sent, dropped = capture_queue.flush(lambda _: True)
        self.assertEqual(sent, 1)
        self.assertEqual(dropped, 0)

    # ---- defensive: uninitialized queue ----

    def test_enqueue_no_op_when_uninitialized(self):
        capture_queue.close()
        ok = capture_queue.enqueue(_sample_payload("z"))
        self.assertFalse(ok)
        self.assertEqual(capture_queue.depth(), 0)

    def test_flush_no_op_when_uninitialized(self):
        capture_queue.close()
        calls = {"n": 0}
        def transmit_ok(_):
            calls["n"] += 1
            return True
        sent, dropped = capture_queue.flush(transmit_ok)
        self.assertEqual((sent, dropped), (0, 0))
        self.assertEqual(calls["n"], 0)

    # ---- defensive: transmit_fn raising ----

    def test_flush_survives_transmit_fn_exception(self):
        capture_queue.enqueue(_sample_payload("boom"))
        def transmit_raises(_):
            raise RuntimeError("simulated provider failure")
        sent, dropped = capture_queue.flush(transmit_raises)
        # Treated as failed attempt: item stays, attempts=1.
        self.assertEqual(sent, 0)
        self.assertEqual(dropped, 0)
        self.assertEqual(capture_queue.depth(), 1)


if __name__ == "__main__":
    unittest.main()
