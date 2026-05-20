-- Composite primary key on agent_releases.
--
-- Migration 0028 added the platform column but left the primary key as
-- (version) alone. That means two rows for the same version on
-- different platforms (the same v0.5.9 Windows AND v0.5.9 Mac builds)
-- collide on the PK. PostgREST upsert with on_conflict=version then
-- MERGES the second insert into the first, overwriting the platform
-- column — silently losing the Windows row when the Mac job publishes.
--
-- This migration switches the PK to (version, platform) so the two
-- platform builds are distinct rows. publish-release.py is updated in
-- the same commit to send on_conflict=version,platform.
--
-- Safe to apply: no foreign keys reference agent_releases. The two
-- statements below run as a single migration so there's no window
-- where the table has no PK.

begin;

alter table public.agent_releases
  drop constraint if exists agent_releases_pkey;

alter table public.agent_releases
  add primary key (version, platform);

commit;

comment on constraint agent_releases_pkey on public.agent_releases is
  'Composite PK so the same version can exist for multiple platforms (e.g. v0.5.9 has separate rows for windows and mac).';
