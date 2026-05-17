/**
 * GET /api/workflow-intelligence
 *
 * Returns the data the WorkflowIntelligenceMap component renders. Heavy
 * lift in three stages:
 *
 *   1. AGGREGATE the last 7 days of captures for every active employee
 *      in the caller's business. Group by task text per employee, sum
 *      frequencies, keep top tasks. Cap to ~50 nodes total (employees
 *      + tasks).
 *
 *   2. CLUSTER via a single Claude call. Sonnet looks at the per-employee
 *      task lists and returns clusters of semantically-equivalent
 *      automatable work shared across 2+ employees. The clustering
 *      prompt is in lib/workflow-intelligence-prompt.ts.
 *
 *   3. SCORE connections + ROI server-side from the cluster output:
 *        - connections[]: between every pair of employees who share at
 *          least one cluster, weighted by matching capture volume
 *        - cluster.weekly_minutes / annual_cost / annual_savings using
 *          the same heuristics as /api/detect-opportunities
 *
 * Cached in workflow_intelligence_cache (one row per business). TTL 1
 * hour — re-running Sonnet on every dashboard poll would cost real money
 * AND mostly return the same answer.
 *
 * Auth: owner-only via resolveOwner.
 * Rate limit: 10/min per business (shared bucket with other LLM routes).
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { resolveOwner } from '@/lib/auth'
import { serverSupabase } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { getCapabilities } from '@/lib/capabilities-server'
import { loadRateOverrides, resolveRate } from '@/lib/rates'
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseClusterResponse,
  type PromptEmployee,
  type PromptEmployeeTask,
} from '@/lib/workflow-intelligence-prompt'
import type {
  AutomationClass,
  AutomationPotential,
  Connection,
  EmployeeNode,
  TaskNode,
  WorkflowCluster,
  WorkflowIntelligencePayload,
} from '@/lib/workflow-intelligence-types'

export const maxDuration = 60

// ----- Tunables -----------------------------------------------------------

const WINDOW_DAYS = 7
const CACHE_TTL_SECONDS = 60 * 60 // 1 hour
const MAX_EMPLOYEE_NODES = 13
const MAX_TOTAL_NODES = 50
const MAX_TASKS_PER_EMPLOYEE_PROMPT = 8   // sent to Sonnet
const CAPTURE_INTERVAL_SECONDS = 30
const WORKING_DAYS_PER_YEAR = 250
const SAVINGS_RATE = 0.7
const MODEL = 'claude-sonnet-4-20250514'

// ----- Types --------------------------------------------------------------

type CaptureRow = {
  employee_id: string
  captured_at: string
  task: string | null
  category: string | null
  software: string | null
  automation_potential: string | null
  capabilities: Array<{ id: string }> | null
  capture_enrichments: Record<string, unknown> | null
}

type EmployeeRow = {
  id: string
  business_id: string
  name: string
  role: string | null
}

type EnrichmentSummary = {
  /** Compact one-line summary of the most recent enriched capture for
   *  this task. Fed into the Sonnet prompt so clusters can be informed
   *  by live tool context (Slack channel topic, calendar meeting,
   *  unread email subject), not just the screen-text task. */
  summary: string
  source_tool: string
}

type TaskAggregate = {
  task: string
  count: number
  category: string | null
  software: string | null
  automation_potential: AutomationPotential
  capability_ids: string[]
  /** Most recent enrichment seen for this task, if any. Drives the
   *  Sonnet prompt's per-task context line. */
  enrichment?: EnrichmentSummary
}

// ----- Helpers ------------------------------------------------------------

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function normalizePotential(v: string | null | undefined): AutomationPotential {
  const s = (v ?? '').toLowerCase()
  if (s === 'high' || s === 'medium' || s === 'low' || s === 'none') return s
  return 'none'
}

