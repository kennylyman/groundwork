"""
Unit tests for the auto-update logic.

Covers the agent-side of the min_supported_version flow — given an old
current_version and a release manifest from /api/agent-version, the
agent must decide to perform a hard update. This is the path that
forces a stuck fleet onto a new build (e.g., to roll out the
captures-via-server-endpoint change in 0.5.0).

Run from the agent/ directory:
    source venv/bin/activate
    PYTHONPATH=src python -m pytest tests/ -v

Or via the bundled `python -m unittest`:
    PYTHONPATH=src python -m unittest tests.test_updater
"""

import os
import sys
import unittest
from pathlib import Path

# Make `import updater` work without polluting sys.path globally.
SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import updater  # noqa: E402


class VersionCompareTests(unittest.TestCase):
    def test_strict_less_than(self):
        self.assertTrue(updater.version_lt("0.4.0", "0.5.0"))
        self.assertTrue(updater.version_lt("0.5.0", "0.5.1"))
        self.assertTrue(updater.version_lt("0.5.0", "1.0.0"))

    def test_equal_not_less(self):
        self.assertFalse(updater.version_lt("0.5.0", "0.5.0"))

    def test_greater_not_less(self):
        self.assertFalse(updater.version_lt("0.6.0", "0.5.0"))

    def test_null_floor_means_no_force(self):
        # No min_supported set on the server -> no version is "below" it.
        self.assertFalse(updater.version_lt("0.1.0", None))

    def test_dev_build_is_always_oldest(self):
        # _version.py defaults to "0.0.0-dev" outside of a CI-baked build.
        # The "-dev" suffix is stripped and the numeric prefix is (0,0,0),
        # which is older than any published release.
        self.assertTrue(updater.version_lt("0.0.0-dev", "0.4.0"))


class DecideActionTests(unittest.TestCase):
    """The end-to-end logic an agent runs on every /api/agent-version
    response. Tests the three-way decision: hard / soft / none."""

    def test_hard_update_when_below_min_supported(self):
        # The exact scenario the min_supported flag exists for: customer
        # is stuck on an old build, owner flips is_min_supported on a
        # newer version, and the agent has to force-update on next check.
        release = {
            "latest_version": "0.5.0",
            "min_supported_version": "0.5.0",
        }
        self.assertEqual(updater.decide_action("0.4.0", release), "hard")
        self.assertEqual(updater.decide_action("0.4.1", release), "hard")
        self.assertEqual(updater.decide_action("0.0.0-dev", release), "hard")

    def test_hard_takes_precedence_over_soft(self):
        # Both conditions met (below latest AND below min_supported) ->
        # hard wins. Important: don't let a soft update sneak past a
        # forced upgrade.
        release = {
            "latest_version": "0.6.0",
            "min_supported_version": "0.5.0",
        }
        self.assertEqual(updater.decide_action("0.4.0", release), "hard")

    def test_soft_update_when_below_latest_but_above_min(self):
        release = {
            "latest_version": "0.6.0",
            "min_supported_version": "0.5.0",
        }
        self.assertEqual(updater.decide_action("0.5.0", release), "soft")
        self.assertEqual(updater.decide_action("0.5.1", release), "soft")

    def test_none_when_at_latest(self):
        release = {
            "latest_version": "0.5.0",
            "min_supported_version": "0.5.0",
        }
        self.assertEqual(updater.decide_action("0.5.0", release), "none")

    def test_none_when_release_missing(self):
        self.assertEqual(updater.decide_action("0.5.0", None), "none")

    def test_none_when_no_min_supported_and_at_latest(self):
        release = {
            "latest_version": "0.5.0",
            "min_supported_version": None,
        }
        self.assertEqual(updater.decide_action("0.5.0", release), "none")

    def test_soft_when_no_min_supported_but_below_latest(self):
        release = {
            "latest_version": "0.6.0",
            "min_supported_version": None,
        }
        self.assertEqual(updater.decide_action("0.5.0", release), "soft")


class DownloadUrlSafetyTests(unittest.TestCase):
    """Defense-in-depth check that the agent refuses to download from
    anywhere but GitHub-owned hosts, even if the DB row is compromised."""

    def test_allows_github_subdomains(self):
        for url in (
            "https://github.com/owner/repo/releases/download/latest/Groundwork.exe",
            "https://api.github.com/repos/...",
            "https://objects.githubusercontent.com/asset/123",
            "https://release-assets.githubusercontent.com/asset/123",
        ):
            ok, reason = updater._is_safe_download_url(url)
            self.assertTrue(ok, f"should allow {url}: {reason}")

    def test_blocks_off_host(self):
        for url in (
            "http://github.com/asset",                  # http
            "https://evil.com/asset",                   # off-host
            "https://github.com.evil.com/asset",        # suffix-injection
            "https://githubusercontent.com.evil.com/x", # suffix-injection
            "",
            None,
            "ftp://github.com/file",
        ):
            ok, _ = updater._is_safe_download_url(url)
            self.assertFalse(ok, f"should block {url!r}")


if __name__ == "__main__":
    unittest.main()
