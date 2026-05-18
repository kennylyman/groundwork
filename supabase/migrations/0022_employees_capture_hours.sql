-- Per-employee capture schedule override.
--
-- Until now, capture_hours was business-level only (business_profiles.capture_hours).
-- That covers the common case ("everyone captures Mon-Fri 8-6 PT") but breaks
-- down for businesses with non-uniform schedules — a Friday-off scheduler, a
-- 5am-2pm payroll specialist, a remote employee on a different rotation.
--
-- Semantics:
--   - NULL  → use business_profiles.capture_hours (existing behavior).
--   - JSONB → per-employee override; shape matches CaptureHours
--             ({ days, start_time, end_time, timezone }).
--
-- Resolution happens in /api/settings/capture GET, which the agent fetches on
-- startup and once an hour. The agent code itself is unaffected — it consumes
-- whatever the endpoint returns. Pre-migration employees default to NULL, so
-- their behavior is identical to before (inherits business default).

alter table public.employees
  add column if not exists capture_hours jsonb null;

comment on column public.employees.capture_hours is
  'Per-employee capture schedule override. NULL inherits from business_profiles.capture_hours. Shape: { days: ["mon",...,"sun"], start_time: "HH:MM", end_time: "HH:MM", timezone: "IANA/Zone" }. Times are evaluated within the specified timezone — see lib/capture-hours.ts for parsing.';
