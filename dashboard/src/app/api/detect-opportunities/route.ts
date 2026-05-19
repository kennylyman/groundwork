/**
 * Pattern detection — turns capability tags on recent captures into rows in
 * the opportunities table.
 *
 * Trigger paths:
 *   - Vercel cron (vercel.json schedule). Requires CRON_SECRET header.
 *   - Manual: GET or POST with optional ?employee_id= to scope to one person.
 *   - Rescore: POST with ?rescore=true (or ?cleanup=true) re-evaluates
 *     every existing row in scope against the current rules and deletes
 *     anything that no longer qualifies. Preserves status on rows that
 *     survive.
 *
 * Dual-track scoring (v2):
 *
 *   Track 1 — "high_frequency"   daily / multi-times-per-week patterns
 *     ≥ 5 observations
 *     ≥ 3 days span between first and last observation
 *     ≥ 0.75 confidence (freq * 0.6 + tag * 0.4 scoring)
 *
 *   Track 2 — "recurring"        weekly / biweekly / monthly periodic
 *                                business processes
 *     ≥ 2 observations
 *     ≥ 7 days span (rules out "happened twice in one session")
 *     ≥ 0.80 confidence (tag-centric scoring with regularity boost)
 *     Category or task must match a periodic-process keyword
 *     Cadence estimated from average interval and surfaced on the card
 *
 *   Cross-employee weighting (both tracks):
 *     After per-employee detection, the same (capability_id, key_params)
 *     signature is counted across employees. cross_employee_count >= 2
 *     gets a confidence boost and surfaces as "Done by N people" in the UI.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { serverSupabase } from '@/lib/supabase'
import {
  getCapabilitiesById,
  type Capability,
} from '@/lib/capabilities-server'
import { loadRateOverrides, resolveRate } from '@/lib/rates'
import {
  detectSequencesForEmployee,
  scoreSequenceConfidence,
  SESSION_GAP_MS,
  type CaptureRowForDetection,
  type DetectedSequenceOccurrence,
} from '@/lib/sequence-detection'
import {
  matchAffinity,
  classifyBottleneck,
  scoreHandoffConfidence,
  HANDOFF_WINDOW_MS,
  HANDOFF_MIN_GAP_MS,
} from '@/lib/handoffs'

export const maxDuration = 60

// ----- Tunables ------------------------------------------------------------

// Detection window — 30 days so Track 2 patterns (which need a 7-day
// minimum span) have room to fire. Track 1 still only uses recent data
// for its observation count.
const WINDOW_DAYS = 30
const CAPTURE_INTERVAL_SECONDS = 30
const WORKING_DAYS_PER_YEAR = 250

// Track 1 — high-frequency thresholds. Tightened from the v1 floor of
// MIN_OCCURRENCES = 3 because 3 hits in 3 hours of data was generating
// 40+ noise opportunities per employee in early testing.
const TRACK1_MIN_OBS = 5
const TRACK1_MIN_SPAN_DAYS = 3
const TRACK1_MIN_CONFIDENCE = 0.75

// Track 2 — recurring-pattern thresholds. The 7-day minimum span is the
// key distinguisher: it rules out "the user did this twice in one
// session" while still letting a monthly task surface after the second
// occurrence. Higher confidence floor (0.80) compensates for the
// smaller observation count.
const TRACK2_MIN_OBS = 2
const TRACK2_MIN_SPAN_DAYS = 7
const TRACK2_MIN_CONFIDENCE = 0.8

// Cadence buckets — average interval between observations falls into one.
const CADENCE_BUCKETS: Array<{
  cadence: 'weekly' | 'biweekly' | 'monthly'
  minDays: number
  maxDays: number
  label: string
}> = [
  { cadence: 'weekly', minDays: 1, maxDays: 9, label: 'Appears weekly' },
  { cadence: 'biweekly', minDays: 10, maxDays: 20, label: 'Appears biweekly' },
  { cadence: 'monthly', minDays: 21, maxDays: 45, label: 'Appears monthly' },
]

// Periodic-business-process gate for Track 2. The detected pattern must
// have AT LEAST ONE underlying capture whose category or task text
// suggests a real recurring business process. Without this gate,
// "switched between Outlook and Chrome twice 7 days apart" would
// qualify as a Track 2 opportunity — which is meaningless noise.
const RECURRING_CATEGORIES = new Set([
  'Billing and Invoicing',
  'Payroll Processing',
  'Reporting and Documentation',
  'Authorization and Compliance',
])
const RECURRING_TASK_KEYWORDS = [
  'billing',
  'payroll',
  'invoice',
  'invoicing',
  'royalt', // royalty / royalties
  'compliance',
  'report',
  'reporting',
  'statement',
  'reconcile',
  'reconciliation',
  'audit',
  'month-end',
  'quarter-end',
  'year-end',
  'tax filing',
]

// Cross-employee boost: a pattern that N people perform is N× stronger
// signal than one person's habit. We bump confidence by 0.05 per
// additional employee, capped so cross-employee evidence can never
// single-handedly carry confidence past the threshold.
const CROSS_EMPLOYEE_BOOST_PER = 0.05
const CROSS_EMPLOYEE_BOOST_CAP = 0.15

// Assume well-tuned automations recover ~70% of the time spent on the task.
const SAVINGS_RATE = 0.7

// Keys we hash into the pattern signature.
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
  category: string | null
  task: string | null
}

type EmployeeRow = {
  id: string
  business_id: string
  role: string | null
  is_active: boolean
}

type DetectionTrack = 'high_frequency' | 'recurring'

type Observation = {
  capture_id: string
  captured_at: string
  confidence: number
  category: string | null
  task: string | null
}

type Bucket = {
  capabilityId: string
  keyParams: Record<string, string>
  observations: Observation[]
  fullParamsExample: Record<string, unknown>
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
  detection_track: DetectionTrack
  estimated_cadence: 'weekly' | 'biweekly' | 'monthly' | null
  cross_employee_count: number
  last_seen_at: string
}

// ----- Helpers -------------------------------------------------------------

function authorized(req: NextRequest): boolean {
  const cronHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && cronHeader === `Bearer ${cronSecret}`) return true
  if (process.env.VERCEL_ENV !== 'production') return true
  return false
}

function normalizeParams(params: Record<string, unknown> | undefined) {
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

/** Signature shared across employees — drops employee_id. Used for the
 *  cross-employee aggregation pass. */
