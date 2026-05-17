-- Cache for /api/workflow-intelligence.
--
-- The endpoint runs an expensive Claude semantic-clustering pass over the
-- business's last 7 days of captures. We don't want every 5-minute poll
-- (or every dashboard tab open) to re-run the model. One row per business;
-- the API checks `generated_at` and re-computes if older than 1 hour.
--
-- Service-role writes only; owner SELECT via RLS so the dashboard's polling
-- could theoretically read directly (in practice it goes through the
-- /api/workflow-intelligence route, which handles its own cache check).

create table if not exists public.workflow_intelligence_cache (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  payload jsonb not null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists workflow_intelligence_cache_touch_updated_at
  on public.workflow_intelligence_cache;
create trigger workflow_intelligence_cache_touch_updated_at
  before update on public.workflow_intelligence_cache
  for each row execute function public.touch_updated_at();

alter table public.workflow_intelligence_cache enable row level security;

drop policy if exists workflow_intelligence_cache_owner_select
  on public.workflow_intelligence_cache;
create policy workflow_intelligence_cache_owner_select
  on public.workflow_intelligence_cache
  for select to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- Writes are service-role only — no INSERT/UPDATE policies for anon or
-- authenticated. The /api/workflow-intelligence route uses serverSupabase().
