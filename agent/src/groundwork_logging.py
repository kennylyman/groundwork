"""
Single-source logging configuration for the Groundwork agent.

Wraps Python's RotatingFileHandler so groundwork.log doesn't grow
unbounded on machines that have run for months. Format and path are
unchanged from the prior hand-rolled log() — purely a rotation wrapper
around the same write pattern.

Spec (v0.5.5):
  - Max file size: 5 MB
  - Keep 3 backup files (.1, .2, .3)
  - Path: %APPDATA%\\Groundwork\\groundwork.log on Windows,
          ./Groundwork/groundwork.log on macOS (APPDATA unset)
  - Format unchanged: [YYYY-MM-DD HH:MM:SS] message
  - If the file handler fails to initialize (permissions, disk full,
    sandbox), fall back to console logging and continue — logging
    setup must NEVER crash the agent

Usage:

    from groundwork_logging import configure_logging, get_logger
    configure_logging(LOG_FILE)         # called once at startup
    logger = get_logger()
    logger.info("agent started")        # same shape as the old log()

All modules share the same `groundwork` logger by calling get_logger().
configure_logging() is idempotent — calling it twice doesn't double up
handlers.
"""

from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path


LOGGER_NAME = "groundwork"

# Format mirrors what the old hand-rolled log() emitted:
#   [2026-05-18 23:34:17] message
# Keeping it identical means existing log-tail tooling / scripts / grep
# patterns keep working unchanged.
_FORMAT = "[%(asctime)s] %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# Rotation: 5 MB × 4 files (active + 3 backups) = 20 MB upper bound.
_MAX_BYTES = 5 * 1024 * 1024
_BACKUP_COUNT = 3


def configure_logging(log_path: Path) -> logging.Logger:
    """Idempotently configure the shared groundwork logger.

    Adds a RotatingFileHandler at log_path (5 MB × 3 backups) AND a
    StreamHandler for console visibility in dev. If the file handler
    can't be created (permission denied, disk full, parent dir
    unwritable), the console handler still gets added so logging keeps
    working — spec requirement.

    Both handlers swallow their own setup errors. If even console
    logging fails, the logger has no handlers and log calls become
    no-ops — the agent keeps running.
    """
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(logging.INFO)
    # Idempotent: don't stack handlers across re-config calls (e.g.
    # test suites that import + reconfigure).
    if logger.handlers:
        return logger

    formatter = logging.Formatter(_FORMAT, datefmt=_DATE_FORMAT)

    # --- File handler (rotating) ---
    file_ok = False
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.handlers.RotatingFileHandler(
            log_path,
            maxBytes=_MAX_BYTES,
            backupCount=_BACKUP_COUNT,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        file_ok = True
    except Exception as e:
        # Console handler below will still attach; the agent gets some
        # visibility even when the disk path is unwritable.
        try:
            print(
                f"[groundwork_logging] file handler init failed "
                f"({type(e).__name__}: {e}); falling back to console only"
            )
        except Exception:
            pass

    # --- Console handler (always, best-effort) ---
    # In PyInstaller --windowed builds, sys.stdout/stderr are None;
    # logging.StreamHandler defaults to stderr and would raise on emit.
    # Wrap the add in try/except so a missing stream doesn't break
    # logging setup. The file handler is the real path in production.
    try:
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
    except Exception:
        if not file_ok:
            # Both handlers failed — logger will be silent. Don't raise;
            # the agent must continue.
            pass

    # Don't propagate to root logger — it might be configured by
    # PyInstaller or a dependency and we'd get duplicate lines.
    logger.propagate = False
    return logger


def get_logger() -> logging.Logger:
    """Return the shared groundwork logger. Safe to call before
    configure_logging() — you just won't see anything until the
    handlers are attached."""
    return logging.getLogger(LOGGER_NAME)
