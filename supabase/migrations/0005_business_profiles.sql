-- Phase 2: conversational business intake.
--
-- One profile row per business. Held in a separate table from businesses
-- because (a) the intake transcript is large and we don't want it on every
-- businesses query, and (b) profile fields are mostly jsonb whose shape
-- will evolve as we learn what the intake agent actually produces.
--
-- The classifier reads this via /api/activate (baked into the agent's
-- config.json), and again any time we refresh context for a long-running
-- agent. The fields here mirror the business_context block in classify.py's
-- system prompt.

create table if not exists public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,

  -- Raw intake artifacts. Kept for training / future re-extraction and so
  -- the owner can see "what did I tell you about my business" later.
  intake_transcript jsonb not null default '[]'::jsonb,
  intake_completed_at timestamptz,
  intake_skipped_at timestamptz,

  -- Structured profile — see classify.py _format_business_context for
  -- exactly which fields the classifier consumes.
  industry text,
  sub_industry text,                       -- richer description
  size_band text,                          -- e.g. "small (10-50 employees)"
  operations_vocab jsonb not null default '{}'::jsonb,  -- {shifts: "shifts", customers: "clients", ...}
  tool_stack jsonb not null default '[]'::jsonb,        -- [{name, used_for[]}]
  workflows jsonb not null default '[]'::jsonb,         -- [{name, description}]
  pain_points jsonb not null default '[]'::jsonb,       -- [{description, severity}]
  roles jsonb not null default '[]'::jsonb,             -- [{title, responsibilities[]}] — sketch only; refined by Phase 3 Role Discovery
  compliance_constraints text[] not null default '{}',

  -- Per-field confidence (0-1) so the intake agent knows what to dig into
  -- on follow-ups. Same shape as the structured fields above.
  field_confidence jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists business_profiles_touch_updated_at on public.business_profiles;
create trigger business_profiles_touch_updated_at
  before update on public.business_profiles
  for each row execute function public.touch_updated_at();

-- Hot read path: by business_id (1:1, unique above)
create index if not exists business_profiles_business_idx
  on public.business_profiles (business_id);

-- RLS: anon SELECT allowed, matching the convention elsewhere.
-- Writes go through service-role API routes (intake chat + intake complete).
-- Same multi-tenant caveat applies — no business-scoped RLS yet.
alter table public.business_profiles enable row level security;

drop policy if exists business_profiles_anon_select on public.business_profiles;
create policy business_profiles_anon_select
  on public.business_profiles
  for select
  to anon, authenticated
  using (true);