function crossEmployeeKey(
  capabilityId: string,
  keyParams: Record<string, string>
): string {
  const sortedParams = Object.keys(keyParams)
    .sort()
    .map((k) => `${k}=${keyParams[k]}`)
    .join('|')
  return `${capabilityId}::${sortedParams}`
}

function describePattern(
  capabilityId: string,
  params: Record<string, string>,
  capabilitiesById: Record<string, Capability>,
  track: DetectionTrack
): { title: string; description: string } {
  const label = capabilitiesById[capabilityId]?.label ?? capabilityId
  const bits: string[] = []
  if (params.source) bits.push(`from ${params.source}`)
  if (params.destination) bits.push(`to ${params.destination}`)
  if (params.tool && !bits.length) bits.push(`in ${params.tool}`)
  if (params.target && !bits.length) bits.push(`on ${params.target}`)
  if (params.app && !bits.length) bits.push(`using ${params.app}`)
  const suffix = bits.length ? ' ' + bits.join(' ') : ''
  const description =
    track === 'recurring'
      ? `Recurring business process detected across multiple cycles in the last ${WINDOW_DAYS} days.`
      : `Repeated pattern detected in the last ${WINDOW_DAYS} days.`
  return { title: `${label}${suffix}`, description }
}

function automationClassFor(capability: Capability | undefined): 'A' | 'B' | 'C' {
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

// ----- Scoring -------------------------------------------------------------

/**
 * Track 1 scoring — frequency-weighted. Same formula as v1: log-damped
 * occurrence count + tag confidence average.
 */
function scoreTrack1(
  occurrenceCount: number,
  avgTagConfidence: number
): number {
  const freqScore = Math.log1p(occurrenceCount) / Math.log1p(50)
  const tagScore = Math.min(1, Math.max(0, avgTagConfidence / 100))
  const combined = freqScore * 0.6 + tagScore * 0.4
  return clamp01(combined)
}

/**
 * Track 2 scoring — tag-centric with a regularity boost. Low-frequency
 * patterns can't earn confidence through observation count, so we rely
 * on (a) the LLM's per-capture tag confidence and (b) how clean the
 * cadence is. A perfectly-spaced "monthly" pattern with high tag
 * confidence scores higher than a sporadic one.
 */
function scoreTrack2(
  avgTagConfidence: number,
  observations: Observation[]
): number {
  const tagScore = Math.min(1, Math.max(0, avgTagConfidence / 100))
  let regularityBoost = 0
  if (observations.length >= 3) {
    const sorted = [...observations]
      .map((o) => new Date(o.captured_at).getTime())
      .sort((a, b) => a - b)
    const intervals: number[] = []
    for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i - 1])
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
    if (mean > 0) {
      const variance =
        intervals.reduce((a, i) => a + Math.pow(i - mean, 2), 0) / intervals.length
      const cv = Math.sqrt(variance) / mean // coefficient of variation
      // Clean cadence (low CV) → up to +0.10. Random spacing → no boost.
      regularityBoost = Math.max(0, 0.1 * (1 - Math.min(1, cv)))
    }
  }
  return clamp01(tagScore + regularityBoost)
}

function clamp01(x: number): number {
  return Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000
}

// ----- Bucket evaluation ---------------------------------------------------

function spanDays(observations: Observation[]): number {
  if (observations.length < 2) return 0
  const times = observations.map((o) => new Date(o.captured_at).getTime())
  const min = Math.min(...times)
  const max = Math.max(...times)
  return (max - min) / (24 * 60 * 60 * 1000)
}

function avgTagConfidence(observations: Observation[]): number {
  if (observations.length === 0) return 0
  return (
    observations.reduce((s, o) => s + (o.confidence || 0), 0) / observations.length
  )
}

function bucketMatchesRecurringProcess(b: Bucket): boolean {
  for (const obs of b.observations) {
    if (obs.category && RECURRING_CATEGORIES.has(obs.category)) return true
    if (obs.task) {
      const lc = obs.task.toLowerCase()
      for (const kw of RECURRING_TASK_KEYWORDS) {
        if (lc.includes(kw)) return true
      }
    }
  }
  return false
}

function estimateCadence(
  observations: Observation[]
): { cadence: 'weekly' | 'biweekly' | 'monthly' | null; avgDays: number } {
  if (observations.length < 2) return { cadence: null, avgDays: 0 }
  const times = observations
    .map((o) => new Date(o.captured_at).getTime())
    .sort((a, b) => a - b)
  let total = 0
  for (let i = 1; i < times.length; i++) total += times[i] - times[i - 1]
  const avgMs = total / (times.length - 1)
  const avgDays = avgMs / (24 * 60 * 60 * 1000)
  for (const bucket of CADENCE_BUCKETS) {
    if (avgDays >= bucket.minDays && avgDays <= bucket.maxDays) {
      return { cadence: bucket.cadence, avgDays }
    }
  }
  return { cadence: null, avgDays }
}

type TrackResult = {
  track: DetectionTrack
  confidence: number
  cadence: 'weekly' | 'biweekly' | 'monthly' | null
  cadenceAvgDays: number
} | null

/**
 * Evaluate a bucket against both tracks. Prefer Track 1 when both apply
 * (higher-frequency signal is stronger). Returns null when nothing matches.
 */
function evaluateBucket(b: Bucket): TrackResult {
  const occ = b.observations.length
  const span = spanDays(b.observations)
  const avgConf = avgTagConfidence(b.observations)

  // Track 1 first.
  if (occ >= TRACK1_MIN_OBS && span >= TRACK1_MIN_SPAN_DAYS) {
    const conf = scoreTrack1(occ, avgConf)
    if (conf >= TRACK1_MIN_CONFIDENCE) {
      return { track: 'high_frequency', confidence: conf, cadence: null, cadenceAvgDays: 0 }
    }
  }

  // Track 2.
  if (occ >= TRACK2_MIN_OBS && span >= TRACK2_MIN_SPAN_DAYS) {
    if (!bucketMatchesRecurringProcess(b)) return null
    const conf = scoreTrack2(avgConf, b.observations)
    if (conf >= TRACK2_MIN_CONFIDENCE) {
      const { cadence, avgDays } = estimateCadence(b.observations)
      return { track: 'recurring', confidence: conf, cadence, cadenceAvgDays: avgDays }
    }
  }

  return null
}

