-- Startup error telemetry table.
--
-- Before this, when an agent failed between process start and its first
-- successful /api/agent-version call, the server saw "token redeemed,
-- agent_version null" and we had to guess at the failure class (Norton
-- DLL block? Read-only APPDATA? ImportError? Network down?). Five of
-- 13 employees got stuck in exactly this state on day-1 launch.
--
-- The agent now POSTs to /api/agent/startup-error on any pre-heartbeat
-- crash, attaching the exception class, exception message, Windows
-- version, agent version, and (when available) the install_token so
-- the row can attribute to a specific employee.
--
-- install_token is OPTIONAL. The most useful case is a first-launch
-- crash BEFORE the user enters their token, so we can't require it for
-- auth. The server resolves employee_id/business_id from the token
-- when present; otherwise stores nulls. Rate limit on the API route
-- itself stops anon abuse.
--
-- RLS: owner-chain SELECT (employees of the same business can be
-- inspected by the owner; null rows are invisible to everyone but
-- service role — those are debug-only and we read them via MCP).

create extension if not exists "pgcrypto";

create table if not exists public.agent_startup_errors (
  id                  uuid primary key default gen_random_uuid(),
  -- Nullable because pre-activation crashes happen before any token
  -- is associated with the launch. ON DELETE SET NULL so deleting an
  -- employee row doesn't lose the historical crash record.
  employee_id         uuid references public.employees(id) on delete set null,
  business_id         uuid references public.businesses(id) on delete set null,
  error_type          text not null,
  error_message       text,
  -- platform.platform() output — e.g. "Windows-10-10.0.19045-SP0".
  -- Useful for spotting failures clustered to a specific Windows build.
  windows_version     text,
  agent_version       text,
  -- When the agent observed the failure on the user's machine. The
  -- POST may arrive moments later (queue / retry).
  occurred_at         timestamptz not null,
  -- First 8 chars of sha256(install_token), even if the token was
  -- invalid. Lets us cross-reference repeated failures from the same
  -- machine without storing the raw token. Null when no token sent.
  install_token_hint  text,
  -- For abuse triage on anonymous (no-token) reports.
  request_ip          text,
  user_agent          text,
  created_at          timestamptz not null default now()
);

-- Owner dashboard query path: most-recent errors per business.
create index if not exists agent_startup_errors_business_idx
  on public.agent_startup_errors (business_id, occurred_at desc);
-- Cross-tenant pattern detection: which error_type is spiking across
-- the fleet? Useful when triaging "is this a Norton thing or a
-- Bitdefender thing?"
create index if not exists agent_startup_errors_type_idx
  on public.agent_startup_errors (error_type, occurred_at desc);

comment on table public.agent_startup_errors is
  'Agent-side crashes between process start and first successful /api/agent-version call. Closes the "token redeemed, agent_version null" blind spot from the day-1 rollout. Posted by main.py wrap-everything try/except. employee_id/business_id null when the crash happened before the user entered their install_token.';

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.agent_startup_errors enable row level security;

drop policy if exists agent_startup_errors_owner_select on public.agent_startup_errors;
create policy agent_startup_errors_owner_select on public.agent_startup_errors
  for select to authenticated
  using (
    business_id is not null
    and business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- No INSERT/UPDATE/DELETE policies. The /api/agent/startup-error route
-- writes as service role (bypasses RLS). Anonymous rows (no business_id)
-- are intentionally invisible to all authenticated users — they're
-- triage-only and inspected via MCP / direct DB access.
