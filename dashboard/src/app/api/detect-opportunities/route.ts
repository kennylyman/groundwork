/**
 * Pattern detection — turns capability tags on recent captures into rows in
 * the opportunities table.
 *
 * Trigger paths:
 *   - Vercel cron (vercel.json schedule). Requires CRON_SECRET header.
 *   - Manual: GET or POST with optional ?employee_id= to scope to one person.
 *
 * Algorithm (Phase 1 — single-capability frequency):
 *   1. Pull active employees per business.
 *   2. For each employee, fetch their captures from the last 7 days that
 *      have at least one capability tag.
 *   3. Group capability tag occurrences by (capability_id + key_params).
 *   4. Any group with >= MIN_OCCURRENCES is an opportunity candidate.
 *   5. Score + UPSERT by pattern_signature.
 *
 * Multi-capability sequence detection (e.g., "lookup → transfer → notify
 * appearing 3+ times in order") is a future enhancement — Phase 1 ships
 * with the simpler version.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { serverSupabase } from '@/lib/supabase'
import { CAPABILITY_BY_ID, capabilityLabel } from '@/lib/capabilities'
import { loadRateOverrides, resolveRate } from '@/lib/rates'

export const maxDuration = 60

// ----- Tunables ------------------------------------------------------------

const WINDOW_DAYS = 7
const CAPTURE_INTERVAL_SECONDS = 30
const MIN_OCCURRENCES = 3
const WORKING_DAYS_PER_YEAR = 250

// Assume well-tuned automations recover ~70% of the time spent on the task.
// Conservative — we'd rather under-promise.
const SAVINGS_RATE = 0.7

// Rate resolution shares lib/rates with /api/generate-intelligence so the two
// views never disagree on dollar figures. Owner overrides come from
// business_profiles.role_hourly_rates (via /settings/pricing).

// Keys we hash into the pattern signature — these are the ones that
// distinguish two opportunities of the same capability. Everything else
// (free-text descriptions, etc.) is *not* hashed, so minor wording
// variations don't fork the same opportunity into two rows.
const SIGNATURE_PARAM_KEYS = ['source', 'destination', 'tool', 'target', 'app']

// ----- Types ---------------------------------------------------------------

type CapabilityTag = {
  id: string
  params?: Record<string, unknown>
  confidence?: number
}

type CaptureRow = {
  id: string
  business_id: string
  employee_id: string
  captured_at: string
  capabilities: CapabilityTag[] | null
}

type EmployeeRow = {
  id: string
  business_id: string
  role: string | null
  is_active: boolean
}

type DetectedOpportunity = {
  business_id: string
  employee_id: string
  pattern_signature: string
  title: string
  description: string
  capability_pattern: Record<string, unknown>
  occurrence_count: number
  estimated_weekly_minutes: number
  estimated_annual_cost: number
  estimated_annual_savings: number
  confidence: number
  automation_class: 'A' | 'B' | 'C'
  last_seen_at: string
}

// ----- Helpers -------------------------------------------------------------

function authorized(req: NextRequest): boolean {
  // Cron path: header set by vercel.json schedule
  const cronHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && cronHeader === `Bearer ${cronSecret}`) return true

  // Otherwise: allow if not in production, so devs can poke at it.
  if (process.env.VERCEL_ENV !== 'production') return true

  return false
}

function normalizeParams(params: Record<string, unknown> | undefined) {
  // Lowercase + trim string values, keep only the keys we hash.
  if (!params) return {}
  const out: Record<string, string> = {}
  for (const k of SIGNATURE_PARAM_KEYS) {
    const v = params[k]
    if (typeof v === 'string' && v.trim()) {
      out[k] = v.trim().toLowerCase()
    }
  }
  return out
}

function patternSignature(
  businessId: string,
  employeeId: string,
  capabilityId: string,
  keyParams: Record<string, string>
): string {
  const sortedParams = Object.keys(keyParams)
    .sort()
    .map((k) => `${k}=${keyParams[k]}`)
    .join('|')
  const raw = `${businessId}::${employeeId}::${capabilityId}::${sortedParams}`
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function describePattern(capabilityId: string, params: Record<string, string>): {
  title: string
  description: string
} {
  const label = capabilityLabel(capabilityId)
  const bits: string[] = []
  if (params.source) bits.push(`from ${params.source}`)
  if (params.destination) bits.push(`to ${params.destination}`)
  if (params.tool && !bits.length) bits.push(`in ${params.tool}`)
  if (params.target && !bits.length) bits.push(`on ${params.target}`)
  if (params.app && !bits.length) bits.push(`using ${params.app}`)
  const suffix = bits.length ? ' ' + bits.join(' ') : ''
  return {
    title: `${label}${suffix}`,
    description: `Repeated pattern detected in the last ${WINDOW_DAYS} days.`,
  }
}

function automationClassFor(capability: typeof CAPABILITY_BY_ID[string]): 'A' | 'B' | 'C' {
  // Phase 1 heuristic: anything in the data.* / communication.send.* /
  // monitoring.* namespaces is Zapier-able (Class A). Workflow ops and
  // admin.* tend to need a composed agent (Class B). Everything else
  // automatable but un-categorized falls to Class C.
  if (!capability?.automatable) return 'C'
  const id = capability.id
  if (
    id.startsWith('data.') ||
    id.startsWith('communication.send.') ||
    id.startsWith('monitoring.') ||
    id === 'communication.triage.inbox'
  ) {
    return 'A'
  }
  if (id.startsWith('workflow.') || id.startsWith('admin.')) return 'B'
  return 'C'
}

function scoreConfidence(
  occurrenceCount: number,
  avgTagConfidence: number
): number {
  // log1p damps runaway counts; clamp 0..1.
  // 50 occurrences ~ 3.93/4.61 saturation, 3 occurrences ~ 1.39/4.61
  const freqScore = Math.log1p(occurrenceCount) / Math.log1p(50)
  const tagScore = Math.min(1, Math.max(0, avgTagConfidence / 100))
  const combined = freqScore * 0.6 + tagScore * 0.4
  return Math.round(Math.min(1, Math.max(0, combined)) * 1000) / 1000
}

// ----- Core detection ------------------------------------------------------

async function detectForEmployee(
  supabase: ReturnType<typeof serverSupabase>,
  employee: EmployeeRow,
  windowStartIso: string,
  rateOverrides: Record<string, number>
): Promise<DetectedOpportunity[]> {
  const { data: captures, error } = await supabase
    .from('captures')
    .select('id, business_id, employee_id, captured_at, capabilities')
    .eq('employee_id', employee.id)
    .gte('captured_at', windowStartIso)
    .not('capabilities', 'is', null)

  if (error) throw new Error(`captures fetch failed: ${error.message}`)
  if (!captures || captures.length === 0) return []

  // Bucket tag occurrences by (capability_id + key_params).
  type Bucket = {
    capabilityId: string
    keyParams: Record<string, string>
    occurrenceCount: number
    confidenceSum: number
    representativeCaptureIds: string[]
    lastSeenAt: string
    fullParamsExample: Record<string, unknown>
  }
  const buckets = new Map<string, Bucket>()

  for (const cap of captures as CaptureRow[]) {
    const tags = Array.isArray(cap.capabilities) ? cap.capabilities : []
    for (const tag of tags) {
      if (!tag || typeof tag.id !== 'string') continue
      const taxonomyEntry = CAPABILITY_BY_ID[tag.id]
      if (!taxonomyEntry?.automatable) continue // skip non-automatable tags

      const keyParams = normalizeParams(tag.params as Record<string, unknown>)
      const sig = `${tag.id}::${JSON.stringify(keyParams)}`

      const existing = buckets.get(sig)
      if (existing) {
        existing.occurrenceCount += 1
        existing.confidenceSum += tag.confidence ?? 0
        existing.lastSeenAt =
          cap.captured_at > existing.lastSeenAt ? cap.captured_at : existing.lastSeenAt
        if (existing.representativeCaptureIds.length < 5) {
          existing.representativeCaptureIds.push(cap.id)
        }
      } else {
        buckets.set(sig, {
          capabilityId: tag.id,
          keyParams,
          occurrenceCount: 1,
          confidenceSum: tag.confidence ?? 0,
          representativeCaptureIds: [cap.id],
          lastSeenAt: cap.captured_at,
          fullParamsExample: (tag.params as Record<string, unknown>) ?? {},
        })
      }
    }
  }

  // Convert buckets to opportunities.
  const hourlyRate = resolveRate(employee.role, rateOverrides)
  const out: DetectedOpportunity[] = []

  for (const b of buckets.values()) {
    if (b.occurrenceCount < MIN_OCCURRENCES) continue

    const taxonomyEntry = CAPABILITY_BY_ID[b.capabilityId]
    if (!taxonomyEntry) continue

    const observedMinutes = (b.occurrenceCount * CAPTURE_INTERVAL_SECONDS) / 60
    const observedHoursPerWeek = observedMinutes / 60
    const annualHours = observedHoursPerWeek * (WORKING_DAYS_PER_YEAR / 5) // assume 5 working days/week observation
    const annualCost = Math.round(annualHours * hourlyRate)
    const annualSavings = Math.round(annualCost * SAVINGS_RATE)

    const avgConf = b.occurrenceCount > 0 ? b.confidenceSum / b.occurrenceCount : 0
    const confidence = scoreConfidence(b.occurrenceCount, avgConf)

    const { title, description } = describePattern(b.capabilityId, b.keyParams)

    out.push({
      business_id: employee.business_id,
      employee_id: employee.id,
      pattern_signature: patternSignature(
        employee.business_id,
        employee.id,
        b.capabilityId,
        b.keyParams
      ),
      title,
      description,
      capability_pattern: {
        capability_id: b.capabilityId,
        key_params: b.keyParams,
        params_example: b.fullParamsExample,
        representative_capture_ids: b.representativeCaptureIds,
      },
      occurrence_count: b.occurrenceCount,
      estimated_weekly_minutes: Math.round(observedMinutes),
      estimated_annual_cost: annualCost,
      estimated_annual_savings: annualSavings,
      confidence,
      automation_class: automationClassFor(taxonomyEntry),
      last_seen_at: b.lastSeenAt,
    })
  }

  return out
}

async function upsertOpportunities(
  supabase: ReturnType<typeof serverSupabase>,
  opps: DetectedOpportunity[]
): Promise<number> {
  if (opps.length === 0) return 0
  // Status defaults to 'new' for fresh inserts; we don't overwrite an
  // existing reviewed/approved/etc. status on re-detection.
  const { error } = await supabase
    .from('opportunities')
    .upsert(
      opps.map((o) => ({
        ...o,
        // capability_pattern is jsonb — pg-js handles serialization
      })),
      {
        onConflict: 'business_id,employee_id,pattern_signature',
        ignoreDuplicates: false,
      }
    )
  if (error) throw new Error(`opportunities upsert failed: ${error.message}`)
  return opps.length
}

// ----- HTTP handlers -------------------------------------------------------

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const supabase = serverSupabase()
    const url = new URL(req.url)
    const scopedEmployeeId = url.searchParams.get('employee_id')

    const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

    let query = supabase
      .from('employees')
      .select('id, business_id, role, is_active')
      .eq('is_active', true)
    if (scopedEmployeeId) query = query.eq('id', scopedEmployeeId)

    const { data: employees, error: empErr } = await query
    if (empErr) throw new Error(`employees fetch failed: ${empErr.message}`)
    if (!employees || employees.length === 0) {
      return NextResponse.json({ processed_employees: 0, detected: 0 })
    }

    let totalDetected = 0
    let totalEmployeesProcessed = 0
    const errors: string[] = []

    // Cache rate overrides per business so we don't re-fetch for every
    // employee in the same business.
    const ratesByBusiness = new Map<string, Record<string, number>>()
    async function getOverrides(bizId: string) {
      const cached = ratesByBusiness.get(bizId)
      if (cached) return cached
      const fetched = await loadRateOverrides(supabase, bizId).catch(() => ({}))
      ratesByBusiness.set(bizId, fetched)
      return fetched
    }

    for (const emp of employees as EmployeeRow[]) {
      try {
        const overrides = await getOverrides(emp.business_id)
        const detected = await detectForEmployee(supabase, emp, windowStart, overrides)
        const upserted = await upsertOpportunities(supabase, detected)
        totalDetected += upserted
        totalEmployeesProcessed += 1
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error'
        errors.push(`employee=${emp.id}: ${message}`)
      }
    }

    return NextResponse.json({
      processed_employees: totalEmployeesProcessed,
      detected: totalDetected,
      window_days: WINDOW_DAYS,
      errors: errors.length ? errors : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('detect-opportunities: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