function normalizeAutomationClass(v: string | null | undefined): AutomationClass {
  const s = (v ?? '').toUpperCase()
  if (s === 'A' || s === 'B' || s === 'C') return s as AutomationClass
  return 'C'
}

/** Aggregate per-employee top tasks by text. */
/** Distill a capture's capture_enrichments jsonb into a one-line summary
 *  the Sonnet clustering prompt can consume. Returns null when there's
 *  nothing useful to say (adapter ran but found no events, or the row
 *  predates the enrichment feature). */
function summarizeEnrichment(
  enrich: Record<string, unknown> | null | undefined
): EnrichmentSummary | null {
  if (!enrich || typeof enrich !== 'object') return null
  for (const [tool, payload] of Object.entries(enrich)) {
    if (!payload || typeof payload !== 'object') continue
    const p = payload as Record<string, unknown>
    if (tool === 'slack') {
      const messages = Array.isArray(p.messages) ? p.messages : []
      if (messages.length === 0) continue
      const sample = messages.slice(0, 3).map((m) => {
        const mm = m as { text?: string }
        return (mm.text ?? '').slice(0, 80)
      }).join(' | ')
      return {
        source_tool: 'slack',
        summary: `Slack channel context: ${sample}`,
      }
    }
    if (tool === 'microsoft-365' || tool === 'google-workspace') {
      const events = Array.isArray(p.calendar_events) ? p.calendar_events : []
      const emails = Array.isArray(p.unread_emails) ? p.unread_emails : []
      if (events.length === 0 && emails.length === 0) continue
      const parts: string[] = []
      if (events.length > 0) {
        const first = events[0] as { subject?: string }
        parts.push(`meeting "${(first.subject ?? '').slice(0, 80)}"`)
      }
      if (emails.length > 0) {
        const first = emails[0] as { subject?: string; from?: string | null }
        parts.push(
          `unread "${(first.subject ?? '').slice(0, 60)}" from ${first.from ?? '?'}`
        )
      }
      const surface =
        typeof p.surface === 'string' ? p.surface : tool
      return {
        source_tool: tool,
        summary: `${surface}: ${parts.join('; ')}`,
      }
    }
  }
  return null
}

function aggregateTasks(captures: CaptureRow[]): Map<string, TaskAggregate[]> {
  const perEmployee = new Map<string, Map<string, TaskAggregate>>()
  // Track which task we've already attached an enrichment summary to —
  // we want the MOST RECENT enriched capture's summary per task. The
  // captures input isn't guaranteed to be sorted, so we look at every
  // row and keep the freshest one.
  const enrichmentSeenAt = new Map<string, string>() // "empId::task" -> captured_at
  for (const cap of captures) {
    if (!cap.employee_id || !cap.task) continue
    const taskText = cap.task.trim()
    if (!taskText) continue
    if (!perEmployee.has(cap.employee_id)) {
      perEmployee.set(cap.employee_id, new Map())
    }
    const bucket = perEmployee.get(cap.employee_id)!
    const existing = bucket.get(taskText)
    const capabilityIds = Array.isArray(cap.capabilities)
      ? cap.capabilities.map((c) => c?.id).filter((id): id is string => !!id)
      : []
    if (existing) {
      existing.count += 1
      for (const cid of capabilityIds) {
        if (!existing.capability_ids.includes(cid)) existing.capability_ids.push(cid)
      }
    } else {
      bucket.set(taskText, {
        task: taskText,
        count: 1,
        category: cap.category,
        software: cap.software,
        automation_potential: normalizePotential(cap.automation_potential),
        capability_ids: [...capabilityIds],
      })
    }

    // Try to attach an enrichment summary. Keep only the freshest one
    // per (employee, task) pair.
    const enrichSummary = summarizeEnrichment(cap.capture_enrichments)
    if (enrichSummary) {
      const key = `${cap.employee_id}::${taskText}`
      const prev = enrichmentSeenAt.get(key)
      if (!prev || cap.captured_at > prev) {
        const aggregate = bucket.get(taskText)
        if (aggregate) aggregate.enrichment = enrichSummary
        enrichmentSeenAt.set(key, cap.captured_at)
      }
    }
  }

  const out = new Map<string, TaskAggregate[]>()
  for (const [empId, bucket] of perEmployee) {
    const sorted = Array.from(bucket.values()).sort((a, b) => b.count - a.count)
    out.set(empId, sorted)
  }
  return out
}

