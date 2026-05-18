-- Enable RLS on public.sessions and add owner-chain policies, matching
-- the pattern already in 0010_rls_owner_chain.sql for captures.
--
-- Why this was missed: sessions predates the multi-tenant RLS pass but
-- wasn't included in 0010 (oversight — Supabase advisor flagged it).
-- The table is currently empty so there's no backfill concern. Still
-- worth shipping promptly because anyone with the anon key (every
-- shipped agent binary) can otherwise read or modify every business's
-- session rows.
--
-- Access model (mirrors captures):
--   - Owner (authenticated, dashboard side): SELECT all sessions whose
--     business_id resolves to a business they own.
--   - Agent (anon, via /rest/v1/sessions): INSERT new active sessions
--     and PATCH them to "completed" on shutdown. Defensive sanity check
--     requires business_id to reference a real business — real per-
--     employee scoping lives in the install_token contract the agent
--     uses to obtain its config, same trust model as captures_anon_insert.
--   - Service role: bypasses RLS automatically (used by all
--     serverSupabase() callers).
--
-- Follow-up: move session create/update to a server-side ingestion
-- endpoint (analogous to /api/captures) so the anon write surface can
-- be removed entirely. Tracked separately; not blocking this fix.

alter table public.sessions enable row level security;

-- Defensive drops in case anything was added out-of-band.
drop policy if exists sessions_anon_select on public.sessions;
drop policy if exists sessions_owner_select on public.sessions;
drop policy if exists sessions_anon_insert on public.sessions;
drop policy if exists sessions_anon_update on public.sessions;

-- Owner reads via business chain — same shape as captures_owner_select.
create policy sessions_owner_select on public.sessions
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- Agent inserts new "active" session rows. The business_id must reference
-- a real business; the real per-employee scoping comes from the agent's
-- install_token (which is what got it the supabase_url/anon_key in the
-- first place). Same posture as captures_anon_insert.
create policy sessions_anon_insert on public.sessions
  for insert to anon
  with check (business_id in (select id from public.businesses));

-- Agent PATCHes the row on shutdown to set status='completed',
-- total_captures, ended_at. Both USING (target row) and WITH CHECK
-- (post-update row) require a real business_id so a stolen anon key
-- can't reassign rows across tenants.
create policy sessions_anon_update on public.sessions
  for update to anon
  using (business_id in (select id from public.businesses))
  with check (business_id in (select id from public.businesses));

-- Intentionally no DELETE policy — service role only.
