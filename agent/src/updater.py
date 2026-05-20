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
  2. Stages the new exe next to the old one (COPY, so it lives on the
     same NTFS volume — necessary for the atomic replace in step 4).
  3. Backs up the live exe via COPY (the live file stays intact through
     this step, eliminating the "no exe" crash window the prior
     move-rename approach had).
  4. Replaces the live exe via `move /Y` (NTFS MoveFileEx, atomic — the
     target is either the old or new bytes, never absent).
  5. Spawns the new agent.
  6. Waits 30s and checks the new agent is still running. If not, rolls
     back from the backup (also via atomic move).

On startup, cleanup_update_orphans() removes stale .new / .failed files
left behind by an interrupted update. The current exe is always intact
when we reach this point (otherwise it couldn't have started), so the
cleanup is purely housekeeping — the next update check will re-download
if needed.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, Literal
from urllib.parse import urlparse

import requests


ReleaseInfo = dict
LogFn = Callable[[str], None]
UpdateAction = Literal["hard", "soft", "none"]

# Defense in depth: even if SUPABASE_SERVICE_ROLE_KEY leaks and an attacker
# registers a malicious release row, the agent refuses to download from
# anywhere except GitHub. The sha256 verification handles content-level
# tampering at GitHub; this allowlist handles destination tampering at
# Supabase.
#
# GitHub Release downloads start at github.com but 302-redirect to
# objects.githubusercontent.com to serve the actual asset bytes, so both
# hosts (and their subdomains) need to be allowed.
ALLOWED_DOWNLOAD_HOST_SUFFIXES = ("github.com", "githubusercontent.com")

# Hard upper bound on the binary size. Today's exe is ~30 MB. 100 MB gives
# room for growth (extra deps, debug info) without letting a malicious or
# broken download_url fill the user's disk.
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024


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
        # X-Groundwork-Platform tells the server which release row to
        # return — Mac agents must NOT get the Windows .exe in the
        # response. Older Windows agents (pre-v0.5.9) never sent this
        # header; the server defaults to 'windows' for backwards compat.
        try:
            from platform_utils import detect_platform
            headers = {"X-Groundwork-Platform": detect_platform()}
        except Exception:
            headers = {}
        response = requests.get(url, params=params, headers=headers, timeout=10)
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


def _is_safe_download_url(url: str | None) -> tuple[bool, str]:
    """Validate scheme is https and host is one of the GitHub-owned suffixes.
    Returns (ok, reason). Handles initial URL and post-redirect URL.
    """
    if not isinstance(url, str) or not url:
        return False, "empty url"
    try:
        parsed = urlparse(url)
    except Exception as e:
        return False, f"unparseable url: {e}"
    if parsed.scheme != "https":
        return False, f"non-https scheme: {parsed.scheme!r}"
    host = (parsed.hostname or "").lower()
    if not host:
        return False, "no host"
    for suffix in ALLOWED_DOWNLOAD_HOST_SUFFIXES:
        if host == suffix or host.endswith("." + suffix):
            return True, ""
    return False, f"untrusted host: {host!r}"


def _download_to(url: str, dest: Path, log: LogFn) -> bool:
    log(f"update: downloading {url}")

    ok, reason = _is_safe_download_url(url)
    if not ok:
        log(f"update: refusing download — {reason}")
        return False

    try:
        with requests.get(url, stream=True, timeout=120, allow_redirects=True) as r:
            if r.status_code != 200:
                log(f"update: download HTTP {r.status_code}")
                return False

            # Defense in depth: if the redirect chain landed somewhere
            # other than https://github.com/, refuse. requests.url is the
            # FINAL URL after redirects.
            final_ok, final_reason = _is_safe_download_url(r.url)
            if not final_ok:
                log(f"update: refusing — redirect went off-host: {final_reason} ({r.url})")
                return False

            # Bound the download before we start writing. A malicious or
            # broken endpoint could otherwise stream forever and fill the
            # user's disk.
            content_length_raw = r.headers.get("Content-Length")
            if content_length_raw:
                try:
                    declared = int(content_length_raw)
                except ValueError:
                    declared = -1
                if declared > MAX_DOWNLOAD_BYTES:
                    log(
                        f"update: refusing — Content-Length {declared} "
                        f"exceeds cap {MAX_DOWNLOAD_BYTES}"
                    )
                    return False

            written = 0
            with open(dest, "wb") as f:
                for chunk in r.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > MAX_DOWNLOAD_BYTES:
                        log(
                            f"update: aborting — stream exceeded cap "
                            f"{MAX_DOWNLOAD_BYTES} bytes mid-download"
                        )
                        f.close()
                        try:
                            dest.unlink()
                        except Exception:
                            pass
                        return False
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
REM
REM Strategy: never have a moment where the live exe is missing.
REM   1. COPY new exe (in APPDATA) → STAGED file next to the live exe
REM      (so it's on the same NTFS volume — required for atomic move in step 4).
REM   2. COPY live exe → BACKUP (the live file stays in place; nothing
REM      destructive yet, so a crash here is a no-op).
REM   3. MOVE staged → live. On NTFS this uses MoveFileEx + REPLACE_EXISTING,
REM      which is atomic — the target file is either the old bytes or the
REM      new bytes, never absent. This is the only step that mutates the
REM      live exe path, and it does so atomically.
REM   4. Start the new agent; clean up the staging copy in APPDATA.
REM
REM Args: %1 = live exe path, %2 = freshly-downloaded exe (in APPDATA)

set "OLD_EXE=%~1"
set "NEW_EXE=%~2"
set "BACKUP_EXE=%~1.old"
set "STAGED_EXE=%~1.new"
set "LOG=%~dp0updater.log"

echo [%date% %time%] updater start old=%OLD_EXE% new=%NEW_EXE% >> "%LOG%"

REM Let the old agent fully exit and release its file lock.
timeout /t 3 /nobreak >nul

REM --- Step 1: stage the new exe next to the old one ---------------------
copy /Y "%NEW_EXE%" "%STAGED_EXE%" >nul 2>&1
if !errorlevel! neq 0 (
    echo [%date% %time%] FAIL: could not stage new exe >> "%LOG%"
    exit /b 1
)

REM --- Step 2: backup the live exe (non-destructive copy) ----------------
copy /Y "%OLD_EXE%" "%BACKUP_EXE%" >nul 2>&1
if !errorlevel! neq 0 (
    echo [%date% %time%] FAIL: could not back up live exe >> "%LOG%"
    del /F /Q "%STAGED_EXE%" >nul 2>&1
    exit /b 1
)

REM --- Step 3: atomic replace via NTFS MoveFileEx ------------------------
REM Even after the 3s wait above, the prior process's file handle can
REM linger. Retry the atomic replace for up to 15s.
set RETRIES=0
:retry_replace
move /Y "%STAGED_EXE%" "%OLD_EXE%" >nul 2>&1
if !errorlevel! neq 0 (
    set /a RETRIES+=1
    if !RETRIES! lss 15 (
        timeout /t 1 /nobreak >nul
        goto retry_replace
    )
    echo [%date% %time%] FAIL: atomic replace failed after retries >> "%LOG%"
    del /F /Q "%STAGED_EXE%" >nul 2>&1
    exit /b 1
)

REM --- Step 4: launch + cleanup ------------------------------------------
echo [%date% %time%] starting new agent >> "%LOG%"
start "" "%OLD_EXE%"

REM The .new.exe in APPDATA was the source for the stage; we copied
REM not moved, so it's still there. Remove it now that the swap is done.
del /F /Q "%NEW_EXE%" >nul 2>&1

REM Updater exits immediately after launching the new agent. We DELIBERATELY
REM removed the post-launch watchdog ("wait 30s, tasklist | find") in v0.5.7
REM because cmd.exe's CREATE_NO_WINDOW flag doesn't cover its child console
REM processes — tasklist and find each allocate their own console window,
REM which surfaced to users as a black popup titled "find /i Groundwork.exe"
REM during the 30-second wait. JoAnn Lyman's install hit this on day-1.
REM
REM The auto-rollback that watchdog enabled is now handled passively:
REM   - If the new agent exe fails to start (PyInstaller extraction error,
REM     missing DLL, etc), it leaves no .failed artifact — the user just
REM     sees nothing happen and tells us. They then re-install from the
REM     team page, which redownloads the latest from GitHub releases.
REM   - cleanup_update_orphans() on every agent startup still reaps
REM     <exe>.new and <exe>.failed and agent.new.exe stragglers so disk
REM     state stays clean.
REM   - The PyInstaller persistent-runtime fix shipped in v0.5.6 already
REM     eliminated the most common failure mode the watchdog was guarding
REM     against (random %TEMP% extraction failures).

echo [%date% %time%] update succeeded >> "%LOG%"
exit /b 0
"""


def cleanup_update_orphans(config_dir: Path, log: LogFn) -> None:
    """Remove stale update artifacts at agent startup.

    Possible orphans:
      - <config_dir>/agent.new.exe — Python wrote it during a download but
        the bat never consumed it.
      - <exe>.new — the bat copied the new bytes to stage but didn't
        complete the atomic replace.
      - <exe>.failed — a watchdog rollback moved a failing new exe aside.

    The current exe is always intact when we reach this code (otherwise the
    agent couldn't have started). The regular update check will re-attempt
    cleanly if an update is still needed, so it's safe to just delete
    these artifacts.
    """
    if sys.platform != "win32":
        return
    candidates: list[Path] = [config_dir / "agent.new.exe"]
    if getattr(sys, "frozen", False):
        exe = Path(sys.executable)
        candidates.append(exe.with_name(exe.name + ".new"))
        candidates.append(exe.with_name(exe.name + ".failed"))
    for p in candidates:
        try:
            if p.exists():
                p.unlink()
                log(f"update: cleaned up orphan {p.name}")
        except Exception as e:
            log(f"update: could not clean up {p.name}: {e}")


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
