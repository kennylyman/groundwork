-- Multi-tenant RLS: every per-business row is only readable by the owner.
--
-- Today's posture (pre-migration): every table has
--   for select to anon, authenticated using (true)
-- which means anyone with the anon key (every shipped client bundle has it)
-- can read every business's data by sending a raw PostgREST query.
--
-- This migration replaces those policies with owner-chain checks against
-- auth.uid(). The chain:
--   businesses.owner_id = auth.uid()
--   employees.business_id → businesses.owner_id
--   everything else → business_id → businesses.owner_id
--
-- Service role bypasses RLS automatically — the install page, Zapier
-- webhook, cron routes, and all serverSupabase() callers are unaffected.
-- Only the client-side anon (cookie-authed via @supabase/ssr) sees the
-- new restrictions.

-- --- 0. Index owner_id so the subquery is fast --------------------------

create index if not exists businesses_owner_id_idx
  on public.businesses (owner_id);

-- --- 1. businesses: owner reads/updates their own row ------------------

alter table public.businesses enable row level security;

drop policy if exists businesses_anon_select on public.businesses;
drop policy if exists businesses_owner_select on public.businesses;
drop policy if exists businesses_owner_insert on public.businesses;
drop policy if exists businesses_owner_update on public.businesses;

create policy businesses_owner_select on public.businesses
  for select to authenticated
  using (owner_id = auth.uid());

create policy businesses_owner_insert on public.businesses
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy businesses_owner_update on public.businesses
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Intentionally no DELETE policy — service role only.

-- --- 2. employees: owner sees/manages their employees ------------------

alter table public.employees enable row level security;

drop policy if exists employees_anon_select on public.employees;
drop policy if exists employees_owner_select on public.employees;
drop policy if exists employees_owner_insert on public.employees;
drop policy if exists employees_owner_update on public.employees;

create policy employees_owner_select on public.employees
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

create policy employees_owner_insert on public.employees
  for insert to authenticated
  with check (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

create policy employees_owner_update on public.employees
  for update to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  )
  with check (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- --- 3. captures: owner reads via business chain -----------------------

alter table public.captures enable row level security;

drop policy if exists captures_anon_select on public.captures;
drop policy if exists captures_owner_select on public.captures;

-- SELECT only — captures are written by the agent via the anon key, which
-- we'd block under this policy. Writes happen via the service-role
-- path; see note below for the migration plan.
create policy captures_owner_select on public.captures
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- NOTE: the agent currently posts to /rest/v1/captures with the anon key.
-- That worked when captures had an open anon INSERT policy implicitly
-- (Supabase defaults). With RLS enabled and no INSERT policy for anon,
-- those POSTs would fail. We keep an INSERT policy for anon that requires
-- the row's business_id to be a real business id — minimal protection,
-- mostly a sanity check. Real protection lives in the per-employee
-- install_token (in the agent's config.json) that scopes a given exe to
-- a specific business.
drop policy if exists captures_anon_insert on public.captures;
create policy captures_anon_insert on public.captures
  for insert to anon
  with check (business_id in (select id from public.businesses));

-- --- 4. business_profiles: owner reads/updates --------------------------

alter table public.business_profiles enable row level security;

drop policy if exists business_profiles_anon_select on public.business_profiles;
drop policy if exists business_profiles_owner_select on public.business_profiles;
drop policy if exists business_profiles_owner_insert on public.business_profiles;
drop policy if exists business_profiles_owner_update on public.business_profiles;

create policy business_profiles_owner_select on public.business_profiles
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

create policy business_profiles_owner_insert on public.business_profiles
  for insert to authenticated
  with check (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

create policy business_profiles_owner_update on public.business_profiles
  for update to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  )
  with check (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- --- 5. employee_role_profiles: owner reads ----------------------------

alter table public.employee_role_profiles enable row level security;

drop policy if exists employee_role_profiles_anon_select on public.employee_role_profiles;
drop policy if exists employee_role_profiles_owner_select on public.employee_role_profiles;

create policy employee_role_profiles_owner_select on public.employee_role_profiles
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- Writes are cron-only (service role) — no INSERT/UPDATE policy.

-- --- 6. opportunities: owner reads -------------------------------------

alter table public.opportunities enable row level security;

drop policy if exists opportunities_anon_select on public.opportunities;
drop policy if exists opportunities_owner_select on public.opportunities;

create policy opportunities_owner_select on public.opportunities
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- --- 7. integrations: owner reads --------------------------------------

alter table public.integrations enable row level security;

drop policy if exists integrations_anon_select on public.integrations;
drop policy if exists integrations_owner_select on public.integrations;

create policy integrations_owner_select on public.integrations
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- --- 8. integration_events: owner reads --------------------------------

alter table public.integration_events enable row level security;

drop policy if exists integration_events_anon_select on public.integration_events;
drop policy if exists integration_events_owner_select on public.integration_events;

create policy integration_events_owner_select on public.integration_events
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );
