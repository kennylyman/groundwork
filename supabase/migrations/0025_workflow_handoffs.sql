-- Cross-employee handoff detection.
--
-- A "handoff" is when employee A's workflow ends on a task/tool and
-- employee B picks up a related task/tool within a meaningful time
-- window — indicating work passed between people. The hand-off
-- detector runs after sequence detection so it can link the from/to
-- captures to the sequences they belong to (when available).
--
-- Unique constraint shape:
--   (business_id, from_employee_id, to_employee_id, from_tool, to_tool)
-- — each distinct directional flow between two people on a specific
-- pair of tools rolls into one row whose occurrence_count and rolling
-- avg_gap_minutes accumulate across detection runs. A handoff with
-- avg_gap_minutes > 60 and occurrence_count >= 3 is flagged as
-- is_bottleneck; > 240 minutes is a CRITICAL bottleneck and surfaces
-- above the opportunities panel.
--
-- RLS follows the owner-chain pattern (migration 0010) — owner SELECT
-- via businesses.owner_id = auth.uid(); writes service-role only.

create extension if not exists "pgcrypto";

create table if not exists public.workflow_handoffs (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  from_employee_id    uuid not null references public.employees(id) on delete cascade,
  to_employee_id      uuid not null references public.employees(id) on delete cascade,
  -- The MOST RECENT observed handoff timestamp (the moment work passed).
  handoff_at          timestamptz not null,
  -- Gap in minutes between A's last capture and B's first capture for
  -- the most recent observation. avg_gap_minutes is the rolling average
  -- across all observations.
  gap_minutes         integer not null check (gap_minutes >= 0),
  avg_gap_minutes     numeric not null check (avg_gap_minutes >= 0),
  -- Optional FKs into the sequences each side participated in. Null
  -- when the from/to captures weren't part of a detected sequence.
  from_sequence_id    uuid references public.workflow_sequences(id) on delete set null,
  to_sequence_id      uuid references public.workflow_sequences(id) on delete set null,
  from_tool           text,
  to_tool             text,
  from_category       text,
  to_category         text,
  -- Free-text label from the matched affinity rule. e.g. "Billing handoff"
  -- or "Schedule notification".
  task_context        text,
  occurrence_count    integer not null default 1 check (occurrence_count >= 1),
  last_seen_at        timestamptz not null,
  confidence_score    numeric not null default 0.5
    check (confidence_score >= 0 and confidence_score <= 1),
  is_bottleneck       boolean not null default false,
  -- Constraint: a row counts as a bottleneck only when both thresholds
  -- are met. Enforced in code, but documented here so DB-level audits
  -- can verify the invariant.
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Disallow self-handoff (A → A) — same person picking up their own
  -- work isn't a cross-employee handoff.
  check (from_employee_id <> to_employee_id),

  -- The dedup key. NULLs in (from_tool, to_tool) are treated as
  -- distinct values by Postgres default — we always insert non-empty
  -- strings (using '' as the sentinel when the underlying capture
  -- had a null software value).
  unique (business_id, from_employee_id, to_employee_id, from_tool, to_tool)
);

create index if not exists workflow_handoffs_business_idx
  on public.workflow_handoffs (business_id, is_bottleneck desc, occurrence_count desc);
create index if not exists workflow_handoffs_last_seen_idx
  on public.workflow_handoffs (business_id, last_seen_at desc);

comment on table public.workflow_handoffs is
  'Cross-employee work handoffs — directional flows where one employee ends a session on tool/category X and another employee begins a session on a related tool/category Y within 4 hours. Keyed by (business, from_employee, to_employee, from_tool, to_tool) so the same flow accumulates occurrence_count and rolling avg_gap_minutes across detection runs.';
comment on column public.workflow_handoffs.is_bottleneck is
  'True when avg_gap_minutes > 60 AND occurrence_count >= 3. Bottlenecks > 240 min (4 hr) are CRITICAL and surface above the opportunities panel.';

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.workflow_handoffs enable row level security;

drop policy if exists workflow_handoffs_owner_select on public.workflow_handoffs;
create policy workflow_handoffs_owner_select on public.workflow_handoffs
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policies — the detection cron writes as
-- service role and bypasses RLS.
