/**
 * Handoff affinity rules + detection helpers.
 *
 * A "handoff" pairs employee A's session-ending capture with employee
 * B's session-starting capture when they happen within HANDOFF_WINDOW_MS
 * AND the (from, to) tool/category pair matches a known affinity rule.
 * Random tool flips between people don't count — only meaningful
 * transitions where one type of work hands off to another.
 *
 * Affinity rules are intentionally narrow:
 *
 *   billing/invoicing  →  accounting tools          billing handoff
 *   scheduling         →  family/internal comms     schedule notification
 *   document creation  →  internal comms / email    approval / notification
 *   care planning      →  scheduling                care-plan → schedule
 *   any                →  compliance/reporting      compliance handoff
 *
 * Extend HANDOFF_AFFINITY_MAP below as new tool patterns emerge from
 * production data. The wildcard "any → compliance" rule catches the
 * universal pattern of compliance documentation following any work.
 */

// =============================================================================
// Tunables
// =============================================================================

/** Maximum time gap between A's last capture and B's first capture
 *  for the pair to qualify as a handoff candidate. 4 hours is wide
 *  enough to span a lunch break but narrow enough to exclude "B did
 *  something semi-related the next morning". */
export const HANDOFF_WINDOW_MS = 4 * 60 * 60 * 1000

/** Minimum positive gap. A handoff with effectively 0 gap (simultaneous
 *  captures across employees) is suspicious — probably the same time
 *  window but no actual handoff. Set to 1 minute to filter near-zero
 *  noise while still catching very fast real handoffs. */
export const HANDOFF_MIN_GAP_MS = 60 * 1000

/** Bottleneck thresholds (in minutes). See is_bottleneck column comment
 *  on workflow_handoffs — both apply only after occurrence_count >= 3. */
export const BOTTLENECK_GAP_MINUTES = 60
export const CRITICAL_BOTTLENECK_GAP_MINUTES = 240
export const BOTTLENECK_MIN_OCCURRENCES = 3

// =============================================================================
// Affinity map
// =============================================================================

export type AffinityEndpoint = {
  /** Category to match (exact). Use '*' for any. */
  category?: string
  /** Optional regex applied to the tool/software string when category
   *  alone is too coarse. Case-insensitive matching. */
  toolPattern?: RegExp
  /** Human-readable label used in the contextLabel composition. */
  label: string
}

export type AffinityRule = {
  from: AffinityEndpoint
  to: AffinityEndpoint
  /** Short human-readable description of the handoff. Surfaces on the
   *  card as the task_context string. */
  contextLabel: string
  /** Affinity strength — used in confidence scoring. Specific
   *  category-pair rules score higher than wildcard rules. */
  strength: 'strong' | 'medium' | 'weak'
}

/** Order matters: rules are evaluated top-to-bottom and the first
 *  match wins. Specific rules go above wildcards. */
export const HANDOFF_AFFINITY_MAP: AffinityRule[] = [
  // Billing → accounting
  {
    from: { category: 'Billing and Invoicing', label: 'billing' },
    to: { toolPattern: /quickbooks|xero|netsuite|sage|freshbooks|wave|accounting/i, label: 'accounting' },
    contextLabel: 'Billing handoff',
    strength: 'strong',
  },
  // Billing/invoicing → payroll processing (overlapping financial flows)
  {
    from: { category: 'Billing and Invoicing', label: 'billing' },
    to: { category: 'Payroll Processing', label: 'payroll' },
    contextLabel: 'Billing → payroll handoff',
    strength: 'strong',
  },
  // Scheduling → family communication (notify the family of schedule)
  {
    from: { category: 'Schedule Management', label: 'scheduling' },
    to: { category: 'Family and Client Communication', label: 'family communication' },
    contextLabel: 'Schedule notification to family',
    strength: 'strong',
  },
  // Scheduling → internal communication (notify the team)
  {
    from: { category: 'Schedule Management', label: 'scheduling' },
    to: { category: 'Internal Communication', label: 'team chat' },
    contextLabel: 'Schedule notification to team',
    strength: 'strong',
  },
  // Document creation / reporting → internal communication (approval flow)
  {
    from: { category: 'Reporting and Documentation', label: 'document creation' },
    to: { category: 'Internal Communication', label: 'team chat' },
    contextLabel: 'Document approval / notification',
    strength: 'medium',
  },
  // Document creation / reporting → family communication (sending docs)
  {
    from: { category: 'Reporting and Documentation', label: 'document creation' },
    to: { category: 'Family and Client Communication', label: 'family communication' },
    contextLabel: 'Document send to client',
    strength: 'medium',
  },
  // Care planning → scheduling (translating plan into schedule)
  {
    from: { category: 'Client Intake and Care Planning', label: 'care planning' },
    to: { category: 'Schedule Management', label: 'scheduling' },
    contextLabel: 'Care plan → schedule',
    strength: 'strong',
  },
  // HR onboarding → scheduling (new caregiver into rotation)
  {
    from: { category: 'Caregiver HR and Onboarding', label: 'HR onboarding' },
    to: { category: 'Schedule Management', label: 'scheduling' },
    contextLabel: 'Onboarding → schedule',
    strength: 'medium',
  },
  // Problem resolution → family communication (escalation)
  {
    from: { category: 'Problem Resolution', label: 'problem resolution' },
    to: { category: 'Family and Client Communication', label: 'family communication' },
    contextLabel: 'Problem → family update',
    strength: 'medium',
  },
  // Universal: any work → compliance documentation
  {
    from: { category: '*', label: 'any work' },
    to: { category: 'Authorization and Compliance', label: 'compliance documentation' },
    contextLabel: 'Compliance handoff',
    strength: 'weak',
  },
]

