"""
Version constant baked into the agent at build time.

In production builds, GitHub Actions overwrites this file with the contents
of the repo-root VERSION file before invoking PyInstaller (see
.github/workflows/build.yml). In dev (running `python main.py` locally),
the placeholder below is used and update checks compare against
"0.0.0-dev" — which sorts as the smallest possible version, so any
published release looks "newer" but the dev guard in main.py prevents an
actual update from running against a non-frozen interpreter.
"""

VERSION = "0.0.0-dev"
