-- Multi-monitor capture tracking.
--
-- Before v0.5.1, the agent always grabbed mss.monitors[1] — the primary
-- monitor — regardless of where the active window actually was. For
-- multi-monitor users the screenshot was often the wrong screen.
--
-- v0.5.1 detects the active window's monitor (via GetForegroundWindow +
-- GetWindowRect on Windows) and captures it. This column records which
-- monitor was captured for each row:
--   1   = primary monitor (or fallback when detection failed)
--   2+  = secondary monitor that contained the active window
--   NULL = pre-v0.5.1 agent (no detection)
--
-- Used for: debugging "wrong screen" reports, and surfacing multi-
-- monitor employees on the dashboard.

alter table public.captures
  add column if not exists monitor_index integer;