// =============================================================================
// Matcher
// =============================================================================

export type AffinityMatch = {
  rule: AffinityRule
  fromLabel: string
  toLabel: string
}

/**
 * Test whether a (fromTool, fromCategory) → (toTool, toCategory) pair
 * matches any rule in the affinity map. Returns the first matching rule
 * (rules earlier in the map win). Null when nothing matches — caller
 * skips this handoff candidate.
 */
export function matchAffinity(
  fromTool: string | null,
  fromCategory: string | null,
  toTool: string | null,
  toCategory: string | null
): AffinityMatch | null {
  const ft = (fromTool ?? '').trim()
  const fc = (fromCategory ?? '').trim()
  const tt = (toTool ?? '').trim()
  const tc = (toCategory ?? '').trim()
  for (const rule of HANDOFF_AFFINITY_MAP) {
    if (!endpointMatches(rule.from, ft, fc)) continue
    if (!endpointMatches(rule.to, tt, tc)) continue
    return {
      rule,
      fromLabel: rule.from.label,
      toLabel: rule.to.label,
    }
  }
  return null
}

function endpointMatches(
  endpoint: AffinityEndpoint,
  tool: string,
  category: string
): boolean {
  // Category gate — '*' is wildcard, exact match otherwise.
  if (endpoint.category && endpoint.category !== '*' && category !== endpoint.category) {
    return false
  }
  // Optional tool refinement.
  if (endpoint.toolPattern) {
    if (!tool) return false
    if (!endpoint.toolPattern.test(tool)) return false
  }
  return true
}

// =============================================================================
// Bottleneck classification
// =============================================================================

export function classifyBottleneck(args: {
  avgGapMinutes: number
  occurrenceCount: number
}): { isBottleneck: boolean; isCritical: boolean } {
  const enoughObservations = args.occurrenceCount >= BOTTLENECK_MIN_OCCURRENCES
  const isBottleneck =
    enoughObservations && args.avgGapMinutes > BOTTLENECK_GAP_MINUTES
  const isCritical =
    enoughObservations && args.avgGapMinutes > CRITICAL_BOTTLENECK_GAP_MINUTES
  return { isBottleneck, isCritical }
}

// =============================================================================
// Confidence scoring
// =============================================================================

export type HandoffScoringInputs = {
  occurrenceCount: number
  strength: 'strong' | 'medium' | 'weak'
  /** Gap consistency — coefficient of variation of observed gaps. Pass
   *  null when only one gap is known (no variance possible). */
  gapCv: number | null
}

export function scoreHandoffConfidence(input: HandoffScoringInputs): number {
  let score = 0.5
  // +0.1 per additional occurrence beyond the first, capped at +0.3.
  score += Math.min(0.3, 0.1 * Math.max(0, input.occurrenceCount - 1))
  // Affinity strength: strong rules get +0.1, medium +0.05, weak nothing.
  if (input.strength === 'strong') score += 0.1
  else if (input.strength === 'medium') score += 0.05
  // Gap regularity — uniform inter-handoff gaps suggest a real triggered
  // pattern rather than coincidence.
  if (input.gapCv !== null && input.gapCv <= 0.4) score += 0.1
  return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000
}
