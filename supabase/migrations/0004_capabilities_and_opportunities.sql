-- Phase 1: capability tagging + opportunity detection scaffolding.
--
-- Two things land in this migration:
--   1. captures.capabilities jsonb — where the per-capture classifier writes
--      its structured capability tags (e.g. [{ id, params, confidence }, ...]).
--   2. opportunities table — the pattern detector's output. One row per
--      (employee, capability_pattern) pair, upserted on pattern_signature so
--      re-runs don't duplicate.

-- --- Captures: capability column ----------------------------------------

alter table public.captures
  add column if not exists capabilities jsonb not null default '[]'::jsonb;

-- GIN on the capability ids makes "find all captures matching capability X
-- in the last 7 days" cheap, which is the hot read path for pattern detection.
create index if not exists captures_capabilities_gin_idx
  on public.captures using gin (capabilities);

-- --- Opportunities table ------------------------------------------------

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,

  -- A stable hash over (employee_id, capability_id, key_params) so re-runs
  -- of pattern detection UPSERT instead of inserting duplicate rows.
  pattern_signature text not null,

  -- Short display label (e.g., "Transfer shift info from WellSky to SMS")
  title text not null,
  -- Longer human-readable description (LLM can be invoked later to enrich)
  description text,

  -- The pattern itself — capability id, observed parameter snapshots,
  -- representative capture ids. Kept as jsonb so the shape can evolve as
  -- multi-capability sequence detection comes online later.
  capability_pattern jsonb not null,

  -- Observation window stats
  first_detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count integer not null default 0,
  estimated_weekly_minutes integer not null default 0,

  -- Cost & savings rollups (computed server-side at detect time using the
  -- same role-based hourly rate logic as the intelligence report)
  estimated_annual_cost integer not null default 0,
  estimated_annual_savings integer not null default 0,

  -- 0.0 - 1.0
  confidence numeric(4,3) not null default 0.0,

  -- Lifecycle state — matches the architecture doc's state machine.
  -- We only USE 'new' for Phase 1 but constrain values so future
  -- transitions are explicit.
  status text not null default 'new',

  -- Build complexity class (A=Zapier-able, B=composed agent, C=custom).
  -- Optional in Phase 1 since we don't yet route by class.
  automation_class text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Stable signature is unique per business+employee+pattern so the upsert key
-- is well-defined. Different employees can independently surface the same
-- capability pattern as separate opportunities.
create unique index if not exists opportunities_signature_uidx
  on public.opportunities (business_id, employee_id, pattern_signature);

-- Hot indexes for the dashboard list view: by business, recent activity,
-- and high-savings-first sorting.
create index if not exists opportunities_business_status_idx
  on public.opportunities (business_id, status);
create index if not exists opportunities_business_savings_idx
  on public.opportunities (business_id, estimated_annual_savings desc);

-- Constrain status + automation_class to known values without enums
-- (enums are painful to alter; check constraints are easy to drop).
alter table public.opportunities
  drop constraint if exists opportunities_status_chk;
alter table public.opportunities
  add constraint opportunities_status_chk
  check (status in ('new', 'reviewed', 'approved', 'built', 'tested', 'deployed', 'running', 'paused', 'retired', 'dismissed'));

alter table public.opportunities
  drop constraint if exists opportunities_automation_class_chk;
alter table public.opportunities
  add constraint opportunities_automation_class_chk
  check (automation_class is null or automation_class in ('A', 'B', 'C'));

-- Auto-update updated_at on writes
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists opportunities_touch_updated_at on public.opportunities;
create trigger opportunities_touch_updated_at
  before update on public.opportunities
  for each row execute function public.touch_updated_at();

-- --- RLS ---------------------------------------------------------------
--
-- Match the existing convention on captures: anon SELECT is allowed (the
-- dashboard reads with the anon key under business_id filters). All writes
-- go through the service role via API routes.
--
-- NOTE: multi-tenant isolation is currently enforced by application code
-- (always filter by business_id), NOT by RLS. Same posture as captures and
-- employees. Worth tightening before this product goes multi-customer.

alter table public.opportunities enable row level security;

drop policy if exists opportunities_anon_select on public.opportunities;
create policy opportunities_anon_select
  on public.opportunities
  for select
  to anon, authenticated
  using (true);
