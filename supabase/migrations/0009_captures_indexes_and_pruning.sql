-- Captures hardening: add the foundational indexes the dashboard relies on
-- AND drop two columns that are never read (raw_json, flags).
--
-- The captures table was created before migration 0001, so the repo has no
-- record of which indexes exist on the most-queried columns. These three
-- adds are idempotent (if not exists) so re-running is safe even if some
-- already exist.

-- --- Indexes ----------------------------------------------------------

-- Hot path: "latest capture per employee" + "captures for employee in
-- date range". Composite (employee_id, captured_at desc) covers both.
create index if not exists captures_employee_captured_idx
  on public.captures (employee_id, captured_at desc);

-- Hot path: business-scoped aggregations and the
-- /api/detect-opportunities + /api/discover-roles cron reads.
create index if not exists captures_business_captured_idx
  on public.captures (business_id, captured_at desc);

-- Hot path: business-scoped category rollups (dashboard stats),
-- excluding non-work which doesn't get aggregated. Partial index
-- keeps the index small.
create index if not exists captures_business_category_idx
  on public.captures (business_id, category)
  where category != 'Break or Idle';

-- --- Drop unused columns ---------------------------------------------

-- raw_json averages ~1.3 KB/row and is never queried. At any
-- production-scale capture volume this is multi-GB of dead weight in
-- the hot table.
alter table public.captures
  drop column if exists raw_json;

-- flags was the pre-capability-taxonomy flag enum. Superseded by
-- captures.capabilities (jsonb) — no reader references it anywhere.
alter table public.captures
  drop column if exists flags;