// ----- Core detection ------------------------------------------------------

type IntegrationEventSummary = {
  tool_name: string
  event_count: number
  event_types: string[]
  last_event_at: string
}

async function loadEventsByTool(
  supabase: ReturnType<typeof serverSupabase>,
  businessId: string,
  windowStartIso: string
): Promise<Map<string, IntegrationEventSummary>> {
  const { data, error } = await supabase
    .from('integration_events')
    .select('tool_name, event_type, occurred_at')
    .eq('business_id', businessId)
    .gte('occurred_at', windowStartIso)
  if (error) {
    console.error('detect-opportunities: integration_events read failed', error)
    return new Map()
  }
  const byTool = new Map<string, IntegrationEventSummary>()
  for (const row of data ?? []) {
    const tool = (row.tool_name || '').toLowerCase()
    if (!tool) continue
    const existing = byTool.get(tool)
    if (existing) {
      existing.event_count += 1
      if (!existing.event_types.includes(row.event_type)) {
        existing.event_types.push(row.event_type)
      }
      if (row.occurred_at > existing.last_event_at) {
        existing.last_event_at = row.occurred_at
      }
    } else {
      byTool.set(tool, {
        tool_name: tool,
        event_count: 1,
        event_types: [row.event_type],
        last_event_at: row.occurred_at,
      })
    }
  }
  return byTool
}

async function detectForEmployee(
  supabase: ReturnType<typeof serverSupabase>,
  employee: EmployeeRow,
  windowStartIso: string,
  rateOverrides: Record<string, number>,
  eventsByTool: Map<string, IntegrationEventSummary>,
  capabilitiesById: Record<string, Capability>
): Promise<DetectedOpportunity[]> {
  const { data: captures, error } = await supabase
    .from('captures')
    .select('id, business_id, employee_id, captured_at, capabilities, category, task')
    .eq('employee_id', employee.id)
    .gte('captured_at', windowStartIso)
    .not('capabilities', 'is', null)

  if (error) throw new Error(`captures fetch failed: ${error.message}`)
  if (!captures || captures.length === 0) return []

  // Bucket per-observation rather than just counting — Track 2 needs
  // per-occurrence timestamps + categories.
  const buckets = new Map<string, Bucket>()
  for (const cap of captures as CaptureRow[]) {
    const tags = Array.isArray(cap.capabilities) ? cap.capabilities : []
    for (const tag of tags) {
      if (!tag || typeof tag.id !== 'string') continue
      const taxonomyEntry = capabilitiesById[tag.id]
      if (!taxonomyEntry?.automatable) continue

      const keyParams = normalizeParams(tag.params as Record<string, unknown>)
      const sig = `${tag.id}::${JSON.stringify(keyParams)}`

      const obs: Observation = {
        capture_id: cap.id,
        captured_at: cap.captured_at,
        confidence: tag.confidence ?? 0,
        category: cap.category ?? null,
        task: cap.task ?? null,
      }

      const existing = buckets.get(sig)
      if (existing) {
        existing.observations.push(obs)
      } else {
        buckets.set(sig, {
          capabilityId: tag.id,
          keyParams,
          observations: [obs],
          fullParamsExample: (tag.params as Record<string, unknown>) ?? {},
        })
      }
    }
  }

  const hourlyRate = resolveRate(employee.role, rateOverrides)
  const out: DetectedOpportunity[] = []

  for (const b of buckets.values()) {
    const evaluation = evaluateBucket(b)
    if (!evaluation) continue
    const taxonomyEntry = capabilitiesById[b.capabilityId]
    if (!taxonomyEntry) continue

    const occurrenceCount = b.observations.length
    const lastSeenAt = b.observations.reduce(
      (max, o) => (o.captured_at > max ? o.captured_at : max),
      b.observations[0].captured_at
    )

    // Observed time math is unchanged for Track 1; for Track 2 it's
    // intentionally not annualized from a 30-day window (a single
    // monthly task observed twice ≠ "happens 24× per year"). Instead
    // we trust the cadence estimate: cadence='monthly' → 12 occurrences/yr.
    let annualOccurrences: number
    if (evaluation.track === 'high_frequency') {
      // Frequency-based annualization (same as v1, but window-corrected).
      const observedWeeks = WINDOW_DAYS / 7
      annualOccurrences = (occurrenceCount / observedWeeks) * 52
    } else {
      // Cadence-based annualization.
      switch (evaluation.cadence) {
        case 'weekly':
          annualOccurrences = 52
          break
        case 'biweekly':
          annualOccurrences = 26
          break
        case 'monthly':
          annualOccurrences = 12
          break
        default:
          // Cadence didn't fit a bucket cleanly but still passed Track 2
          // (multi-month gaps). Conservative: assume quarterly.
          annualOccurrences = 4
      }
    }

    const minutesPerOccurrence = CAPTURE_INTERVAL_SECONDS / 60
    const observedMinutesInWindow = occurrenceCount * minutesPerOccurrence
    const annualMinutes = annualOccurrences * minutesPerOccurrence
    const annualHours = annualMinutes / 60
    const annualCost = Math.round(annualHours * hourlyRate)
    const annualSavings = Math.round(annualCost * SAVINGS_RATE)
    // estimated_weekly_minutes preserves the column's column meaning —
    // observed minutes per week of activity. For Track 2 we report the
    // annualized estimate divided by 52 so dashboards aren't confused
    // by a single-occurrence-shown-as-weekly figure.
    const estimatedWeeklyMinutes = Math.round(annualMinutes / 52)

    let confidence = evaluation.confidence

    // Integration-event boost: events corroborate the capture-based
    // inference. Cap so events alone can't push past the threshold.
    const toolsInPattern = Object.values(b.keyParams).filter(
      (v): v is string => typeof v === 'string' && v.length > 0
    )
    const matchedEvents: IntegrationEventSummary[] = []
    for (const t of toolsInPattern) {
      const ev = eventsByTool.get(t)
      if (ev) matchedEvents.push(ev)
    }
    let integrationEvidence: Record<string, unknown> | null = null
    if (matchedEvents.length > 0) {
      const totalEvents = matchedEvents.reduce((s, e) => s + e.event_count, 0)
      const eventBoost = Math.min(0.2, 0.05 * Math.log1p(totalEvents))
      confidence = clamp01(confidence + eventBoost)
      integrationEvidence = {
        verified_via_zapier: true,
        total_events: totalEvents,
        tools: matchedEvents.map((e) => ({
          tool: e.tool_name,
          event_count: e.event_count,
          event_types: e.event_types.slice(0, 5),
          last_event_at: e.last_event_at,
        })),
        boost: eventBoost,
      }
    }

    const { title, description } = describePattern(
      b.capabilityId,
      b.keyParams,
      capabilitiesById,
      evaluation.track
    )

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
        representative_capture_ids: b.observations.slice(0, 5).map((o) => o.capture_id),
        ...(evaluation.cadence
          ? {
              cadence: evaluation.cadence,
              cadence_avg_days: Math.round(evaluation.cadenceAvgDays * 10) / 10,
            }
          : {}),
        ...(integrationEvidence ? { integration_evidence: integrationEvidence } : {}),
      },
      occurrence_count: occurrenceCount,
      estimated_weekly_minutes: estimatedWeeklyMinutes,
      estimated_annual_cost: annualCost,
      estimated_annual_savings: annualSavings,
      confidence,
      automation_class: automationClassFor(taxonomyEntry),
      detection_track: evaluation.track,
      estimated_cadence: evaluation.cadence,
      cross_employee_count: 1, // updated in the cross-employee pass below
      last_seen_at: lastSeenAt,
    })
    void observedMinutesInWindow // retained for clarity / debugging
  }

  return out
}

