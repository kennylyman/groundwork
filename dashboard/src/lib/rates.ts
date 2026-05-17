/**
 * Role-based hourly rates. Owner can override per-business via
 * /settings/pricing → business_profiles.role_hourly_rates. Anything not
 * overridden falls back to the DEFAULT_RATES below.
 *
 * Matching is tolerant: "Senior Scheduler" → "scheduler".
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const DEFAULT_HOURLY_RATE = 25

export const DEFAULT_RATES: Record<string, number> = {
  scheduler: 24,
  scheduling: 24,
  billing: 28,
  biller: 28,
  caregiver: 20,
  admin: 25,
  administrator: 25,
  manager: 35,
  owner: 50,
}

function pickRate(
  role: string | null | undefined,
  rates: Record<string, number>
): number | null {
  if (!role) return null
  const norm = role.trim().toLowerCase()
  for (const [key, rate] of Object.entries(rates)) {
    if (norm.includes(key.toLowerCase())) return rate
  }
  return null
}

/**
 * Resolve hourly rate for an employee role against a business's
 * overrides + the hardcoded defaults.
 */
export function resolveRate(
  role: string | null | undefined,
  overrides: Record<string, number> | null | undefined
): number {
  if (overrides && Object.keys(overrides).length > 0) {
    const fromOverride = pickRate(role, overrides)
    if (fromOverride !== null) return fromOverride
  }
  const fromDefault = pickRate(role, DEFAULT_RATES)
  return fromDefault ?? DEFAULT_HOURLY_RATE
}

/**
 * One-shot fetch of a business's rate overrides from business_profiles.
 * Returns {} if no profile exists yet — callers fall back to DEFAULT_RATES.
 */
export async function loadRateOverrides(
  supabase: SupabaseClient,
  businessId: string
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('business_profiles')
    .select('role_hourly_rates')
    .eq('business_id', businessId)
    .maybeSingle()
  const raw = (data?.role_hourly_rates as Record<string, number> | undefined) ?? {}
  // Defensive — strip any garbage values
  const cleaned: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      cleaned[k.toLowerCase()] = v
    }
  }
  return cleaned
}