function pickEmployeeNodes(
  employees: EmployeeRow[],
  perEmployeeTasks: Map<string, TaskAggregate[]>
): EmployeeRow[] {
  // Rank employees by total capture volume — most-active first. Cap to
  // MAX_EMPLOYEE_NODES so the graph stays readable on small teams + small
  // for large teams.
  const ranked = employees
    .map((e) => {
      const tasks = perEmployeeTasks.get(e.id) ?? []
      const total = tasks.reduce((s, t) => s + t.count, 0)
      return { emp: e, total }
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_EMPLOYEE_NODES)
    .map((x) => x.emp)
  return ranked
}

function buildEmployeeNodes(
  employees: EmployeeRow[],
  perEmployeeTasks: Map<string, TaskAggregate[]>
): EmployeeNode[] {
  return employees.map((e) => {
    const tasks = perEmployeeTasks.get(e.id) ?? []
    const total = tasks.reduce((s, t) => s + t.count, 0)
    const automatable = tasks
      .filter((t) => t.automation_potential !== 'none')
      .reduce((s, t) => s + t.count, 0)
    return {
      id: e.id,
      name: e.name,
      role: e.role,
      initials: initials(e.name),
      total_capture_count: total,
      automatable_capture_count: automatable,
      top_tasks: tasks.slice(0, 3).map((t) => ({
        task: t.task,
        count: t.count,
        automation_potential: t.automation_potential,
        category: t.category,
      })),
    }
  })
}

function buildTaskNodes(
  employees: EmployeeRow[],
  perEmployeeTasks: Map<string, TaskAggregate[]>,
  totalBudget: number
): TaskNode[] {
  // Distribute task slots across employees, prioritizing employees with
  // more total captures. Each employee gets at least 1 task node if they
  // have any.
  const remaining = Math.max(0, totalBudget - employees.length)
  // Naive round-robin: pick top task from each employee until budget
  // exhausted, then second, etc.
  const out: TaskNode[] = []
  let depth = 0
  while (out.length < totalBudget) {
    let added = 0
    for (const e of employees) {
      if (out.length >= totalBudget) break
      const tasks = perEmployeeTasks.get(e.id) ?? []
      if (depth >= tasks.length) continue
      const t = tasks[depth]
      out.push({
        id: `task:${e.id}:${depth}`,
        employee_id: e.id,
        label: t.task,
        frequency: t.count,
        automation_potential: t.automation_potential,
        category: t.category,
      })
      added += 1
    }
    if (added === 0) break // no more tasks to add
    depth += 1
  }
  // Suppress unused-variable lint while keeping the budget calculation
  // explicit in the code for readability.
  void remaining
  return out
}

function buildConnections(
  clusters: WorkflowCluster[],
  perEmployeeTasks: Map<string, TaskAggregate[]>
): Connection[] {
  // For every pair of employees who appear in the same cluster, accumulate
  // a connection. Weight = shared capture volume / max single-employee
  // capture volume in the dataset (so 0..1). Capability list = union of
  // cluster capabilities across all shared clusters.
  const maxEmployeeTotal = Math.max(
    1,
    ...Array.from(perEmployeeTasks.values()).map((tasks) =>
      tasks.reduce((s, t) => s + t.count, 0)
    )
  )
  const map = new Map<string, Connection>()

  for (const cluster of clusters) {
    const empIds = cluster.employee_ids
    if (empIds.length < 2) continue

    // Compute capture volume contributed by each employee in this cluster
    // (matching tasks' frequency).
    const volByEmp = new Map<string, number>()
    for (const mt of cluster.matching_tasks) {
      const tasks = perEmployeeTasks.get(mt.employee_id) ?? []
      const t = tasks.find((tt) => tt.task === mt.task)
      const v = t?.count ?? 1
      volByEmp.set(mt.employee_id, (volByEmp.get(mt.employee_id) ?? 0) + v)
    }

    for (let i = 0; i < empIds.length; i++) {
      for (let j = i + 1; j < empIds.length; j++) {
        const [a, b] = [empIds[i], empIds[j]].sort()
        const key = `${a}::${b}`
        const sharedVol =
          Math.min(volByEmp.get(a) ?? 0, volByEmp.get(b) ?? 0) || 1
        const existing = map.get(key)
        if (existing) {
          existing.weight = Math.min(
            1,
            existing.weight + sharedVol / maxEmployeeTotal
          )
          for (const cap of cluster.capabilities) {
            if (!existing.shared_capabilities.includes(cap)) {
              existing.shared_capabilities.push(cap)
            }
          }
        } else {
          map.set(key, {
            source_employee_id: a,
            target_employee_id: b,
            weight: Math.min(1, sharedVol / maxEmployeeTotal),
            shared_capabilities: [...cluster.capabilities],
          })
        }
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.weight - a.weight)
}

function computeClusterROI(
  cluster: WorkflowCluster,
  employees: EmployeeRow[],
  perEmployeeTasks: Map<string, TaskAggregate[]>,
  rateOverrides: Record<string, number>
): {
  weekly_minutes: number
  annual_cost: number
  annual_savings: number
  task_node_ids: string[]
} {
  // Sum up matching captures × rate per employee. Mirrors the math in
  // /api/detect-opportunities so the two views agree.
  let weeklyMinutes = 0
  let annualCost = 0
  const taskNodeIds: string[] = []

  for (const mt of cluster.matching_tasks) {
    const employee = employees.find((e) => e.id === mt.employee_id)
    if (!employee) continue
    const tasks = perEmployeeTasks.get(employee.id) ?? []
    const taskIndex = tasks.findIndex((t) => t.task === mt.task)
    if (taskIndex === -1) continue
    const t = tasks[taskIndex]
    const minutes = (t.count * CAPTURE_INTERVAL_SECONDS) / 60
    weeklyMinutes += minutes
    const rate = resolveRate(employee.role, rateOverrides)
    const annualHours = (minutes / 60) * (WORKING_DAYS_PER_YEAR / 5)
    annualCost += annualHours * rate
    taskNodeIds.push(`task:${employee.id}:${taskIndex}`)
  }

  const annualSavings = annualCost * SAVINGS_RATE
  return {
    weekly_minutes: Math.round(weeklyMinutes),
    annual_cost: Math.round(annualCost),
    annual_savings: Math.round(annualSavings),
    task_node_ids: Array.from(new Set(taskNodeIds)),
  }
}

// ----- Core pipeline ------------------------------------------------------

async function computeFresh(
  businessId: string,
  apiKey: string
): Promise<WorkflowIntelligencePayload> {
  const supabase = serverSupabase()
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [empRes, capRes, capabilitiesList, rateOverrides] = await Promise.all([
    supabase
      .from('employees')
      .select('id, business_id, name, role')
      .eq('business_id', businessId)
      .eq('is_active', true),
    supabase
      .from('captures')
      .select(
        'employee_id, captured_at, task, category, software, automation_potential, capabilities, capture_enrichments'
      )
      .eq('business_id', businessId)
      .gte('captured_at', since)
      .not('task', 'is', null),
    getCapabilities(),
    loadRateOverrides(supabase, businessId),
  ])

  if (empRes.error) throw new Error(`employees fetch: ${empRes.error.message}`)
  if (capRes.error) throw new Error(`captures fetch: ${capRes.error.message}`)

  const employees = (empRes.data ?? []) as EmployeeRow[]
  const captures = (capRes.data ?? []) as CaptureRow[]

  const perEmployeeTasks = aggregateTasks(captures)
  const selectedEmployees = pickEmployeeNodes(employees, perEmployeeTasks)

  const employeeNodes = buildEmployeeNodes(selectedEmployees, perEmployeeTasks)
  const taskBudget = MAX_TOTAL_NODES - selectedEmployees.length
  const taskNodes = buildTaskNodes(selectedEmployees, perEmployeeTasks, taskBudget)

  const categories = Array.from(
    new Set(
      captures
        .map((c) => c.category)
        .filter((c): c is string => !!c && c !== 'Break or Idle' && c !== 'Unknown')
    )
  ).sort()

  // No active captures? Return an empty payload — the client renders an
  // empty state. We still cache so we don't re-run Sonnet on every poll.
  if (selectedEmployees.length === 0 || captures.length === 0) {
    return {
      business_id: businessId,
      generated_at: new Date().toISOString(),
      cache_age_seconds: 0,
      cache_hit: false,
      window_days: WINDOW_DAYS,
      categories,
      employees: employeeNodes,
      task_nodes: taskNodes,
      connections: [],
      clusters: [],
      total_annual_savings: 0,
    }
  }

  // Build the prompt input — top N tasks per employee
  const promptEmployees: PromptEmployee[] = selectedEmployees.map((e) => {
    const tasks = perEmployeeTasks.get(e.id) ?? []
    const promptTasks: PromptEmployeeTask[] = tasks
      .slice(0, MAX_TASKS_PER_EMPLOYEE_PROMPT)
      .map((t) => ({
        task: t.task,
        count: t.count,
        software: t.software,
        capability_ids: t.capability_ids,
        automation_potential: t.automation_potential,
        category: t.category,
        enrichment: t.enrichment?.summary ?? null,
      }))
    return { id: e.id, name: e.name, role: e.role, tasks: promptTasks }
  })

  const systemPrompt = buildSystemPrompt(capabilitiesList)
  const userPrompt = buildUserPrompt(promptEmployees)

  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        // Capability taxonomy is most of the system prompt — cache it.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  })

  // Extract the text content block.
  const textBlock = response.content.find((b) => b.type === 'text')
  const rawText = textBlock && textBlock.type === 'text' ? textBlock.text : ''

  let parsed
  try {
    parsed = parseClusterResponse(rawText)
  } catch (e) {
    console.error('workflow-intelligence: failed to parse Claude response', {
      error: e instanceof Error ? e.message : String(e),
      raw: rawText.slice(0, 500),
    })
    parsed = { clusters: [] }
  }

  // Build cluster objects with ROI + task node references.
  const employeeIdSet = new Set(selectedEmployees.map((e) => e.id))
  const rawClusters: WorkflowCluster[] = []
  for (let i = 0; i < parsed.clusters.length; i++) {
    const c = parsed.clusters[i]
    // Filter out clusters whose employees we don't have in the dataset
    // (Claude can hallucinate ids).
    const empIds = (c.employee_ids ?? []).filter((id) => employeeIdSet.has(id))
    if (empIds.length < 2) continue
    const matching = (c.matching_tasks ?? []).filter((mt) =>
      employeeIdSet.has(mt.employee_id)
    )
    if (matching.length < 2) continue

    const draft: WorkflowCluster = {
      id: `cluster:${i}`,
      label: typeof c.label === 'string' ? c.label : 'Untitled cluster',
      description: typeof c.description === 'string' ? c.description : '',
      employee_ids: empIds,
      task_node_ids: [],
      capabilities: Array.isArray(c.capability_ids) ? c.capability_ids : [],
      weekly_minutes: 0,
      annual_cost: 0,
      annual_savings: 0,
      confidence: Math.min(
        1,
        Math.max(0, typeof c.confidence === 'number' ? c.confidence : 0.5)
      ),
      automation_class: normalizeAutomationClass(c.automation_class),
      matching_tasks: matching.map((mt) => ({
        employee_id: mt.employee_id,
        task: mt.task,
        similarity: Math.min(
          1,
          Math.max(0, typeof mt.similarity === 'number' ? mt.similarity : 0.5)
        ),
      })),
    }
    const roi = computeClusterROI(
      draft,
      selectedEmployees,
      perEmployeeTasks,
      rateOverrides
    )
    draft.weekly_minutes = roi.weekly_minutes
    draft.annual_cost = roi.annual_cost
    draft.annual_savings = roi.annual_savings
    draft.task_node_ids = roi.task_node_ids
    rawClusters.push(draft)
  }

  const clusters = rawClusters.sort((a, b) => b.annual_savings - a.annual_savings)
  const connections = buildConnections(clusters, perEmployeeTasks)
  const totalAnnualSavings = clusters.reduce((s, c) => s + c.annual_savings, 0)

  return {
    business_id: businessId,
    generated_at: new Date().toISOString(),
    cache_age_seconds: 0,
    cache_hit: false,
    window_days: WINDOW_DAYS,
    categories,
    employees: employeeNodes,
    task_nodes: taskNodes,
    connections,
    clusters,
    total_annual_savings: totalAnnualSavings,
  }
}

// ----- Handler ------------------------------------------------------------

export async function GET(request: NextRequest) {
  const owner = await resolveOwner(request)
  if (!owner) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Cache check first — most calls hit cache and never invoke Claude.
  const supabase = serverSupabase()
  const { data: cached } = await supabase
    .from('workflow_intelligence_cache')
    .select('payload, generated_at')
    .eq('business_id', owner.business.id)
    .maybeSingle()

  const url = new URL(request.url)
  const force = url.searchParams.get('refresh') === '1'

  if (cached && !force) {
    const ageSec = Math.floor(
      (Date.now() - new Date(cached.generated_at).getTime()) / 1000
    )
    if (ageSec < CACHE_TTL_SECONDS) {
      const payload = cached.payload as WorkflowIntelligencePayload
      payload.cache_age_seconds = ageSec
      payload.cache_hit = true
      return NextResponse.json(payload, {
        headers: { 'Cache-Control': 'no-store' },
      })
    }
  }

  // Cache miss → check rate limit before running Claude.
  const rl = await checkRateLimit(`business:${owner.business.id}`)
  if (!rl.success) {
    // Soft-fail with stale cache if we have one — better to show old data
    // than a 429 in the dashboard hero.
    if (cached) {
      const payload = cached.payload as WorkflowIntelligencePayload
      payload.cache_age_seconds = Math.floor(
        (Date.now() - new Date(cached.generated_at).getTime()) / 1000
      )
      payload.cache_hit = true
      return NextResponse.json(payload, {
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    return NextResponse.json({ error: 'rate limited' }, { status: 429 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })
  }

  let payload: WorkflowIntelligencePayload
  try {
    payload = await computeFresh(owner.business.id, apiKey)
  } catch (err) {
    console.error('workflow-intelligence: compute failed', err)
    if (cached) {
      const stale = cached.payload as WorkflowIntelligencePayload
      stale.cache_age_seconds = Math.floor(
        (Date.now() - new Date(cached.generated_at).getTime()) / 1000
      )
      stale.cache_hit = true
      return NextResponse.json(stale, {
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Write-through to cache. Best-effort — a failed write doesn't change
  // the response.
  const { error: cacheErr } = await supabase
    .from('workflow_intelligence_cache')
    .upsert(
      {
        business_id: owner.business.id,
        payload,
        generated_at: payload.generated_at,
      },
      { onConflict: 'business_id' }
    )
  if (cacheErr) {
    console.error('workflow-intelligence: cache write failed', cacheErr)
  }

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
