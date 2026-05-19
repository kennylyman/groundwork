-- Close two pre-launch security holes flagged in the audit:
--
--   1. Drop "Agent can insert captures" and "Agent can insert employees"
--      RLS policies. Both used WITH CHECK (true) against the PUBLIC
--      role — meaning anyone with the anon key could INSERT arbitrary
--      rows to either table with any business_id, including fabricated
--      ones. The defensive captures_anon_insert policy added in
--      migration 0010 was rendered moot because multiple permissive
--      policies OR together and the WITH-CHECK-true variant always wins.
--
--      The legitimate agent path now goes through /api/captures with
--      X-Groundwork-Install-Token header (added in v0.5.0). That route
--      validates the token server-side and writes with service role
--      (bypasses RLS), so dropping these policies has no effect on
--      production agents. /api/captures itself is unchanged.
--
--      Employees inserts happen through the dashboard /settings/team
--      page (owner session, employees_owner_insert policy) and through
--      activation flows on the server side. Neither relies on the
--      "Agent can insert employees" policy.
--
--   2. Revoke anon + authenticated EXECUTE on three SECURITY DEFINER
--      release-management functions:
--        promote_agent_release(text, text, text, text)
--        set_agent_min_supported(text)
--        set_agent_release_canary(text, uuid[])
--
--      Anyone with the anon key could currently POST to
--      /rest/v1/rpc/set_agent_min_supported and brick the entire
--      agent fleet by marking a non-existent version as the floor —
--      every agent's startup hard-update check would fail to resolve
--      a download. These functions are admin-only by design; only
--      the publish-release.py script (running with the service-role
--      key in CI) needs to call them.
--
--      Function-level GRANT/REVOKE is mostly idempotent — REVOKE on
--      a role that already lacks the privilege is a no-op. Re-grant
--      to service_role explicitly so future migrations that re-create
--      functions don't accidentally inherit a stricter default.
--
-- Verification queries run inline in the migration apply step below.

-- =============================================================================
-- 1. Drop overpermissive Agent policies
-- =============================================================================

drop policy if exists "Agent can insert captures" on public.captures;
drop policy if exists "Agent can insert employees" on public.employees;

-- Sanity: the defensive captures_anon_insert policy (business_id IN
-- businesses) and employees_owner_insert (authenticated, owner-chain)
-- remain. Anon callers can no longer INSERT to either table with
-- arbitrary business_id values; the captures_anon_insert WITH CHECK
-- still permits inserts when the business_id is real, which is the
-- legacy-agent rollback hatch until the fleet has fully moved to
-- /api/captures.

-- =============================================================================
-- 2. Revoke anon/authenticated EXECUTE on release-management RPCs
-- =============================================================================

revoke execute on function public.promote_agent_release(text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.set_agent_min_supported(text)
  from public, anon, authenticated;
revoke execute on function public.set_agent_release_canary(text, uuid[])
  from public, anon, authenticated;

-- service_role bypasses GRANT checks but make it explicit so a future
-- DROP+CREATE of the function doesn't silently re-grant to PUBLIC.
grant execute on function public.promote_agent_release(text, text, text, text)
  to service_role;
grant execute on function public.set_agent_min_supported(text)
  to service_role;
grant execute on function public.set_agent_release_canary(text, uuid[])
  to service_role;

comment on function public.promote_agent_release(text, text, text, text) is
  'Admin-only. Promotes a build to is_latest=true and inserts the agent_releases row. Service role only — anon EXECUTE was revoked in migration 0026.';
comment on function public.set_agent_min_supported(text) is
  'Admin-only. Sets is_min_supported=true on the given version and clears it everywhere else. Service role only — anon EXECUTE was revoked in migration 0026.';
comment on function public.set_agent_release_canary(text, uuid[]) is
  'Admin-only. Marks a release as canary for the listed employee_ids. Service role only — anon EXECUTE was revoked in migration 0026.';
