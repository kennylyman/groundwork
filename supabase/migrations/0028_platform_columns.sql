-- Cross-platform support — add a platform column to agent_releases
-- (so we can publish separate Windows and Mac binaries with their own
-- sha256 + download_url) and to employees (so the install page knows
-- which binary to serve when a user re-downloads).
--
-- The CHECK constraint allows 'linux' for future use even though we
-- don't ship a Linux build today. Saves a future migration.
--
-- All existing rows default to 'windows' because that's the only build
-- variant up through v0.5.8. v0.5.9 introduces the Mac build.

alter table public.agent_releases
  add column if not exists platform text
    not null
    default 'windows'
    check (platform in ('windows', 'mac', 'linux'));

-- The is_latest / is_min_supported invariants previously assumed at
-- most one row had each flag set. With platform, we can have one
-- per platform — one is_latest=true row for Windows AND one for Mac.
-- Drop the implicit invariant by relying on per-platform queries in
-- /api/agent-version (which gets the platform from the X-Groundwork-Platform
-- header and filters accordingly).
--
-- For now, do not add a unique constraint — the existing single-row
-- invariant is enforced by the publish-release.py script which clears
-- is_latest=true on all other rows of the same platform before setting
-- it on the new row.

create index if not exists agent_releases_platform_latest_idx
  on public.agent_releases (platform, is_latest desc, released_at desc);

comment on column public.agent_releases.platform is
  'Target platform for this binary. Each platform has independent is_latest / is_min_supported flags. /api/agent-version filters by the X-Groundwork-Platform header.';

-- ============================================================================
-- employees.platform — populated by /api/agent-version when the agent
-- reports its platform via X-Groundwork-Platform header. Helps the
-- install page (/install/[token]) serve the right binary when the
-- user re-downloads after re-invite, and lets us cross-check that
-- agent crashes cluster correctly by OS.
-- ============================================================================

alter table public.employees
  add column if not exists platform text
    check (platform is null or platform in ('windows', 'mac', 'linux'));

comment on column public.employees.platform is
  'Last reported agent platform. Populated by /api/agent-version from the X-Groundwork-Platform header. Null until first heartbeat.';