/**
 * After per-employee detection, count distinct employees per
 * (capability_id, key_params) signature within each business. Patterns
 * that multiple people perform get a confidence boost and a higher
 * cross_employee_count for the dashboard's "Done by N people" chip.
 *
 * Mutates the input array in place.
 */
function applyCrossEmployeeWeighting(opps: DetectedOpportunity[]): void {
  // (business_id, capability+params) → set of employee_ids
  const employeesByKey = new Map<string, Set<string>>()
  for (const o of opps) {
    const ce = crossEmployeeKey(
      ((o.capability_pattern as { capability_id?: string }).capability_id) ?? '',
      ((o.capability_pattern as { key_params?: Record<string, string> }).key_params) ?? {}
    )
    const fullKey = `${o.business_id}::${ce}`
    if (!employeesByKey.has(fullKey)) employeesByKey.set(fullKey, new Set())
    employeesByKey.get(fullKey)!.add(o.employee_id)
  }

  for (const o of opps) {
    const ce = crossEmployeeKey(
      ((o.capability_pattern as { capability_id?: string }).capability_id) ?? '',
      ((o.capability_pattern as { key_params?: Record<string, string> }).key_params) ?? {}
    )
    const fullKey = `${o.business_id}::${ce}`
    const count = employeesByKey.get(fullKey)?.size ?? 1
    o.cross_employee_count = count
    if (count > 1) {
      // Cap the boost so cross-employee evidence corroborates but
      // doesn't single-handedly carry a weak per-employee signal.
      const boost = Math.min(
        CROSS_EMPLOYEE_BOOST_CAP,
        CROSS_EMPLOYEE_BOOST_PER * (count - 1)
      )
      o.confidence = clamp01(o.confidence + boost)
    }
  }
}

async function upsertOpportunities(
  supabase: ReturnType<typeof serverSupabase>,
  opps: DetectedOpportunity[]
): Promise<number> {
  if (opps.length === 0) return 0
  const { error } = await supabase.from('opportunities').upsert(opps, {
    onConflict: 'business_id,employee_id,pattern_signature',
    ignoreDuplicates: false,
  })
  if (error) throw new Error(`opportunities upsert failed: ${error.message}`)
  return opps.length
}

/**
 * Rescore pass: delete any existing opportunity row that no longer
 * qualifies under the current rules. Preserves status on rows that
 * survive (we don't touch them — UPSERT during the regular detection
 * run will refresh their metadata).
 *
 * Strategy: collect the set of pattern_signatures that the current
 * detection run produced (i.e., qualifying patterns). Then DELETE
 * opportunities in scope whose signature isn't in that set AND that
 * are older than the detection window (so we don't accidentally delete
 * rows that simply haven't been observed yet in the window).
 *
 * Returns the count of rows deleted.
 */
