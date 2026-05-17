-- Audit log for every callTool invocation.
--
-- Phase 5 starts firing real reads + writes on customers' connected
-- tools (Slack messages sent, Outlook events created, etc.). We need a
-- durable audit trail of who ran what and what happened. Vercel
-- function logs are too ephemeral (90-day retention on Pro, less on
-- Hobby, no per-row queryability).
--
-- One row per callTool dispatch — both successes and failures. Token
-- values are NEVER written here; the args column is sanitized by the
-- runtime before insert.

create table if not exists public.tool_call_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  tool_name text not null,
  operation text not null,
  -- Sanitized args (no tokens, no full payloads). The runtime strips
  -- anything that looks like a secret before persisting.
  args jsonb,
  -- "ok" or one of the CallToolResult error codes.
  status text not null,
  -- Short summary for successes ("messages: 3", "id: m_abc..."), error
  -- message for failures (truncated to 500 chars).
  result_summary text,
  duration_ms integer not null,
  caller text,                                -- "automation", "enrichment", "manual", etc.
  created_at timestamptz not null default now()
);

-- Hot query: "show me callTool history for this business's tool" on
-- /settings/integrations and Phase-5 admin panels.
create index if not exists tool_call_logs_business_created_idx
  on public.tool_call_logs (business_id, created_at desc);

-- Hot query: "show me every recent failure across the platform" for ops.
create index if not exists tool_call_logs_status_idx
  on public.tool_call_logs (status, created_at desc)
  where status != 'ok';

alter table public.tool_call_logs enable row level security;

-- Owners see their own business's tool calls. Helps debugging without
-- exposing other tenants' activity.
drop policy if exists tool_call_logs_owner_select on public.tool_call_logs;
create policy tool_call_logs_owner_select on public.tool_call_logs
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- Writes are service-role only (the runtime inserts).
