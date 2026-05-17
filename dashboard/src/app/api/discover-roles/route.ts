/**
 * Role Discovery — runs the two-pass analysis per employee.
 *
 * Trigger paths:
 *   - Vercel cron (vercel.json schedule, daily). Requires CRON_SECRET.
 *   - Manual: GET/POST with ?employee_id= to scope to one person (open in
 *     non-prod for dev pokes).
 *
 * Per-employee gate: an employee needs a run if any of:
 *   - no profile yet AND capture_count >= 50
 *   - capture_count_since_last_run >= 200
 *   - last_run_at older than 30 days
 *
 * Algorithm (single Claude call does both passes):
 *   Pass 1: cluster the captures into 3-7 activity clusters
 *   Pass 2: synthesize an observed_role + primary_workflows from the clusters
 *
 * We deliberately don't overwrite employees.role. The discovered profile
 * lands in employee_role_profiles unacknowledged; the owner sees a diff on
 * the employee detail page and decides Accept / Dismiss.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { serverSupabase } from '@/lib/supabase'

export const maxDuration = 60

const MODEL = 'claude-sonnet-4-20250514'

// ----- Tunables ------------------------------------------------------------

const MIN_CAPTURES_FOR_FIRST_RUN = 50
const NEW_CAPTURES_FOR_RERUN = 200
const RERUN_AFTER_DAYS = 30
const ANALYSIS_WINDOW_DAYS = 30
const MAX_CAPTURES_TO_ANALYZE = 200

// ----- Types ---------------------------------------------------------------

type EmployeeRow = {
  id: string
  business_id: string
  name: string
  role: string | null
  is_active: boolean
}

type CaptureSummary = {
  task: string | null
  category: string | null
  software: string | null
  capabilities: { id: string }[] | null
  keystrokes: number | null
  idle_seconds: number | null
  captured_at: string
}

type ActivityCluster = {
  label: string
  pct_of_time: number // 0..1
  software: string[]
  typical_cadence: string
  capabilities_used: string[]
  representative_capture_indices: number[]
}

type LLMRolePayload = {
  observed_role: string
  observed_role_summary: string
  role_confidence: number // 0..1
  activity_clusters: ActivityCluster[]
  primary_workflows: string[]
  time_distribution: Record<string, number>
}

// ----- Helpers -------------------------------------------------------------

function authorized(req: NextRequest): boolean {
  const cronHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && cronHeader === `Bearer ${cronSecret}`) return true
  if (process.env.VERCEL_ENV !== 'production') return true
  return false
}

/**
 * Tolerant role comparison. We don't want trivial differences ("Office Mgr"
 * vs "Office Manager") to register as mismatch. Normalize aggressively.
 */
function rolesMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const na = norm(a)
  const nb = norm(b)
  if (na === nb) return true
  // Light substring tolerance — "Scheduler" matches "Senior Scheduler"
  if (na.length > 2 && nb.includes(na)) return true
  if (nb.length > 2 && na.includes(nb)) return true
  return false
}

