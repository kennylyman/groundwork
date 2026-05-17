-- Phase 3: Role Discovery.
--
-- One row per employee, latest snapshot only. We deliberately keep this in
-- a separate table from employees because the activity_clusters payload is
-- heavy (a few KB per employee) and would bloat the hot employees query
-- that the dashboard runs every 30s.
--
-- Role Discovery never overwrites employees.role directly. The discovered
-- profile lives here unacknowledged; the owner sees a diff on the employee
-- detail page and decides whether to Accept (updates employees.role) or
-- Dismiss (just marks acknowledged_at).

create table if not exists public.employee_role_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  employee_id uuid not null unique references public.employees(id) on delete cascade,

  -- What we observed from the captures
  observed_role text,                       -- e.g. "Scheduler"
  observed_role_summary text,               -- one-line description of what they actually do
  role_confidence numeric(4,3) not null default 0.0,  -- 0..1

  -- What was on file when discovery ran (snapshotted so the diff is stable
  -- even if employees.role gets edited between runs).
  stated_role text,
  stated_vs_observed_mismatch boolean not null default false,

  -- The synthesized clusters: [{ label, pct_of_time, software, typical_cadence,
  -- capabilities_used, representative_capture_ids }]
  activity_clusters jsonb not null default '[]'::jsonb,

  -- High-level rollups for the prompt + display
  primary_workflows jsonb not null default '[]'::jsonb,    -- ["Daily shift assignment", ...]
  time_distribution jsonb not null default '{}'::jsonb,    -- { mornings: 0.6, afternoons: 0.4 }

  -- Run metadata
  capture_count_at_run integer not null default 0,
  last_run_at timestamptz not null default now(),

  -- Owner acknowledgment lifecycle
  acknowledged_at timestamptz,
  acknowledgment_action text,        -- 'accepted' | 'dismissed' (NULL until ack'd)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists employee_role_profiles_touch_updated_at
  on public.employee_role_profiles;
create trigger employee_role_profiles_touch_updated_at
  before update on public.employee_role_profiles
  for each row execute function public.touch_updated_at();

create index if not exists employee_role_profiles_business_idx
  on public.employee_role_profiles (business_id);

-- Filter the dashboard badge: "employees with an unacknowledged discovery"
create index if not exists employee_role_profiles_unack_idx
  on public.employee_role_profiles (business_id)
  where acknowledged_at is null;

-- Constrain acknowledgment_action
alter table public.employee_role_profiles
  drop constraint if exists employee_role_profiles_ack_action_chk;
alter table public.employee_role_profiles
  add constraint employee_role_profiles_ack_action_chk
  check (acknowledgment_action is null or acknowledgment_action in ('accepted', 'dismissed'));

-- RLS: anon SELECT matches the convention elsewhere. Mutations through
-- service-role API routes only.
alter table public.employee_role_profiles enable row level security;

drop policy if exists employee_role_profiles_anon_select on public.employee_role_profiles;
create policy employee_role_profiles_anon_select
  on public.employee_role_profiles
  for select
  to anon, authenticated
  using (true);
