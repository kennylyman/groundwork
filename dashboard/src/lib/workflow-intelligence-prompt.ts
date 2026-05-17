/**
 * Claude prompt for the Workflow Intelligence semantic-clustering pass.
 *
 * Input: per-employee top tasks (with capture frequency + tagged capabilities)
 * Output: clusters of automatable work shared across 2+ employees, each with
 *   a confidence score and the matching task per employee.
 *
 * Separated from the route handler so the prompt itself is testable and
 * reviewable in isolation — the prompt IS the product on this feature.
 */

import type { Capability } from './capabilities-server'

export type PromptEmployeeTask = {
  task: string
  count: number
  software: string | null
  capability_ids: string[]
  automation_potential: string | null
  category: string | null
  /** Optional live tool context distilled from capture_enrichments. When
   *  present, Sonnet sees something like
   *    enrichment="outlook: meeting \"Q3 invoicing review\"; unread ..."
   *  alongside the task line — clusters can be informed by the actual
   *  email/calendar/Teams context, not just the screen-text task. */
  enrichment?: string | null
}

export type PromptEmployee = {
  id: string
  name: string
  role: string | null
  tasks: PromptEmployeeTask[]
}

/** Compact one-line per-capability list for the system prompt. */
function formatCapabilities(capabilities: Capability[]): string {
  return capabilities
    .filter((c) => c.automatable)
    .map((c) => `  ${c.id}  —  ${c.label}`)
    .join('\n')
}

/** Per-employee task block. */
function formatEmployees(employees: PromptEmployee[]): string {
  const lines: string[] = []
  for (const emp of employees) {
    lines.push(
      `employee_id: ${emp.id}  (${emp.name}${emp.role ? `, ${emp.role}` : ''})`
    )
    for (const t of emp.tasks) {
      const tags = t.capability_ids.length ? `  caps=${t.capability_ids.join(',')}` : ''
      const sw = t.software ? `  sw=${t.software}` : ''
      const auto = t.automation_potential ? `  auto=${t.automation_potential}` : ''
      lines.push(
        `  - "${t.task}"  freq=${t.count}${sw}${tags}${auto}`
      )
      // When live tool context is available for this task, add it as a
      // sub-line. Sonnet's clustering can use this to distinguish e.g.
      // "drafting customer reply" (CRM context) from "drafting internal
      // email" (Slack context) when the surface task text is similar.
      if (t.enrichment) {
        lines.push(`      context: ${t.enrichment}`)
      }
    }
    if (emp.tasks.length === 0) {
      lines.push('  (no tagged tasks in window)')
    }
    lines.push('')
  }
  return lines.join('\n')
}

export const SYSTEM_PROMPT = `You analyze how a small business team spends their time and surface clusters where multiple people are doing the same underlying automatable workflow — even if they describe it differently.

The product is "Groundwork", a workflow intelligence platform. Owners see this map of their team to understand where automation would help. The clusters you identify are the centerpiece — keep quality high.

A valid cluster:
  - Involves at least 2 different employees
  - Is genuinely automatable (Zapier-style trigger/action, OR composable multi-step that an AI agent could do)
  - Each participating employee has frequency >= 5 (the work is recurring, not one-off)
  - The underlying workflow is the SAME even if the surface task text differs ("scheduling shifts in WellSky" and "updating shift assignments" can be one cluster)

NOT a cluster:
  - One-off / non-repeating work
  - Creative judgment work (writing custom replies, making decisions)
  - Phone calls and meetings
  - Activities already automated by the underlying tool
  - Solo work — if only one employee does it, it's not a cluster

For each cluster, output:
  - label: 5-8 word human-readable name ("Manual schedule entry in WellSky")
  - description: one sentence describing the underlying workflow
  - employee_ids: which employees participate
  - matching_tasks: for each participating employee, the specific task that matches and a similarity score 0-1
  - capability_ids: from the AUTOMATABLE capability taxonomy below
  - confidence: 0-1, how clearly these are the same shared automatable workflow
  - automation_class:
      "A" = Zapier-able (single trigger → single action between named tools)
      "B" = composed agent (multi-step, needs reasoning between steps)
      "C" = custom integration needed (rare data shapes, weird APIs)

Maximum 6 clusters. Prefer 3 strong clusters over 6 weak ones. Skip if you can't find any.

AUTOMATABLE CAPABILITY TAXONOMY (use these exact ids):
{capabilities}

Return ONLY valid JSON, no markdown fences, no preamble:
{
  "clusters": [
    {
      "label": "...",
      "description": "...",
      "employee_ids": ["..."],
      "matching_tasks": [
        { "employee_id": "...", "task": "...", "similarity": 0.92 }
      ],
      "capability_ids": ["..."],
      "confidence": 0.85,
      "automation_class": "A"
    }
  ]
}`

export function buildSystemPrompt(capabilities: Capability[]): string {
  return SYSTEM_PROMPT.replace('{capabilities}', formatCapabilities(capabilities))
}

export function buildUserPrompt(employees: PromptEmployee[]): string {
  return `EMPLOYEES AND THEIR TASKS (last 7 days):

${formatEmployees(employees)}
Identify the clusters. Return JSON only.`
}

export type ClaudeClusterResponse = {
  clusters: Array<{
    label: string
    description: string
    employee_ids: string[]
    matching_tasks: Array<{
      employee_id: string
      task: string
      similarity: number
    }>
    capability_ids: string[]
    confidence: number
    automation_class: 'A' | 'B' | 'C'
  }>
}

/** Strip optional markdown fence and parse. */
export function parseClusterResponse(raw: string): ClaudeClusterResponse {
  let s = raw.trim()
  if (s.startsWith('```')) {
    const lines = s.split('\n')
    s = lines.slice(1, -1).join('\n')
  }
  return JSON.parse(s) as ClaudeClusterResponse
}
