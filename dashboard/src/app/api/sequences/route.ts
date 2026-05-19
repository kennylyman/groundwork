/**
 * GET /api/sequences
 *
 * Returns the workflow sequences for the authenticated owner's business,
 * with steps and per-employee enrichment joined. Only includes sequences
 * that meet the dashboard's display thresholds (confidence >= 0.65 and
 * occurrence_count >= 2) so the client doesn't have to filter again.
 *
 * Response shape:
 *   {
 *     sequences: Array<{
 *       id, started_at, ended_at, step_count, tools[], task_categories[],
 *       occurrence_count, last_seen_at, confidence_score,
 *       avg_duration_seconds,
 *       employees: Array<{ id, name, role }>,
 *       steps: Array<{
 *         step_index, tool, category, task, captured_at, employee_id
 *       }>
 *     }>
 *   }
 *
 * Auth: cookie session (owner). Service role isn't appropriate here —
 * sequences are owner-scoped via RLS, the route runs as the cookie user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { serverSupabase } from '@/lib/supabase'

const MIN_CONFIDENCE = 0.65
const MIN_OCCURRENCES = 2

export async function GET(request: NextRequest) {
  // 1. Resolve the owner's business via cookie auth. The session
  //    client uses the anon key + cookie chain — RLS filters reads
  //    to the owner's own sequences automatically, but we look up
  //    the business explicitly so the join queries below run on
  //    the service-role client (faster, fewer round-trips).
  const sessionClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll() {
          // No-op — route handlers can't write cookies in this path.
        },
      },
    }
  )
  const {
    data: { user },
  } = await sessionClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serverSupabase()
  const { data: biz } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle()
  if (!biz) {
    return NextResponse.json({ error: 'no business' }, { status: 404 })
  }

  // 2. Pull sequences above the dashboard's display thresholds.
  const { data: sequences, error: seqErr } = await supabase
    .from('workflow_sequences')
    .select(
      'id, started_at, ended_at, step_count, tools, task_categories, occurrence_count, last_seen_at, confidence_score, avg_duration_seconds, sequence_hash'
    )
    .eq('business_id', biz.id)
    .gte('confidence_score', MIN_CONFIDENCE)
    .gte('occurrence_count', MIN_OCCURRENCES)
    .order('confidence_score', { ascending: false })
    .limit(50)

  if (seqErr) {
    console.error('GET /api/sequences: read failed', seqErr)
    return NextResponse.json({ error: seqErr.message }, { status: 500 })
  }
  const seqList = sequences ?? []
  if (seqList.length === 0) {
    return NextResponse.json({ sequences: [] })
  }

  const sequenceIds = seqList.map((s) => s.id)

  // 3. Pull all steps for those sequences, plus the employee_id of the
  //    capture each step references (for the "Employees involved" chip).
  //    Two queries instead of a nested join because PostgREST nested
  //    joins return everything as embedded objects per row — fine for
  //    small sets but easier to map client-side as flat arrays.
  const [stepsRes, captureRes] = await Promise.all([
    supabase
      .from('workflow_sequence_steps')
      .select('id, sequence_id, capture_id, step_index, tool, category, task, captured_at')
      .in('sequence_id', sequenceIds)
      .order('sequence_id', { ascending: true })
      .order('captured_at', { ascending: true }),
    supabase
      .from('captures')
      .select('id, employee_id')
      .in('business_id', [biz.id])
      .order('captured_at', { ascending: false })
      .limit(5000), // bound — sequences over 5k unique step-captures is unlikely
  ])
  if (stepsRes.error) {
    console.error('GET /api/sequences: steps read failed', stepsRes.error)
    return NextResponse.json({ error: stepsRes.error.message }, { status: 500 })
  }
  const steps = stepsRes.data ?? []

  // Map capture_id → employee_id for quick join.
  const captureEmployee = new Map<string, string>()
  for (const c of captureRes.data ?? []) {
    captureEmployee.set(c.id, c.employee_id)
  }

  // 4. Pull employee names/roles for the union of employees touching
  //    these sequences.
  const employeeIdsInPlay = new Set<string>()
  for (const step of steps) {
    const empId = captureEmployee.get(step.capture_id)
    if (empId) employeeIdsInPlay.add(empId)
  }
  let employeesById: Record<string, { id: string; name: string; role: string | null }> = {}
  if (employeeIdsInPlay.size > 0) {
    const { data: empRows } = await supabase
      .from('employees')
      .select('id, name, role')
      .in('id', [...employeeIdsInPlay])
    for (const e of empRows ?? []) {
      employeesById[e.id] = e
    }
  }

  // 5. Group steps + employees per sequence.
  const stepsBySeq = new Map<string, typeof steps>()
  const employeesBySeq = new Map<string, Set<string>>()
  for (const step of steps) {
    const list = stepsBySeq.get(step.sequence_id) ?? []
    list.push(step)
    stepsBySeq.set(step.sequence_id, list)

    const empId = captureEmployee.get(step.capture_id)
    if (empId) {
      const set = employeesBySeq.get(step.sequence_id) ?? new Set<string>()
      set.add(empId)
      employeesBySeq.set(step.sequence_id, set)
    }
  }

  const enriched = seqList.map((seq) => ({
    ...seq,
    steps: (stepsBySeq.get(seq.id) ?? []).map((s) => ({
      step_index: s.step_index,
      tool: s.tool,
      category: s.category,
      task: s.task,
      captured_at: s.captured_at,
      employee_id: captureEmployee.get(s.capture_id) ?? null,
    })),
    employees: [...(employeesBySeq.get(seq.id) ?? [])]
      .map((id) => employeesById[id])
      .filter((e): e is { id: string; name: string; role: string | null } => !!e),
  }))

  return NextResponse.json({ sequences: enriched })
}
