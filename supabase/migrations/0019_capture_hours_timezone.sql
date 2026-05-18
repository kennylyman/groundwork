-- Timezone support for capture hours.
--
-- 0018 introduced business_profiles.capture_hours jsonb with:
--   { days, start_time, end_time }
--
-- That implicitly meant "the agent's local time" — which breaks for
-- remote teams where the owner sits in PT but employees are in ET
-- (or the other way around). Agent in NY at 7am thinks "I'm before
-- the 8am-6pm window" but the owner expects work to be captured
-- because in their PT frame it's only 4am.
--
-- Fix: timezone lives inside the same jsonb so the whole capture
-- config travels as one unit. Default = America/Los_Angeles (CK's
-- timezone). Agent does the conversion: datetime.now(pytz.timezone(tz)).
--
-- We extend the jsonb shape rather than adding a separate column —
-- one read, one write, one place to think about defaults. The
-- backfill below ensures every existing row has the timezone key set
-- so the agent never sees missing field.

update public.business_profiles
   set capture_hours = capture_hours || '{"timezone": "America/Los_Angeles"}'::jsonb
 where capture_hours is not null
   and not (capture_hours ? 'timezone');
