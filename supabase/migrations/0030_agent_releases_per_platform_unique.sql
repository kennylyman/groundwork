-- Per-platform partial unique indexes on agent_releases.is_latest and
-- .is_min_supported.
--
-- The pre-existing indexes agent_releases_one_latest and
-- agent_releases_one_min_supported each enforce "only ONE row in the
-- entire table can have this flag set". That was correct before
-- migration 0028 added the platform column. Now that we have
-- multi-platform releases, the Windows is_latest=true row blocks
-- the Mac job from setting is_latest=true on its own v0.5.9 row —
-- publish-release.py for Mac hits an HTTP 409.
--
-- The correct semantic going forward: exactly one is_latest=true row
-- PER PLATFORM. Same for is_min_supported. A single partial unique
-- index on (platform) WHERE flag = true expresses that elegantly and
-- supports linux automatically when we add that build (no extra
-- migration needed). The user's audit suggested two separate per-
-- platform indexes; the composite-on-platform variant below is the
-- same semantic with one less index and no per-platform maintenance.
--
-- (User: I'm shipping this as 0030 because migration 0029 was already
-- used for the composite primary key. Migration ordering matters; you
-- can't re-issue the same number.)

drop index if exists public.agent_releases_one_latest;
drop index if exists public.agent_releases_one_min_supported;

create unique index if not exists agent_releases_one_latest_per_platform
  on public.agent_releases (platform)
  where is_latest = true;

create unique index if not exists agent_releases_one_min_supported_per_platform
  on public.agent_releases (platform)
  where is_min_supported = true;

comment on index public.agent_releases_one_latest_per_platform is
  'Enforces exactly one is_latest=true row per platform (windows/mac/linux). Replaces the table-wide one_latest constraint that broke multi-platform publishing in migration 0028.';
comment on index public.agent_releases_one_min_supported_per_platform is
  'Enforces exactly one is_min_supported=true row per platform. Same migration story as one_latest_per_platform.';
