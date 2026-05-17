-- Agent release tracking and auto-update infrastructure.
--
-- The Groundwork agent is a PyInstaller Windows exe distributed to every
-- employee's machine. Once installed it runs forever, so we need a way to
-- ship new builds without asking every employee to reinstall manually.
--
-- This migration adds:
--   1. `agent_releases` — version history. Each new build registers a row.
--      Exactly one row is `is_latest = true` and at most one is
--      `is_min_supported = true` at any time (enforced by partial unique
--      indexes).
--   2. `promote_agent_release(...)` RPC — atomic insert-or-update + flip
--      `is_latest` across rows. Called by the GitHub Actions publish step
--      so a release lands and gets promoted in a single round-trip.
--   3. `set_agent_min_supported(...)` RPC — atomic flip for `is_min_supported`,
--      called from the settings/releases UI when an owner forces a floor.
--   4. `employees.agent_version` + `agent_version_updated_at` — heartbeat
--      written by /api/agent-version. Lets the settings UI show how many
--      agents are on each build and which haven't checked in lately.

-- --- agent_releases table -------------------------------------------------

create table if not exists public.agent_releases (
  version text primary key,
  download_url text not null,
  sha256 text not null,
  release_notes text,
  is_latest boolean not null default false,
  is_min_supported boolean not null default false,
  released_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists agent_releases_touch_updated_at on public.agent_releases;
create trigger agent_releases_touch_updated_at
  before update on public.agent_releases
  for each row execute function public.touch_updated_at();

-- Partial unique indexes — only one row can be flagged latest /
-- min_supported at a time. Enforces invariants at the DB level so the
-- agent endpoint can always return a single answer.
create unique index if not exists agent_releases_one_latest
  on public.agent_releases (is_latest) where is_latest;
create unique index if not exists agent_releases_one_min_supported
  on public.agent_releases (is_min_supported) where is_min_supported;

-- Public read — agents call /api/agent-version with the anon key, which
-- proxies this table. Writes are service-role only (RPCs below).
alter table public.agent_releases enable row level security;

drop policy if exists agent_releases_public_select on public.agent_releases;
create policy agent_releases_public_select on public.agent_releases
  for select to anon, authenticated using (true);

-- No insert/update/delete policies → only service_role can mutate.

-- --- employee version heartbeat ------------------------------------------

alter table public.employees
  add column if not exists agent_version text,
  add column if not exists agent_version_updated_at timestamptz;

create index if not exists employees_agent_version_idx
  on public.employees (agent_version);

-- --- RPCs ----------------------------------------------------------------

-- Promote a release to "latest". Idempotent: re-running with the same
-- version just refreshes download_url + sha256 (useful if a build is
-- re-uploaded). Atomically clears the previous latest before flipping
-- the new one so the partial unique index never sees two trues.
create or replace function public.promote_agent_release(
  p_version text,
  p_download_url text,
  p_sha256 text,
  p_release_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.agent_releases set is_latest = false where is_latest = true;

  insert into public.agent_releases (
    version, download_url, sha256, release_notes, is_latest
  ) values (
    p_version, p_download_url, p_sha256, p_release_notes, true
  )
  on conflict (version) do update set
    download_url   = excluded.download_url,
    sha256         = excluded.sha256,
    release_notes  = coalesce(excluded.release_notes, public.agent_releases.release_notes),
    is_latest      = true;
end;
$$;

revoke execute on function public.promote_agent_release(text, text, text, text) from public;
grant execute on function public.promote_agent_release(text, text, text, text) to service_role;

-- Set the minimum supported version. Agents older than this perform a
-- hard update on startup. NULL clears the floor (no version is forced).
create or replace function public.set_agent_min_supported(
  p_version text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.agent_releases set is_min_supported = false where is_min_supported = true;

  if p_version is not null then
    update public.agent_releases
       set is_min_supported = true
     where version = p_version;
    if not found then
      raise exception 'unknown version: %', p_version;
    end if;
  end if;
end;
$$;

revoke execute on function public.set_agent_min_supported(text) from public;
grant execute on function public.set_agent_min_supported(text) to service_role;

-- --- Optional seed (skipped) ---------------------------------------------
-- New agent_releases rows land via GitHub Actions calling
-- promote_agent_release(...) on successful build. The first row will be
-- the next merge to main that bumps VERSION.
