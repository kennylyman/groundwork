-- Business-hours config for capture scheduling.
--
-- Before v0.5.2, the Windows agent captured around the clock — including
-- overnight, weekends, and lunch breaks. That produced a lot of
-- "Break or Idle" rows + sent the owner a 23-hour-silent-agent email
-- every morning. The agent now gates captures by configurable business
-- hours; this column holds the config.
--
-- Shape:
--   {
--     "days": ["mon","tue","wed","thu","fri"],   // ISO weekday abbrevs, lowercase
--     "start_time": "08:00",                     // HH:MM, 24h, local time
--     "end_time":   "18:00"
--   }
--
-- Defaults applied when the column is null:
--   Mon-Fri, 08:00-18:00 local time.
--
-- Timezone: deliberately not stored. Each employee's agent uses its own
-- machine's local time. Owners in CK with employees across timezones
-- get the right hours per-machine without us having to model
-- per-employee timezone state.

alter table public.business_profiles
  add column if not exists capture_hours jsonb;