async function rescoreCleanup(
  supabase: ReturnType<typeof serverSupabase>,
  scope: { businessIds: string[]; employeeIds?: string[] },
  freshSignatures: Set<string>
): Promise<number> {
  if (scope.businessIds.length === 0) return 0
  let query = supabase
    .from('opportunities')
    .select('id, pattern_signature, business_id, employee_id')
    .in('business_id', scope.businessIds)
  if (scope.employeeIds && scope.employeeIds.length > 0) {
    query = query.in('employee_id', scope.employeeIds)
  }
  const { data: existing, error } = await query
  if (error) {
    console.error('rescore cleanup: read failed', error)
    return 0
  }
  const toDelete = (existing ?? [])
    .filter((row) => !freshSignatures.has(row.pattern_signature))
    .map((row) => row.id)
  if (toDelete.length === 0) return 0
  const { error: delErr } = await supabase
    .from('opportunities')
    .delete()
    .in('id', toDelete)
  if (delErr) {
    console.error('rescore cleanup: delete failed', delErr)
    return 0
  }
  return toDelete.length
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
    const isRescore =
      url.searchParams.get('rescore') === 'true' ||
      url.searchParams.get('cleanup') === 'true'

    const capabilitiesById = await getCapabilitiesById()
    const windowStart = new Date(
      Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()

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

    const ratesByBusiness = new Map<string, Record<string, number>>()
    const eventsByBusiness = new Map<string, Map<string, IntegrationEventSummary>>()
    async function getOverrides(bizId: string) {
      const cached = ratesByBusiness.get(bizId)
      if (cached) return cached
      const fetched = await loadRateOverrides(supabase, bizId).catch(() => ({}))
      ratesByBusiness.set(bizId, fetched)
      return fetched
    }
    async function getEvents(bizId: string) {
      const cached = eventsByBusiness.get(bizId)
      if (cached) return cached
      const fetched = await loadEventsByTool(supabase, bizId, windowStart)
      eventsByBusiness.set(bizId, fetched)
      return fetched
    }

    // ----- Per-employee detection -----
    const allDetected: DetectedOpportunity[] = []
    const errors: string[] = []
    for (const emp of employees as EmployeeRow[]) {
      try {
        const overrides = await getOverrides(emp.business_id)
        const events = await getEvents(emp.business_id)
        const detected = await detectForEmployee(
          supabase,
          emp,
          windowStart,
          overrides,
          events,
          capabilitiesById
        )
        allDetected.push(...detected)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error'
        errors.push(`employee=${emp.id}: ${message}`)
      }
    }

    // ----- Cross-employee weighting -----
    applyCrossEmployeeWeighting(allDetected)

    // ----- Persist -----
    const upserted = await upsertOpportunities(supabase, allDetected)

    // ----- Rescore cleanup (when requested) -----
    let deleted = 0
    if (isRescore) {
      const businessIds = Array.from(
        new Set((employees as EmployeeRow[]).map((e) => e.business_id))
      )
      const employeeIds = scopedEmployeeId ? [scopedEmployeeId] : undefined
      const freshSignatures = new Set(allDetected.map((o) => o.pattern_signature))
      deleted = await rescoreCleanup(
        supabase,
        { businessIds, employeeIds },
        freshSignatures
      )
    }

    // ----- Workflow sequence detection -----
    // Run after opportunity scoring completes per spec. Pulls the same
    // capture set we already have access to, but with a wider lens —
    // sequences group captures into multi-step chains rather than
    // counting capability tags.
    const sequenceResult = await runSequenceDetection(
      supabase,
      employees as EmployeeRow[]
    )

    // ----- Cross-employee handoff detection -----
    // Runs after sequences so it can resolve from_sequence_id /
    // to_sequence_id by looking up which sequence each side's
    // session-end / session-start capture belongs to. Detects
    // directional flows where A's last session-capture transitions to
    // B's first session-capture within the affinity window.
    const handoffResult = await runHandoffDetection(
      supabase,
      employees as EmployeeRow[]
    )

    return NextResponse.json({
      processed_employees: employees.length,
      detected: upserted,
      deleted_by_rescore: isRescore ? deleted : undefined,
      window_days: WINDOW_DAYS,
      tracks: {
        high_frequency: allDetected.filter((o) => o.detection_track === 'high_frequency').length,
        recurring: allDetected.filter((o) => o.detection_track === 'recurring').length,
      },
      multi_employee_patterns: allDetected.filter((o) => o.cross_employee_count > 1).length,
      sequences: sequenceResult,
      handoffs: handoffResult,
      errors: errors.length ? errors : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('detect-opportunities: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ===========================================================================
// Workflow sequence detection
// ===========================================================================

const SEQUENCE_WINDOW_DAYS = 30

type SequenceDetectionResult = {
  detected_occurrences: number
  unique_sequences: number
  upserted: number
  errors?: string[]
}

/**
 * Per-employee sequence detection, then cross-employee aggregation. For
 * each business in scope:
 *   1. Pull captures (tool/category/task) for the SEQUENCE_WINDOW_DAYS.
 *   2. Run detectSequencesForEmployee() per employee.
 *   3. Group all occurrences by sequence_hash within the business.
 *   4. For each unique sequence_hash, upsert workflow_sequences and
 *      insert workflow_sequence_steps rows for each occurrence. The
 *      (sequence_id, capture_id) unique constraint dedupes re-detection.
 *   5. Recompute confidence_score from cross-employee stats and the
 *      latest occurrence set.
 *
 * Returns aggregate counts. Errors are collected and reported but never
 * thrown — the opportunity detection result above is the primary
 * cron output and shouldn't be hidden by a sequence-pass failure.
 */
async function runSequenceDetection(
  supabase: ReturnType<typeof serverSupabase>,
  employees: EmployeeRow[]
): Promise<SequenceDetectionResult> {
  const result: SequenceDetectionResult = {
    detected_occurrences: 0,
    unique_sequences: 0,
    upserted: 0,
    errors: [],
  }
  if (employees.length === 0) return result

  const windowStart = new Date(
    Date.now() - SEQUENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  // Group employees by business so we run the cross-employee aggregation
  // pass within each tenant.
  const byBusiness = new Map<string, EmployeeRow[]>()
  for (const emp of employees) {
    const list = byBusiness.get(emp.business_id) ?? []
    list.push(emp)
    byBusiness.set(emp.business_id, list)
  }

  for (const [businessId, emps] of byBusiness) {
    try {
      // Pull captures for ALL employees in this business in one go.
      // Smaller column projection (no capabilities jsonb) keeps payload
      // light even over 30 days.
      const empIds = emps.map((e) => e.id)
      const { data: rawCaptures, error: capErr } = await supabase
        .from('captures')
        .select('id, business_id, employee_id, captured_at, task, category, software, confidence')
        .in('employee_id', empIds)
        .gte('captured_at', windowStart)
        .order('captured_at', { ascending: true })

      if (capErr) {
        result.errors!.push(`business=${businessId}: captures fetch failed: ${capErr.message}`)
        continue
      }
      const captures = (rawCaptures ?? []) as CaptureRowForDetection[]
      if (captures.length === 0) continue

      // Partition by employee for per-employee session-grouping.
      const byEmployee = new Map<string, CaptureRowForDetection[]>()
      for (const c of captures) {
        const arr = byEmployee.get(c.employee_id) ?? []
        arr.push(c)
        byEmployee.set(c.employee_id, arr)
      }

      // Detect occurrences per employee.
      const occurrencesByHash = new Map<string, DetectedSequenceOccurrence[]>()
      const employeesByHash = new Map<string, Set<string>>()
      for (const [employeeId, caps] of byEmployee) {
        const occurrences = detectSequencesForEmployee(caps)
        for (const occ of occurrences) {
          const arr = occurrencesByHash.get(occ.sequenceHash) ?? []
          arr.push(occ)
          occurrencesByHash.set(occ.sequenceHash, arr)

          const empSet = employeesByHash.get(occ.sequenceHash) ?? new Set<string>()
          empSet.add(employeeId)
          employeesByHash.set(occ.sequenceHash, empSet)
        }
      }
      result.detected_occurrences += [...occurrencesByHash.values()].reduce(
        (s, arr) => s + arr.length,
        0
      )
      result.unique_sequences += occurrencesByHash.size

      // Upsert each unique sequence + insert its step rows.
      for (const [sequenceHash, occurrences] of occurrencesByHash) {
        const upsertOk = await upsertSequence(
          supabase,
          businessId,
          sequenceHash,
          occurrences,
          employeesByHash.get(sequenceHash) ?? new Set()
        )
        if (upsertOk) result.upserted += 1
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      result.errors!.push(`business=${businessId}: ${message}`)
    }
  }

  if (result.errors && result.errors.length === 0) delete result.errors
  return result
}

/**
 * Upsert workflow_sequences for one (business, sequence_hash), then
 * append step rows for each occurrence. Returns true on success.
 */
async function upsertSequence(
  supabase: ReturnType<typeof serverSupabase>,
  businessId: string,
  sequenceHash: string,
  occurrences: DetectedSequenceOccurrence[],
  employeeSet: Set<string>
): Promise<boolean> {
  if (occurrences.length === 0) return false

  // All occurrences share the same chain shape (same hash), so the
  // first one is representative for tools/categories/step_count.
  const first = occurrences[0]
  const stepCount = first.steps.length
  const tools = first.tools
  const categories = first.categories

  // Find an existing row to merge with — gives us accumulated
  // occurrence_count from prior runs.
  const { data: existing, error: existingErr } = await supabase
    .from('workflow_sequences')
    .select('id, occurrence_count, started_at, employee_id')
    .eq('business_id', businessId)
    .eq('sequence_hash', sequenceHash)
    .maybeSingle()
  if (existingErr) {
    console.error('upsertSequence: existing read failed', existingErr)
    return false
  }

  // Aggregate stats across the NEW occurrences this run.
  const occurrenceStartTimes = occurrences.map((o) => o.steps[0].captured_at)
  const allStepConfidences = occurrences.flatMap((o) =>
    o.steps.map((s) => s.confidence ?? 0)
  )
  const avgStepConfidence =
    allStepConfidences.length > 0
      ? allStepConfidences.reduce((a, b) => a + b, 0) / allStepConfidences.length
      : 0
  const durations = occurrences.map((o) => o.durationSeconds)
  const avgDuration =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0

  const newOccurrenceCount =
    (existing?.occurrence_count ?? 0) + occurrences.length
  const earliestStart = occurrenceStartTimes.reduce(
    (a, b) => (a < b ? a : b),
    occurrenceStartTimes[0]
  )
  const latestEnd = occurrences
    .map((o) => o.steps[o.steps.length - 1].captured_at)
    .reduce((a, b) => (a > b ? a : b))
  const startedAt = existing?.started_at
    ? existing.started_at < earliestStart
      ? existing.started_at
      : earliestStart
    : earliestStart

  const confidence = scoreSequenceConfidence({
    occurrenceCount: newOccurrenceCount,
    employeeCount: employeeSet.size,
    avgStepConfidence,
    occurrenceStartTimes,
  })

  // Upsert the row. employee_id stays as the FIRST observer for
  // existing rows; for new rows we use the first occurrence's employee.
  const employeeIdForRow =
    existing?.employee_id ?? occurrences[0].steps[0].employee_id

  let sequenceId = existing?.id
  if (existing) {
    const { error: updErr } = await supabase
      .from('workflow_sequences')
      .update({
        occurrence_count: newOccurrenceCount,
        last_seen_at: latestEnd,
        ended_at: latestEnd,
        started_at: startedAt,
        confidence_score: confidence,
        avg_duration_seconds: avgDuration,
        // Tools/categories should be stable for a given hash, but we
        // overwrite from the latest occurrence in case someone updated
        // the normalization rules and the row's cached arrays are now
        // stale. The hash itself is what disambiguates patterns.
        tools,
        task_categories: categories,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (updErr) {
      console.error('upsertSequence: update failed', updErr)
      return false
    }
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('workflow_sequences')
      .insert({
        business_id: businessId,
        employee_id: employeeIdForRow,
        sequence_hash: sequenceHash,
        started_at: startedAt,
        ended_at: latestEnd,
        last_seen_at: latestEnd,
        step_count: stepCount,
        tools,
        task_categories: categories,
        occurrence_count: occurrences.length,
        confidence_score: confidence,
        avg_duration_seconds: avgDuration,
      })
      .select('id')
      .single()
    if (insErr || !inserted) {
      console.error('upsertSequence: insert failed', insErr)
      return false
    }
    sequenceId = inserted.id
  }

  // Append step rows for each occurrence. The (sequence_id, capture_id)
  // unique constraint dedupes any captures that were already recorded
  // as steps of this sequence on a prior run.
  const stepRows: Array<Record<string, unknown>> = []
  for (const occ of occurrences) {
    occ.steps.forEach((step, idx) => {
      stepRows.push({
        sequence_id: sequenceId,
        capture_id: step.id,
        step_index: idx,
        tool: step.software,
        category: step.category,
        task: step.task,
        captured_at: step.captured_at,
      })
    })
  }
  if (stepRows.length > 0) {
    // upsert with onConflict=ignore so repeat detections of the same
    // (sequence, capture) silently skip rather than error.
    const { error: stepErr } = await supabase
      .from('workflow_sequence_steps')
      .upsert(stepRows, {
        onConflict: 'sequence_id,capture_id',
        ignoreDuplicates: true,
      })
    if (stepErr) {
      console.error('upsertSequence: steps insert failed', stepErr)
      // Non-fatal — the parent row is still useful.
    }
  }

  return true
}

// ===========================================================================
// Cross-employee handoff detection (migration 0025)
// ===========================================================================

const HANDOFF_WINDOW_DAYS = 30
/** Sentinel for tool/category when the source row had a null value. We
 *  need a non-null string for the unique constraint key to compare two
 *  rows as equal. The dashboard renders these as "Unknown". */
const HANDOFF_NULL_SENTINEL = ''

type SessionEdge = {
  /** First or last capture of a session — depending on which list this is in. */
  capture_id: string
  employee_id: string
  captured_at: string
  tool: string | null
  category: string | null
}

type HandoffDetectionResult = {
  candidates_evaluated: number
  candidates_matched: number
  rows_written: number
  bottlenecks_total: number
  bottlenecks_critical: number
  errors?: string[]
}

/**
 * Per-business handoff detection. For each employee in the business:
 *   1. Build their per-session ends and per-session starts.
 *   2. For each session-end of A, find session-starts of B (B ≠ A)
 *      that fall in (end + HANDOFF_MIN_GAP_MS, end + HANDOFF_WINDOW_MS].
 *   3. Test the (from_tool, from_category) → (to_tool, to_category)
 *      pair against the affinity map. First-match wins.
 *   4. Group candidates by (from_employee, to_employee, from_tool, to_tool)
 *      and upsert one row per group — rolling avg_gap_minutes, bumped
 *      occurrence_count, recomputed confidence + bottleneck flag.
 *
 * Sequence linking: when sequence detection ran ahead of us, we have
 * workflow_sequence_steps rows referencing capture_id. We look up the
 * sequence id for each side's session-edge capture and populate
 * from_sequence_id / to_sequence_id when available.
 */
async function runHandoffDetection(
  supabase: ReturnType<typeof serverSupabase>,
  employees: EmployeeRow[]
): Promise<HandoffDetectionResult> {
  const result: HandoffDetectionResult = {
    candidates_evaluated: 0,
    candidates_matched: 0,
    rows_written: 0,
    bottlenecks_total: 0,
    bottlenecks_critical: 0,
    errors: [],
  }
  if (employees.length === 0) return result

  const windowStart = new Date(
    Date.now() - HANDOFF_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  // Group employees by business.
  const byBusiness = new Map<string, EmployeeRow[]>()
  for (const emp of employees) {
    const list = byBusiness.get(emp.business_id) ?? []
    list.push(emp)
    byBusiness.set(emp.business_id, list)
  }

  for (const [businessId, emps] of byBusiness) {
    if (emps.length < 2) continue // need at least two people for a handoff
    try {
      const written = await detectHandoffsForBusiness(
        supabase,
        businessId,
        emps,
        windowStart,
        result
      )
      result.rows_written += written
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      result.errors!.push(`business=${businessId}: ${message}`)
    }
  }

  if (result.errors && result.errors.length === 0) delete result.errors
  return result
}

async function detectHandoffsForBusiness(
  supabase: ReturnType<typeof serverSupabase>,
  businessId: string,
  emps: EmployeeRow[],
  windowStartIso: string,
  result: HandoffDetectionResult
): Promise<number> {
  const empIds = emps.map((e) => e.id)
  const { data: rawCaptures, error } = await supabase
    .from('captures')
    .select('id, employee_id, captured_at, software, category')
    .in('employee_id', empIds)
    .gte('captured_at', windowStartIso)
    .order('captured_at', { ascending: true })
  if (error) throw new Error(`captures fetch failed: ${error.message}`)
  const captures = (rawCaptures ?? []) as Array<{
    id: string
    employee_id: string
    captured_at: string
    software: string | null
    category: string | null
  }>
  if (captures.length === 0) return 0

  // Build session-edges per employee: for each employee's chronologically-
  // sorted captures, mark a capture as a session END if the next capture
  // from the same employee is > SESSION_GAP_MS away (or it's the last
  // capture), and a session START if the previous one is similarly far
  // away (or it's the first capture).
  const ends: SessionEdge[] = []
  const starts: SessionEdge[] = []
  const byEmployee = new Map<string, typeof captures>()
  for (const c of captures) {
    const list = byEmployee.get(c.employee_id) ?? []
    list.push(c)
    byEmployee.set(c.employee_id, list)
  }
  for (const [employeeId, caps] of byEmployee) {
    for (let i = 0; i < caps.length; i++) {
      const cur = caps[i]
      const prev = i > 0 ? caps[i - 1] : null
      const next = i < caps.length - 1 ? caps[i + 1] : null
      const prevGap = prev
        ? new Date(cur.captured_at).getTime() - new Date(prev.captured_at).getTime()
        : Number.POSITIVE_INFINITY
      const nextGap = next
        ? new Date(next.captured_at).getTime() - new Date(cur.captured_at).getTime()
        : Number.POSITIVE_INFINITY
      const isStart = prevGap > SESSION_GAP_MS
      const isEnd = nextGap > SESSION_GAP_MS
      if (isStart) {
        starts.push({
          capture_id: cur.id,
          employee_id: employeeId,
          captured_at: cur.captured_at,
          tool: cur.software,
          category: cur.category,
        })
      }
      if (isEnd) {
        ends.push({
          capture_id: cur.id,
          employee_id: employeeId,
          captured_at: cur.captured_at,
          tool: cur.software,
          category: cur.category,
        })
      }
    }
  }
  // Sort starts by time so we can binary-search the window.
  starts.sort((a, b) =>
    a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : 0
  )
  ends.sort((a, b) =>
    a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : 0
  )

  // For each session END of employee A, find session STARTs of any
  // B ≠ A within the affinity window. Linear scan with a sliding-
  // window pointer is fine — both arrays are sorted by time.
  type Candidate = {
    fromEmployee: string
    toEmployee: string
    fromTool: string
    toTool: string
    fromCategory: string
    toCategory: string
    fromCaptureId: string
    toCaptureId: string
    handoffAt: string
    gapMs: number
    rule: ReturnType<typeof matchAffinity>
  }
  const candidates: Candidate[] = []
  let startIdx = 0 // pointer into starts for the lower bound
  for (const end of ends) {
    const endMs = new Date(end.captured_at).getTime()
    const windowLo = endMs + HANDOFF_MIN_GAP_MS
    const windowHi = endMs + HANDOFF_WINDOW_MS
    // Advance startIdx past anything before windowLo.
    while (
      startIdx < starts.length &&
      new Date(starts[startIdx].captured_at).getTime() < windowLo
    ) {
      startIdx++
    }
    for (let j = startIdx; j < starts.length; j++) {
      const s = starts[j]
      const sMs = new Date(s.captured_at).getTime()
      if (sMs > windowHi) break // beyond window — no later start qualifies either
      if (s.employee_id === end.employee_id) continue // same person, not a handoff
      result.candidates_evaluated += 1
      const match = matchAffinity(end.tool, end.category, s.tool, s.category)
      if (!match) continue
      result.candidates_matched += 1
      candidates.push({
        fromEmployee: end.employee_id,
        toEmployee: s.employee_id,
        fromTool: end.tool ?? HANDOFF_NULL_SENTINEL,
        toTool: s.tool ?? HANDOFF_NULL_SENTINEL,
        fromCategory: end.category ?? HANDOFF_NULL_SENTINEL,
        toCategory: s.category ?? HANDOFF_NULL_SENTINEL,
        fromCaptureId: end.capture_id,
        toCaptureId: s.capture_id,
        handoffAt: s.captured_at,
        gapMs: sMs - endMs,
        rule: match,
      })
    }
  }

  if (candidates.length === 0) return 0

  // Resolve sequence ids for the participating captures so we can
  // populate from_sequence_id / to_sequence_id when those captures
  // belong to detected sequences.
  const allCaptureIds = Array.from(
    new Set(candidates.flatMap((c) => [c.fromCaptureId, c.toCaptureId]))
  )
  const sequenceIdByCapture = new Map<string, string>()
  if (allCaptureIds.length > 0) {
    const { data: stepRows } = await supabase
      .from('workflow_sequence_steps')
      .select('capture_id, sequence_id')
      .in('capture_id', allCaptureIds)
    for (const r of stepRows ?? []) {
      // A capture can be a step in only one sequence at a time, but the
      // join could theoretically return multiple rows over time — first
      // hit wins, the rest are dups.
      if (!sequenceIdByCapture.has(r.capture_id)) {
        sequenceIdByCapture.set(r.capture_id, r.sequence_id)
      }
    }
  }

  // Group candidates by the unique key, then upsert per group.
  type GroupKey = string
  const groups = new Map<GroupKey, Candidate[]>()
  for (const c of candidates) {
    const key = `${c.fromEmployee}::${c.toEmployee}::${c.fromTool}::${c.toTool}`
    const list = groups.get(key) ?? []
    list.push(c)
    groups.set(key, list)
  }

  let written = 0
  for (const [, list] of groups) {
    // Per-row aggregates for THIS run.
    const newOccurrences = list.length
    const gapsMs = list.map((c) => c.gapMs)
    const latest = list.reduce((acc, c) =>
      c.handoffAt > acc.handoffAt ? c : acc
    )

    const sample = list[0]
    const rule = sample.rule!.rule

    // Find any existing row to merge with.
    const fromTool = sample.fromTool
    const toTool = sample.toTool
    const { data: existing, error: lookupErr } = await supabase
      .from('workflow_handoffs')
      .select('id, occurrence_count, avg_gap_minutes')
      .eq('business_id', businessId)
      .eq('from_employee_id', sample.fromEmployee)
      .eq('to_employee_id', sample.toEmployee)
      .eq('from_tool', fromTool)
      .eq('to_tool', toTool)
      .maybeSingle()
    if (lookupErr) {
      console.error('handoff: existing lookup failed', lookupErr)
      continue
    }

    // Rolling average: existing.avg_gap × existing.count + sum(new gaps)
    // all divided by total observations. The gaps are minutes; convert
    // from ms.
    const newGapsMin = gapsMs.map((g) => g / 60000)
    const totalCount = (existing?.occurrence_count ?? 0) + newOccurrences
    const existingWeight =
      (existing?.avg_gap_minutes ?? 0) * (existing?.occurrence_count ?? 0)
    const newSum = newGapsMin.reduce((a, b) => a + b, 0)
    const avgGapMinutes = totalCount > 0 ? (existingWeight + newSum) / totalCount : 0

    // Coefficient of variation across NEW observations only — we don't
    // persist per-gap history. Good enough for the regularity heuristic.
    let gapCv: number | null = null
    if (newGapsMin.length >= 2) {
      const mean = newGapsMin.reduce((a, b) => a + b, 0) / newGapsMin.length
      if (mean > 0) {
        const variance =
          newGapsMin.reduce((a, g) => a + Math.pow(g - mean, 2), 0) /
          newGapsMin.length
        gapCv = Math.sqrt(variance) / mean
      }
    }

    const confidence = scoreHandoffConfidence({
      occurrenceCount: totalCount,
      strength: rule.strength,
      gapCv,
    })

    const { isBottleneck, isCritical } = classifyBottleneck({
      avgGapMinutes,
      occurrenceCount: totalCount,
    })
    if (isBottleneck) result.bottlenecks_total += 1
    if (isCritical) result.bottlenecks_critical += 1

    const fromSequenceId =
      sequenceIdByCapture.get(latest.fromCaptureId) ?? null
    const toSequenceId =
      sequenceIdByCapture.get(latest.toCaptureId) ?? null

    if (existing) {
      const { error: updErr } = await supabase
        .from('workflow_handoffs')
        .update({
          occurrence_count: totalCount,
          avg_gap_minutes: avgGapMinutes,
          gap_minutes: Math.round(latest.gapMs / 60000),
          handoff_at: latest.handoffAt,
          last_seen_at: latest.handoffAt,
          confidence_score: confidence,
          is_bottleneck: isBottleneck,
          from_sequence_id: fromSequenceId,
          to_sequence_id: toSequenceId,
          from_category: sample.fromCategory || null,
          to_category: sample.toCategory || null,
          task_context: rule.contextLabel,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      if (updErr) {
        console.error('handoff: update failed', updErr)
        continue
      }
    } else {
      const { error: insErr } = await supabase
        .from('workflow_handoffs')
        .insert({
          business_id: businessId,
          from_employee_id: sample.fromEmployee,
          to_employee_id: sample.toEmployee,
          from_tool: fromTool,
          to_tool: toTool,
          from_category: sample.fromCategory || null,
          to_category: sample.toCategory || null,
          handoff_at: latest.handoffAt,
          last_seen_at: latest.handoffAt,
          gap_minutes: Math.round(latest.gapMs / 60000),
          avg_gap_minutes: avgGapMinutes,
          occurrence_count: totalCount,
          confidence_score: confidence,
          is_bottleneck: isBottleneck,
          task_context: rule.contextLabel,
          from_sequence_id: fromSequenceId,
          to_sequence_id: toSequenceId,
        })
      if (insErr) {
        console.error('handoff: insert failed', insErr)
        continue
      }
    }
    written += 1
  }
  return written
}

export const GET = handle
export const POST = handle
