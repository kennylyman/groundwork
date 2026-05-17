"""
Agent auto-update.

Public entry points used by main.py:
  - check_for_update(config, current_version) -> ReleaseInfo | None
      Calls /api/agent-version with this employee's id (so the server can
      record a heartbeat). Returns the latest release metadata, or None
      on any error. Network failure is non-fatal — fail open.

  - decide_action(current_version, release) -> "hard" | "soft" | "none"
      Pure function. Compares versions and tells main.py whether to
      update immediately (hard), defer until idle (soft), or do nothing.

  - perform_update(release, log)
      Downloads the new exe, verifies its SHA256, writes updater.bat, and
      spawns it detached. Exits the current process on success. Logs
      every step. No-ops on non-Windows and on non-frozen interpreters
      so the dev environment never accidentally swaps a Python entry
      point.

The update mechanic uses a .bat file that:
  1. Waits 3s for the old agent to exit.
  2. Moves the current exe to <name>.old.exe (with retries — Windows file
     locks linger briefly after process exit).
  3. Moves the freshly-downloaded .new.exe into place.
  4. Spawns the new agent.
  5. Waits 30s and checks the new agent is still running. If not, rolls
     back to the old exe and starts it.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, Literal

import requests


ReleaseInfo = dict
LogFn = Callable[[str], None]
UpdateAction = Literal["hard", "soft", "none"]


# ---------------------------------------------------------------- version --

def _parse_version(v: str | None) -> tuple[int, ...]:
    """Best-effort numeric tuple. Non-numeric components (e.g., "0.0.0-dev")
    fall back to (0, 0, 0) so a dev build is always "older" than any
    published release."""
    if not v:
        return (0, 0, 0)
    raw = v.strip().split("-", 1)[0]  # strip "-dev" or "-rc" suffixes
    try:
        return tuple(int(p) for p in raw.split("."))
    except Exception:
        return (0, 0, 0)


def version_lt(a: str | None, b: str | None) -> bool:
    """True if `a` is strictly older than `b`. NULL `b` means "no floor" → False."""
    if not b:
        return False
    if not a:
        return True
    return _parse_version(a) < _parse_version(b)


def decide_action(current_version: str, release: ReleaseInfo | None) -> UpdateAction:
    if not release:
        return "none"
    min_supported = release.get("min_supported_version")
    latest = release.get("latest_version")
    if version_lt(current_version, min_supported):
        return "hard"
    if version_lt(current_version, latest):
        return "soft"
    return "none"


# ---------------------------------------------------------------- network --

def check_for_update(
    activation_url: str,
    employee_id: str | None,
    current_version: str,
    log: LogFn,
) -> ReleaseInfo | None:
    """Fetch latest release info. Returns None on any failure — never raises.

    `activation_url` is e.g. https://gwork.tech/api/activate — we swap
    the path to /api/agent-version so the agent doesn't need a separate
    config knob for it.
    """
    try:
        base = activation_url.rsplit("/", 1)[0]  # strip "/activate"
        url = base + "/agent-version"
        params: dict[str, str] = {"current_version": current_version}
        if employee_id:
            params["employee_id"] = employee_id
        response = requests.get(url, params=params, timeout=10)
        if response.status_code != 200:
            log(f"update check: HTTP {response.status_code} {response.text[:120]}")
            return None
        return response.json()
    except requests.exceptions.RequestException as e:
        log(f"update check: network error ({e}) — continuing")
        return None
    except Exception as e:
        log(f"update check: unexpected error ({e}) — continuing")
        return None


# ---------------------------------------------------------------- download -

def _sha256_of_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _download_to(url: str, dest: Path, log: LogFn) -> bool:
    log(f"update: downloading {url}")
    try:
        with requests.get(url, stream=True, timeout=120, allow_redirects=True) as r:
            if r.status_code != 200:
                log(f"update: download HTTP {r.status_code}")
                return False
            with open(dest, "wb") as f:
                for chunk in r.iter_content(chunk_size=65536):
                    if chunk:
                        f.write(chunk)
        log(f"update: downloaded {dest} ({dest.stat().st_size} bytes)")
        return True
    except Exception as e:
        log(f"update: download error: {e}")
        return False


# ---------------------------------------------------------------- updater --

_UPDATER_BAT = r"""@echo off
setlocal enabledelayedexpansion

REM Groundwork auto-updater.
REM Args: %1 = current exe path, %2 = new exe path

set "OLD_EXE=%~1"
set "NEW_EXE=%~2"
set "BACKUP_EXE=%~1.old"
set "LOG=%~dp0updater.log"