const SYSTEM_PROMPT = `You are a process-analysis agent for Groundwork. You are given an employee's screen-capture stream from the last ${ANALYSIS_WINDOW_DAYS} days and must produce a structured role profile that reflects what they ACTUALLY do — not what their job title says.

You run two passes in a single response:

PASS 1 — CLUSTER: Identify 3-7 distinct activity clusters in the captures. A cluster is a kind of work that recurs — e.g. "building caregiver schedules in WellSky" or "responding to family inquiries by email." Aim for clusters that are mutually exclusive, collectively exhaustive across the captures, and labeled so a human can tell them apart at a glance.

PASS 2 — SYNTHESIZE: From the clusters, write the observed role profile:
- observed_role: a short title that best fits the dominant work, e.g. "Scheduler", "Office Manager", "Billing Coordinator". Use job-title vocabulary the business owner will recognize, not made-up phrases.
- observed_role_summary: one sentence describing what this employee actually does, based on the clusters.
- role_confidence: 0..1, how sure you are. High = clusters cleanly map to one role; low = work is scattered or data is sparse.
- primary_workflows: 3-5 named workflows (capability-rich processes), e.g. "Daily shift assignment", "Missed visit handling", "Weekly payroll prep".
- time_distribution: rough split across periods of day (mornings, afternoons, evenings), values sum to ~1.

For each cluster:
- label: short, human-readable
- pct_of_time: fraction of the supplied captures in this cluster (0..1)
- software: distinct apps used in this cluster
- typical_cadence: when this happens, e.g. "daily, mornings" or "ad hoc throughout the day" or "weekly, end of week"
- capabilities_used: which capability ids from the captures show up in this cluster
- representative_capture_indices: 1-5 indices (zero-based) into the supplied captures array that best exemplify this cluster

OUTPUT — valid JSON only, no preamble, no markdown fences:
{
  "observed_role": "string",
  "observed_role_summary": "string",
  "role_confidence": 0.0,
  "activity_clusters": [
    {
      "label": "string",
      "pct_of_time": 0.0,
      "software": ["string"],
      "typical_cadence": "string",
      "capabilities_used": ["string"],
      "representative_capture_indices": [0]
    }
  ],
  "primary_workflows": ["string"],
  "time_distribution": { "mornings": 0.0, "afternoons": 0.0, "evenings": 0.0 }
}

Rules:
- If the captures are sparse or scattered, lower role_confidence rather than refuse. Still produce a best-guess profile.
- Cluster pct_of_time values should sum to ~1.0 across all clusters.
- Do NOT include captures the employee was idle/on-break for in any cluster — those are non-work and don't define the role.
- The stated job title may be given in the user message. Use it as a hint, but you are NOT obligated to agree with it.`

function compactCapture(c: CaptureSummary) {
  const capIds = (c.capabilities || []).map((cap) => cap.id).filter(Boolean)
  return {
    t: c.captured_at,
    task: c.task,
    category: c.category,
    software: c.software,
    caps: capIds,
    kbd: c.keystrokes ?? 0,
    idle: c.idle_seconds ?? 0,
  }
}

// ----- Per-employee discovery ---------------------------------------------

async function shouldRunForEmployee(
  supabase: ReturnType<typeof serverSupabase>,
  employee: EmployeeRow,
  manualOverride: boolean
): Promise<{ should: boolean; captureCount: number; reason: string }> {
  // Count captures this employee has
  const { count: captureCount, error: countErr } = await supabase
    .from('captures')
    .select('*', { count: 'exact', head: true })
    .eq('employee_id', employee.id)
  if (countErr) throw new Error(`captures count: ${countErr.message}`)
  const captures = captureCount ?? 0

  if (manualOverride) return { should: true, captureCount: captures, reason: 'manual' }

  // Existing profile?
  const { data: profile } = await supabase
    .from('employee_role_profiles')
    .select('capture_count_at_run, last_run_at')
    .eq('employee_id', employee.id)
    .maybeSingle()

  if (!profile) {
    return {
      should: captures >= MIN_CAPTURES_FOR_FIRST_RUN,
      captureCount: captures,
      reason: captures >= MIN_CAPTURES_FOR_FIRST_RUN ? 'first-run' : 'too-few-captures',
    }
  }

  const newCaptures = captures - (profile.capture_count_at_run ?? 0)
  const lastRunAgeMs = Date.now() - new Date(profile.last_run_at).getTime()
  const lastRunAgeDays = lastRunAgeMs / (1000 * 60 * 60 * 24)

  if (newCaptures >= NEW_CAPTURES_FOR_RERUN) {
    return { should: true, captureCount: captures, reason: 'enough-new-captures' }
  }
  if (lastRunAgeDays >= RERUN_AFTER_DAYS) {
    return { should: true, captureCount: captures, reason: 'cadence' }
  }
  return { should: false, captureCount: captures, reason: 'not-yet-due' }
}

