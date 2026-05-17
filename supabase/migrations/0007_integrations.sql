-- Phase 4: integrations layer.
--
-- Three rings of connectivity:
--   Ring 1: detection only (window titles + URLs from captures). No DB row
--           needed — surfaced from captures.software aggregates.
--   Ring 2: Zapier bridge — owner sets up a Zap that POSTs to /api/integrations/zapier
--           with a per-business auth token. Each connected tool gets a row
--           in integrations with ring=2.
--   Ring 3: native MCP / OAuth integrations (Gmail, Drive, etc.). Same table,
--           ring=3. OAuth provisioning lives in a future phase.
--
-- integration_events captures the stream of webhook payloads we receive
-- so they can later be correlated with captures and feed opportunity
-- detection.

-- --- Per-business webhook secret -----------------------------------------
-- Pasted into Zapier as X-Groundwork-Token header so we can authenticate
-- incoming events. Lazy-generated on first connect from the settings UI.

alter table public.businesses
  add column if not exists webhook_secret text;

-- --- integrations: one row per (business, tool, ring) --------------------

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,

  -- Normalized lowercase tool identifier ("wellsky", "quickbooks", "gmail").
  -- Display name lives in config.display_name.
  tool_name text not null,

  -- Which ring this row represents
  ring integer not null,

  -- Lifecycle
  status text not null default 'detected',

  -- When the owner actively connected this tool (vs first-detected)
  connected_at timestamptz,

  -- Last incoming event (Ring 2 / 3 only). NULL until first event lands.
  last_event_at timestamptz,
  event_count integer not null default 0,

  -- Open-shape config: for Ring 2 typically { display_name, zap_url? }.
  -- For Ring 3 (future): { oauth_provider, token_ref, ... }
  config jsonb not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A tool can have multiple rings active at once (e.g., Gmail detected from
-- captures AND connected via OAuth). One row per (business, tool, ring).
create unique index if not exists integrations_business_tool_ring_uidx
  on public.integrations (business_id, tool_name, ring);

create index if not exists integrations_business_idx
  on public.integrations (business_id);

alter table public.integrations
  drop constraint if exists integrations_ring_chk;
alter table public.integrations
  add constraint integrations_ring_chk check (ring in (1, 2, 3));

alter table public.integrations
  drop constraint if exists integrations_status_chk;
alter table public.integrations
  add constraint integrations_status_chk
  check (status in ('detected', 'pending', 'connected', 'error', 'disconnected'));

drop trigger if exists integrations_touch_updated_at on public.integrations;
create trigger integrations_touch_updated_at
  before update on public.integrations
  for each row execute function public.touch_updated_at();

-- --- integration_events: incoming webhook payloads ----------------------

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,

  -- May be null if we receive an event before the integrations row is
  -- materialized (we'll backfill on the fly).
  integration_id uuid references public.integrations(id) on delete set null,

  -- Optional: if the webhook payload includes a recognizable employee
  -- email/id, link it. Otherwise null.
  employee_id uuid references public.employees(id) on delete set null,

  -- Optional: if a capture overlaps this event's occurred_at within a
  -- window (e.g., ±2 min), link it. Correlation runs async; nullable.
  capture_id uuid references public.captures(id) on delete set null,

  tool_name text not null,
  event_type text not null,
  event_data jsonb not null default '{}',

  -- When the event happened in the source system (Zapier's "trigger time")
  occurred_at timestamptz not null default now(),
  -- When we received it
  received_at timestamptz not null default now(),

  created_at timestamptz not null default now()
);

create index if not exists integration_events_business_occurred_idx
  on public.integration_events (business_id, occurred_at desc);

create index if not exists integration_events_business_tool_idx
  on public.integration_events (business_id, tool_name);

create index if not exists integration_events_employee_idx
  on public.integration_events (employee_id) where employee_id is not null;

-- --- RLS -----------------------------------------------------------------
-- Anon SELECT (matches captures / employees convention). Writes through
-- service-role API routes only.

alter table public.integrations enable row level security;
drop policy if exists integrations_anon_select on public.integrations;
create policy integrations_anon_select on public.integrations
  for select to anon, authenticated using (true);

alter table public.integration_events enable row level security;
drop policy if exists integration_events_anon_select on public.integration_events;
create policy integration_events_anon_select on public.integration_events
  for select to anon, authenticated using (true);
