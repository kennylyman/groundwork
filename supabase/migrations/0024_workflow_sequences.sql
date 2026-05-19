-- Workflow sequence detection.
--
-- Captures up to now have been scored as isolated events: "this person
-- spent 30 seconds in WellSky" / "this person spent 30 seconds in
-- Outlook". The opportunities engine groups them by capability tag,
-- but it can't see the chain — "WellSky → Excel → QuickBooks → Outlook"
-- as a four-step workflow that runs every Tuesday.
--
-- Two tables:
--   workflow_sequences       one row per (business, sequence_hash). The
--                            sequence_hash is a canonical fingerprint of
--                            the (tool, category) chain — order matters.
--                            occurrence_count accumulates across runs;
--                            confidence_score is recomputed on each run.
--
--   workflow_sequence_steps  one row per (sequence, capture) step instance.
--                            Multiple occurrences of the same sequence
--                            produce multiple groups of (step_index 0..N-1)
--                            rows for the same sequence_id. The unique
--                            constraint on (sequence_id, capture_id)
--                            stops re-detection from double-inserting
--                            the same capture as a step.
--
-- RLS follows the owner-chain pattern established in migration 0010 —
-- owner SELECT via businesses.owner_id = auth.uid(); writes via service
-- role (the detection cron is the only writer).

create extension if not exists "pgcrypto";

-- ============================================================================
-- workflow_sequences
-- ============================================================================

create table if not exists public.workflow_sequences (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  -- The employee whose detection run FIRST surfaced this sequence. The
  -- same sequence_hash may be observed across multiple employees; the
  -- full set is derived by joining workflow_sequence_steps → captures.
  employee_id         uuid not null references public.employees(id) on delete cascade,
  started_at          timestamptz not null,
  ended_at            timestamptz not null,
  step_count          integer not null check (step_count >= 3),
  -- Ordered array of tool names step-by-step. Cached on the parent row
  -- so the dashboard can render the chain without joining steps.
  tools               jsonb not null default '[]'::jsonb,
  -- Ordered array of capture categories step-by-step (parallel to tools).
  task_categories     jsonb not null default '[]'::jsonb,
  -- Canonical fingerprint of the ordered (tool, category) chain. SHA-256
  -- of the normalized lowercased pipe-separated string.
  sequence_hash       text not null,
  occurrence_count    integer not null default 1 check (occurrence_count >= 1),
  last_seen_at        timestamptz not null,
  confidence_score    numeric not null default 0.5 check (confidence_score >= 0 and confidence_score <= 1),
  -- Average duration (in seconds) across all observed occurrences.
  avg_duration_seconds integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (business_id, sequence_hash)
);

create index if not exists workflow_sequences_business_idx
  on public.workflow_sequences (business_id, confidence_score desc);
create index if not exists workflow_sequences_last_seen_idx
  on public.workflow_sequences (business_id, last_seen_at desc);

comment on table public.workflow_sequences is
  'Multi-step workflow patterns detected from capture chains. Keyed by (business_id, sequence_hash) so the same pattern across employees rolls into one row with occurrence_count > 1.';

-- ============================================================================
-- workflow_sequence_steps
-- ============================================================================

create table if not exists public.workflow_sequence_steps (
  id            uuid primary key default gen_random_uuid(),
  sequence_id   uuid not null references public.workflow_sequences(id) on delete cascade,
  -- The capture this step refers to. Lets us join back for employee_id,
  -- confidence, full task text, etc.
  capture_id    uuid not null references public.captures(id) on delete cascade,
  -- Position within this occurrence (0-indexed). One occurrence = one
  -- group of (step_index 0..N-1) rows sharing the same sequence_id.
  step_index    integer not null check (step_index >= 0),
  tool          text,
  category      text,
  task          text,
  captured_at   timestamptz not null,
  created_at    timestamptz not null default now(),

  -- Don't re-record the same capture as a step in the same sequence
  -- across re-detections. Detection logic checks this constraint to
  -- skip duplicates rather than counting them as new occurrences.
  unique (sequence_id, capture_id)
);

create index if not exists workflow_sequence_steps_sequence_idx
  on public.workflow_sequence_steps (sequence_id, step_index);
create index if not exists workflow_sequence_steps_capture_idx
  on public.workflow_sequence_steps (capture_id);

comment on table public.workflow_sequence_steps is
  'Per-step instances of detected workflow sequences. Multiple occurrences of the same sequence produce multiple (step_index 0..N-1) groups for the same sequence_id; differentiate by captured_at clustering.';

-- ============================================================================
-- RLS — owner-chain reads, service-role writes
-- ============================================================================

alter table public.workflow_sequences enable row level security;
alter table public.workflow_sequence_steps enable row level security;

drop policy if exists workflow_sequences_owner_select on public.workflow_sequences;
create policy workflow_sequences_owner_select on public.workflow_sequences
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

drop policy if exists workflow_sequence_steps_owner_select on public.workflow_sequence_steps;
create policy workflow_sequence_steps_owner_select on public.workflow_sequence_steps
  for select to authenticated
  using (
    sequence_id in (
      select s.id from public.workflow_sequences s
      join public.businesses b on b.id = s.business_id
      where b.owner_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies — only the detection cron (running
-- as service role, which bypasses RLS) writes to these tables.
