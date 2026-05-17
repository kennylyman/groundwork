-- Canary releases for agent_releases.
--
-- Today every release promoted to is_latest=true goes to 100% of the
-- fleet on each agent's next /api/agent-version check. No way to bake a
-- build with selected employees before pushing to everyone. After the
-- "hobby-cron-broke-the-deploy-chain" miss we want a soak window
-- available before customer #2.
--
-- Semantics:
--   is_canary = true
--     The release is targeted only at employees listed in
--     canary_employee_ids. Other employees see the previous is_latest
--     release (the canary release stays at is_latest=false).
--   is_canary = false (default)
--     Normal release. is_latest=true sends it to 100% of agents.
--
-- /api/agent-version honors this: when an employee_id query param is
-- present and that employee is in any canary release's
-- canary_employee_ids, the canary release is returned as "latest_version"
-- instead of whatever's currently marked is_latest. Without an
-- employee_id (e.g., settings page polling) the response uses
-- is_latest=true as before.

alter table public.agent_releases
  add column if not exists is_canary boolean not null default false,
  add column if not exists canary_employee_ids uuid[] not null default array[]::uuid[];

-- Index for the agent-version endpoint's canary lookup. GIN on the array
-- column so `canary_employee_ids @> array[employee_id]` is fast.
create index if not exists agent_releases_canary_emps_idx
  on public.agent_releases using gin (canary_employee_ids)
  where is_canary = true;

-- Helper: assign or replace the canary list for a specific version. Lets
-- the settings UI promote (and edit) canary releases without manually
-- managing flags. Service-role only.
create or replace function public.set_agent_release_canary(
  p_version text,
  p_employee_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_employee_ids is null or array_length(p_employee_ids, 1) is null then
    update public.agent_releases
       set is_canary = false,
           canary_employee_ids = array[]::uuid[]
     where version = p_version;
  else
    update public.agent_releases
       set is_canary = true,
           canary_employee_ids = p_employee_ids
     where version = p_version;
  end if;
  if not found then
    raise exception 'unknown version: %', p_version;
  end if;
end;
$$;

revoke execute on function public.set_agent_release_canary(text, uuid[]) from public;
grant  execute on function public.set_agent_release_canary(text, uuid[]) to service_role;