async function discoverForEmployee(
  supabase: ReturnType<typeof serverSupabase>,
  client: Anthropic,
  employee: EmployeeRow
): Promise<{ wrote: boolean; reason?: string }> {
  const windowStart = new Date(
    Date.now() - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  const { data: captures, error: capturesErr } = await supabase
    .from('captures')
    .select(
      'task, category, software, capabilities, keystrokes, idle_seconds, captured_at'
    )
    .eq('employee_id', employee.id)
    .gte('captured_at', windowStart)
    .order('captured_at', { ascending: true })
    .limit(MAX_CAPTURES_TO_ANALYZE)

  if (capturesErr) throw new Error(`captures fetch: ${capturesErr.message}`)
  if (!captures || captures.length < MIN_CAPTURES_FOR_FIRST_RUN) {
    return { wrote: false, reason: 'too-few-captures-in-window' }
  }

  const compact = (captures as CaptureSummary[]).map(compactCapture)

  const userPrompt = `Employee: ${employee.name}
Stated role on file: ${employee.role ?? '(none)'}
Captures in last ${ANALYSIS_WINDOW_DAYS} days (chronological, ${compact.length} total):

${JSON.stringify(compact, null, 2)}

Produce the JSON profile now.`

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  })

  const textBlock = message.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text')
  }
  let raw = textBlock.text.trim()
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  let payload: LLMRolePayload
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new Error(`Bad JSON from model: ${raw.slice(0, 200)}`)
  }

  // Translate representative_capture_indices → real capture ids
  const clustersWithIds = (payload.activity_clusters || []).map((cluster) => {
    const captureIds = (cluster.representative_capture_indices || [])
      .map((i) => captures[i]?.captured_at) // we don't have id in the select — use timestamp as fallback
      .filter(Boolean) as string[]
    return {
      label: cluster.label,
      pct_of_time: cluster.pct_of_time,
      software: cluster.software ?? [],
      typical_cadence: cluster.typical_cadence,
      capabilities_used: cluster.capabilities_used ?? [],
      representative_capture_ids: captureIds, // timestamps for now; switch to ids if select gains them
    }
  })

  const mismatch = !rolesMatch(employee.role, payload.observed_role)

  const row = {
    business_id: employee.business_id,
    employee_id: employee.id,
    observed_role: payload.observed_role,
    observed_role_summary: payload.observed_role_summary,
    role_confidence: Math.min(1, Math.max(0, payload.role_confidence ?? 0)),
    stated_role: employee.role,
    stated_vs_observed_mismatch: mismatch,
    activity_clusters: clustersWithIds,
    primary_workflows: payload.primary_workflows ?? [],
    time_distribution: payload.time_distribution ?? {},
    capture_count_at_run: captures.length,
    last_run_at: new Date().toISOString(),
    // A fresh discovery always resets acknowledgment — even if the owner
    // previously dismissed a stale profile, a meaningful new one deserves
    // a fresh look.
    acknowledged_at: null,
    acknowledgment_action: null,
  }

  const { error: upsertErr } = await supabase
    .from('employee_role_profiles')
    .upsert(row, { onConflict: 'employee_id', ignoreDuplicates: false })

  if (upsertErr) throw new Error(`profile upsert: ${upsertErr.message}`)

  return { wrote: true }
}

// ----- HTTP handler --------------------------------------------------------

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })
    }

    const supabase = serverSupabase()
    const client = new Anthropic({ apiKey })
    const url = new URL(req.url)
    const scopedEmployeeId = url.searchParams.get('employee_id')
    const manualOverride = !!scopedEmployeeId // force-run when scoped

    let query = supabase
      .from('employees')
      .select('id, business_id, name, role, is_active')
      .eq('is_active', true)
    if (scopedEmployeeId) query = query.eq('id', scopedEmployeeId)

    const { data: employees, error: empErr } = await query
    if (empErr) throw new Error(`employees fetch: ${empErr.message}`)
    if (!employees || employees.length === 0) {
      return NextResponse.json({ processed: 0, skipped: 0, errors: [] })
    }

    let processed = 0
    let skipped = 0
    const errors: string[] = []
    const skippedReasons: Record<string, number> = {}

    for (const emp of employees as EmployeeRow[]) {
      try {
        const check = await shouldRunForEmployee(supabase, emp, manualOverride)
        if (!check.should) {
          skipped += 1
          skippedReasons[check.reason] = (skippedReasons[check.reason] || 0) + 1
          continue
        }
        const result = await discoverForEmployee(supabase, client, emp)
        if (result.wrote) processed += 1
        else {
          skipped += 1
          skippedReasons[result.reason || 'unknown'] =
            (skippedReasons[result.reason || 'unknown'] || 0) + 1
        }
      } catch (err) {
        const m = err instanceof Error ? err.message : 'unknown'
        errors.push(`${emp.id}: ${m}`)
      }
    }

    return NextResponse.json({
      processed,
      skipped,
      skipped_reasons: skippedReasons,
      errors: errors.length ? errors : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('discover-roles: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
