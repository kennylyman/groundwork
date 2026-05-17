#!/usr/bin/env python3
"""
Register a freshly built agent release with Supabase.

Called from .github/workflows/build.yml after PyInstaller produces the exe
and the GitHub Release is published. Computes the exe's SHA256, then calls
the `promote_agent_release` RPC to insert (or update) the row and flip
`is_latest = true`.

Env vars (set by GitHub Actions secrets):
  SUPABASE_URL                 — full URL, e.g., https://abc.supabase.co
  SUPABASE_SERVICE_ROLE_KEY    — service-role key (NOT the anon key)
  AGENT_VERSION                — version string read from repo-root VERSION
  AGENT_EXE_PATH               — path to the built .exe inside dist/
  AGENT_DOWNLOAD_URL           — GitHub Release asset URL
  AGENT_RELEASE_NOTES          — optional, free-form text
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


def main() -> int:
    supabase_url = require_env("SUPABASE_URL").rstrip("/")
    service_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    version = require_env("AGENT_VERSION").strip()
    exe_path = require_env("AGENT_EXE_PATH")
    download_url = require_env("AGENT_DOWNLOAD_URL")
    release_notes = os.environ.get("AGENT_RELEASE_NOTES") or None

    if not os.path.isfile(exe_path):
        sys.stderr.write(f"FATAL: exe not found at {exe_path}\n")
        return 1

    sha = sha256_of_file(exe_path)
    print(f"version={version}")
    print(f"sha256={sha}")
    print(f"download_url={download_url}")

    body = {
        "p_version": version,
        "p_download_url": download_url,
        "p_sha256": sha,
        "p_release_notes": release_notes,
    }
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/rpc/promote_agent_release",
        method="POST",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            text = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        sys.stderr.write(f"HTTPError {e.code}: {text}\n")
        return 1
    except Exception as e:
        sys.stderr.write(f"request failed: {e}\n")
        return 1

    if status >= 300:
        sys.stderr.write(f"promote_agent_release HTTP {status}: {text}\n")
        return 1

    print(f"promote_agent_release ok (HTTP {status})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
