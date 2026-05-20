#!/usr/bin/env python3
"""
Register a freshly built agent release with Supabase.

Called from .github/workflows/build.yml after PyInstaller produces the
binary and the GitHub Release is published. Computes SHA256, then
upserts a row in agent_releases for the (platform, version) pair and
flips is_latest=true on it (clearing is_latest on all other rows of
the same platform).

Per-platform invariant: each platform has independent is_latest /
is_min_supported. The Windows row stays latest for Windows agents even
when a Mac build promotes its own row to latest for Mac agents.

Env vars (set by GitHub Actions secrets):
  SUPABASE_URL                 — full URL, e.g., https://abc.supabase.co
  SUPABASE_SERVICE_ROLE_KEY    — service-role key (NOT the anon key)
  AGENT_VERSION                — version string read from repo-root VERSION
  AGENT_EXE_PATH               — path to the built binary inside dist/
  AGENT_DOWNLOAD_URL           — GitHub Release asset URL
  AGENT_RELEASE_NOTES          — optional, free-form text
  AGENT_PLATFORM               — 'windows' | 'mac' | 'linux'. Defaults
                                  to 'windows' for backward compatibility
                                  with the prior single-platform build.

Direct PostgREST upsert rather than the promote_agent_release RPC —
the RPC predates the platform column. Updating its signature would
require another migration; the direct path is simpler and gives us
room to add fields without DB changes.
"""

from __future__ import annotations

import hashlib
import os
import sys
import urllib.error
import urllib.request
import json


def sha256_of_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.stderr.write(f"FATAL: ${name} not set\n")
        sys.exit(1)
    return value


def call(supabase_url: str, service_key: str, method: str, path: str, body: dict | list | None = None,
         extra_headers: dict | None = None) -> tuple[int, str]:
    """Direct PostgREST call returning (status, body_text). Any 4xx/5xx
    is the caller's problem to interpret — we just print and return."""
    url = f"{supabase_url}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        return e.code, text


def main() -> int:
    supabase_url = require_env("SUPABASE_URL").rstrip("/")
    service_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    version = require_env("AGENT_VERSION").strip()
    exe_path = require_env("AGENT_EXE_PATH")
    download_url = require_env("AGENT_DOWNLOAD_URL")
    release_notes = os.environ.get("AGENT_RELEASE_NOTES") or None
    platform = (os.environ.get("AGENT_PLATFORM") or "windows").strip().lower()

    if platform not in ("windows", "mac", "linux"):
        sys.stderr.write(f"FATAL: AGENT_PLATFORM must be windows|mac|linux, got {platform!r}\n")
        return 1

    if not os.path.isfile(exe_path):
        sys.stderr.write(f"FATAL: binary not found at {exe_path}\n")
        return 1

    sha = sha256_of_file(exe_path)
    print(f"platform={platform}")
    print(f"version={version}")
    print(f"sha256={sha}")
    print(f"download_url={download_url}")

    # Step 1: clear is_latest on all OTHER rows of the same platform.
    # PostgREST filter: platform=eq.X&version=not.eq.<version>
    status, body = call(
        supabase_url, service_key,
        method="PATCH",
        path=f"/rest/v1/agent_releases?platform=eq.{platform}&version=neq.{version}",
        body={"is_latest": False},
        extra_headers={"Prefer": "return=minimal"},
    )
    if status >= 300:
        sys.stderr.write(f"clear is_latest failed HTTP {status}: {body}\n")
        return 1

    # Step 2: upsert the new row. On conflict (version is the PK) we
    # overwrite download_url, sha256, release_notes, is_latest. We
    # explicitly DO NOT touch is_min_supported here — that's flipped
    # manually after we confirm the build is healthy.
    # released_at: do NOT include in the payload. The column is NOT NULL
    # with default now(); sending null on UPSERT merges null into the
    # column → constraint violation. Omitting the key lets the default
    # fire on INSERT and leaves the existing value alone on UPDATE.
    payload = {
        "version": version,
        "platform": platform,
        "download_url": download_url,
        "sha256": sha,
        "release_notes": release_notes,
        "is_latest": True,
    }
    # on_conflict uses the composite (version, platform) PK from
    # migration 0029. Without specifying platform here, a Mac job running
    # for v0.5.9 would MERGE on the Windows v0.5.9 row and overwrite it.
    status, body = call(
        supabase_url, service_key,
        method="POST",
        path="/rest/v1/agent_releases?on_conflict=version,platform",
        body=payload,
        extra_headers={
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
    )
    if status >= 300:
        sys.stderr.write(f"upsert agent_releases failed HTTP {status}: {body}\n")
        return 1

    print(f"agent_releases upsert ok (HTTP {status}): {body[:200]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
