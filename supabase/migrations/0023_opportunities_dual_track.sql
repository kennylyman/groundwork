-- Dual-track opportunity scoring.
--
-- Before: a single frequency threshold (MIN_OCCURRENCES = 3) classified
-- everything. That penalizes high-value recurring workflows that fire
-- weekly/biweekly/monthly — payroll, billing runs, royalty reports —
-- because 3 hours of data can't possibly accumulate enough hits.
--
-- After: detection separates two tracks.
--   Track 1 ("high_frequency"):  ≥5 obs, ≥3 days span, ≥0.75 confidence
--                                — same daily/weekly automations as before
--   Track 2 ("recurring"):       ≥2 obs, ≥7 days span, ≥0.80 confidence,
--                                category/task must suggest a periodic
--                                business process (billing, payroll, etc).
--                                Cadence estimated from interval avg.
--
-- Columns added:
--   detection_track       — which track produced this row. Default
--                           'high_frequency' so existing rows keep their
--                           prior semantics until rescore touches them.
--   estimated_cadence     — null on Track 1, 'weekly'/'biweekly'/'monthly'
--                           on Track 2 from interval average.
--   cross_employee_count  — number of distinct employees in this business
--                           whose detection produced the same (capability,
--                           key_params) signature. Default 1 (single
--                           employee). Multi-employee recurring patterns
--                           are a much stronger signal regardless of
--                           per-employee frequency.

alter table public.opportunities
  add column if not exists detection_track text
    check (detection_track in ('high_frequency', 'recurring'))
    default 'high_frequency';

alter table public.opportunities
  add column if not exists estimated_cadence text
    check (estimated_cadence in ('weekly', 'biweekly', 'monthly'));

alter table public.opportunities
  add column if not exists cross_employee_count integer
    not null
    default 1
    check (cross_employee_count >= 1);

comment on column public.opportunities.detection_track is
  'Which detection track produced this row. high_frequency = daily/multi-times-per-week patterns; recurring = weekly/biweekly/monthly periodic business processes.';
comment on column public.opportunities.estimated_cadence is
  'Estimated cadence for Track 2 (recurring) opportunities. Null on Track 1. Computed from the average interval between observations.';
comment on column public.opportunities.cross_employee_count is
  'How many distinct employees in this business have the same (capability, key_params) signature. 1 = single-employee habit. >1 = team-wide pattern, much stronger signal.';

create index if not exists opportunities_detection_track_idx
  on public.opportunities (business_id, detection_track);
