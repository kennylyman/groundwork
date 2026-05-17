-- Phase 4: per-business role hourly rates. Feeds intelligence report cost math
-- and opportunity savings estimates. Defaults stay hardcoded in the API
-- routes (server-side) and only apply when the column is null/missing a
-- key — owner-set values override.

alter table public.business_profiles
  add column if not exists role_hourly_rates jsonb not null default '{}'::jsonb;