echo [%date% %time%] updater start old=%OLD_EXE% new=%NEW_EXE% >> "%LOG%"

REM Let the old agent fully exit and release its file lock.
timeout /t 3 /nobreak >nul

REM Rename current exe to backup. File locks can linger; retry briefly.
set RETRIES=0
:retry_rename_current
move /Y "%OLD_EXE%" "%BACKUP_EXE%" >nul 2>&1
if !errorlevel! neq 0 (
    set /a RETRIES+=1
    if !RETRIES! lss 15 (
        timeout /t 1 /nobreak >nul
        goto retry_rename_current
    )
    echo [%date% %time%] FAIL: could not rename current exe >> "%LOG%"
    exit /b 1
)

REM Move new exe into place.
move /Y "%NEW_EXE%" "%OLD_EXE%" >nul 2>&1
if !errorlevel! neq 0 (
    echo [%date% %time%] FAIL: could not move new exe — rolling back >> "%LOG%"
    move /Y "%BACKUP_EXE%" "%OLD_EXE%" >nul 2>&1
    exit /b 1
)

echo [%date% %time%] starting new agent >> "%LOG%"
start "" "%OLD_EXE%"

REM Watchdog: confirm the new agent is alive 30s after launch.
timeout /t 30 /nobreak >nul
tasklist /FI "IMAGENAME eq Groundwork.exe" 2>nul | find /i "Groundwork.exe" >nul
if !errorlevel! neq 0 (
    echo [%date% %time%] new agent did not survive — rolling back >> "%LOG%"
    if exist "%OLD_EXE%" move /Y "%OLD_EXE%" "%~1.failed" >nul 2>&1
    move /Y "%BACKUP_EXE%" "%OLD_EXE%" >nul 2>&1
    start "" "%OLD_EXE%"
    exit /b 1
)

echo [%date% %time%] update succeeded >> "%LOG%"
exit /b 0
"""


def _write_updater_bat(config_dir: Path) -> Path:
    path = config_dir / "updater.bat"
    path.write_text(_UPDATER_BAT, encoding="utf-8")
    return path


def _spawn_detached(bat_path: Path, old_exe: str, new_exe: str, log: LogFn) -> None:
    """Spawn updater.bat fully detached so it survives this process exiting."""
    DETACHED_PROCESS = 0x00000008
    CREATE_NEW_PROCESS_GROUP = 0x00000200
    CREATE_NO_WINDOW = 0x08000000
    flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
    subprocess.Popen(
        ["cmd.exe", "/c", str(bat_path), old_exe, new_exe],
        creationflags=flags,
        close_fds=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    log(f"update: spawned updater.bat (pid is detached)")


def perform_update(
    release: ReleaseInfo,
    config_dir: Path,
    log: LogFn,
) -> bool:
    """Carry out the update. Exits the process on success. Returns False on
    any failure (so the caller can continue running on the current build).
    Safe to call on non-Windows / non-frozen Python — it logs and no-ops.
    """
    if sys.platform != "win32":
        log("update: skipping (not Windows)")
        return False
    if not getattr(sys, "frozen", False):
        log("update: skipping (not a frozen PyInstaller exe)")
        return False

    download_url = release.get("download_url")
    expected_sha = (release.get("sha256") or "").strip().lower()
    latest = release.get("latest_version")
    if not download_url or not expected_sha:
        log("update: release info missing download_url / sha256 — skipping")
        return False

    new_exe_path = config_dir / "agent.new.exe"
    try:
        if new_exe_path.exists():
            new_exe_path.unlink()
    except Exception as e:
        log(f"update: could not clear prior new exe: {e}")
        return False

    if not _download_to(download_url, new_exe_path, log):
        return False

    actual_sha = _sha256_of_file(new_exe_path).lower()
    if actual_sha != expected_sha:
        log(f"update: sha256 mismatch (expected {expected_sha}, got {actual_sha}) — discarding")
        try:
            new_exe_path.unlink()
        except Exception:
            pass
        return False
    log(f"update: sha256 verified, preparing swap to v{latest}")

    bat_path = _write_updater_bat(config_dir)
    current_exe = sys.executable

    try:
        _spawn_detached(bat_path, current_exe, str(new_exe_path), log)
    except Exception as e:
        log(f"update: failed to spawn updater.bat: {e}")
        return False

    log("update: exiting so updater.bat can swap the exe")
    # Sleep briefly so the log line flushes before exit.
    time.sleep(0.5)
    sys.exit(0)
