/**
 * Capability taxonomy — server-side loader.
 *
 * Single source of truth lives in the `capability_registry` table (see
 * supabase/migrations/0011_capability_registry.sql). This module caches the
 * full registry in-memory per process so route handlers don't roundtrip to
 * Postgres on every call. Cache TTL is short enough that adding a new
 * capability (via migration) shows up quickly across the fleet without a
 * deploy, but long enough that we're not hammering the DB.
 *
 * Use this from:
 *   - API routes that need to validate, label, or look up capabilities
 *   - The /api/capabilities route, which proxies this to the client
 *
 * Client components should NOT import this — use `useCapabilities()` from
 * lib/capabilities-client instead.
 */
import { serverSupabase } from './supabase'

export type Capability = {
  id: string
  label: string
  automatable: boolean
}

type Cache = {
  loadedAt: number
  list: Capability[]
  byId: Record<string, Capability>
}

let _cache: Cache | null = null
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function loadFromDb(): Promise<Capability[]> {
  const supabase = serverSupabase()
  const { data, error } = await supabase
    .from('capability_registry')
    .select('id, label, automatable')
    .order('sort_order')
  if (error) {
    throw new Error(`capability_registry read failed: ${error.message}`)
  }
  return (data ?? []) as Capability[]
}

async function ensureCache(): Promise<Cache> {
  const now = Date.now()
  if (_cache && now - _cache.loadedAt < CACHE_TTL_MS) {
    return _cache
  }
  const list = await loadFromDb()
  const byId: Record<string, Capability> = {}
  for (const c of list) byId[c.id] = c
  _cache = { loadedAt: now, list, byId }
  return _cache
}

/** Full taxonomy, ordered by sort_order. */
export async function getCapabilities(): Promise<Capability[]> {
  const cache = await ensureCache()
  return cache.list
}

/** Lookup map keyed by capability id. */
export async function getCapabilitiesById(): Promise<Record<string, Capability>> {
  const cache = await ensureCache()
  return cache.byId
}

/** Human-readable label, falling back to the id itself. */
export async function capabilityLabel(id: string): Promise<string> {
  const map = await getCapabilitiesById()
  return map[id]?.label ?? id
}

/** Force a refresh on the next call. Used by tests / cron / admin. */
export function invalidateCapabilityCache(): void {
  _cache = null
}
