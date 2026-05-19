/**
 * Workflow sequence detection — groups captures into multi-step chains.
 *
 * Captures are scored as isolated events by the opportunity engine: a
 * capability tag here, a category there. The same data also encodes
 * MULTI-STEP WORKFLOWS that recur — "WellSky → Excel → QuickBooks →
 * Outlook" as a four-step pattern that runs every Tuesday. This module
 * surfaces those chains so the dashboard can show them as units.
 *
 * Algorithm:
 *   1. Sort an employee's captures by captured_at ascending.
 *   2. Split into "sessions" — a new session starts when the gap between
 *      consecutive captures exceeds SESSION_GAP_MS (15 minutes).
 *   3. Within each session, collapse consecutive captures that share the
 *      same (tool, category) — the user staying on one tool isn't a step.
 *   4. The remaining transition points are the sequence's steps.
 *   5. Filter: a sequence must have >= MIN_STEPS distinct steps AND
 *      involve >= MIN_DISTINCT_TOOLS different tools. Otherwise it's
 *      either trivial ("Outlook → Outlook → Outlook") or too short to
 *      meaningfully automate.
 *   6. Hash the ordered (tool, category) chain → sequence_hash. The
 *      same workflow detected on different employees / different days
 *      / different times produces the same hash, so the upserter rolls
 *      it into one row with occurrence_count > 1.
 *
 * Confidence scoring (range [0.5, 1.0]):
 *   base 0.5
 *   + 0.1 per additional occurrence beyond the first (max +0.3)
 *   + 0.1 if the sequence appears across more than one employee
 *   + 0.1 if all step captures had high individual confidence (> 80)
 *   + 0.1 if occurrence start times cluster on a consistent interval
 *         (CV of inter-occurrence gaps <= INTERVAL_CV_THRESHOLD)
 *
 * The hash + dedup design lets re-detection be safe: rerunning across
 * the same window finds the same hashes, the upsert path increments
 * occurrence_count but the (sequence_id, capture_id) unique constraint
 * on steps blocks double-insertion of the same capture as a step.
 */

import crypto from 'node:crypto'

// ---- Tunables -------------------------------------------------------------

/** Maximum gap between consecutive captures within a single "session". */
export const SESSION_GAP_MS = 15 * 60 * 1000

/** Minimum number of distinct steps a sequence must have to qualify. */
export const MIN_STEPS = 3

/** Minimum number of unique tools touched across the chain. */
export const MIN_DISTINCT_TOOLS = 2

/** Per-step confidence (from captures.confidence, 0-100 scale) above
 *  which we consider the step "high confidence". */
const HIGH_STEP_CONFIDENCE = 80

/** Coefficient-of-variation threshold below which we consider occurrence
 *  inter-arrival times "regular". Lower = stricter. 0.25 means the
 *  standard deviation must be <= 25% of the mean interval. */
const INTERVAL_CV_THRESHOLD = 0.25

// ---- Types ----------------------------------------------------------------

export type CaptureRowForDetection = {
  id: string
  employee_id: string
  business_id: string
  captured_at: string // ISO
  task: string | null
  category: string | null
  software: string | null
  confidence: number | null
}

export type DetectedSequenceOccurrence = {
  /** The capture rows that compose this occurrence, in order. Length
   *  equals the sequence's step_count. */
  steps: CaptureRowForDetection[]
  /** Canonical hash over the ordered (tool, category) chain. The same
   *  hash across multiple occurrences denotes the same sequence. */
  sequenceHash: string
  /** Ordered tool names step-by-step (length == steps.length). */
  tools: string[]
  /** Ordered categories step-by-step (length == steps.length). */
  categories: string[]
  /** Duration in seconds from first step to last step. */
  durationSeconds: number
}

// ---- Detection ------------------------------------------------------------

/**
 * Detect all qualifying sequence occurrences for a single employee.
 * The caller is responsible for batching this across employees and
 * then computing cross-employee statistics.
 */
export function detectSequencesForEmployee(
  captures: CaptureRowForDetection[]
): DetectedSequenceOccurrence[] {
  if (captures.length < MIN_STEPS) return []

  const sorted = [...captures].sort((a, b) =>
    a.captured_at.localeCompare(b.captured_at)
  )

  // 1. Split into sessions (15-min gap threshold).
  const sessions: CaptureRowForDetection[][] = []
  let current: CaptureRowForDetection[] = []
  for (const cap of sorted) {
    if (current.length === 0) {
      current.push(cap)
      continue
    }
    const prev = current[current.length - 1]
    const gapMs =
      new Date(cap.captured_at).getTime() - new Date(prev.captured_at).getTime()
    if (gapMs > SESSION_GAP_MS) {
      sessions.push(current)
      current = [cap]
    } else {
      current.push(cap)
    }
  }
  if (current.length > 0) sessions.push(current)

  // 2. Within each session, build the transition chain by collapsing
  //    consecutive (tool, category) duplicates.
  const out: DetectedSequenceOccurrence[] = []
  for (const session of sessions) {
    const chain: CaptureRowForDetection[] = []
    for (const cap of session) {
      const prev = chain[chain.length - 1]
      if (!prev) {
        chain.push(cap)
        continue
      }
      const sameTool = normalize(cap.software) === normalize(prev.software)
      const sameCat = normalize(cap.category) === normalize(prev.category)
      if (sameTool && sameCat) continue
      chain.push(cap)
    }
    if (chain.length < MIN_STEPS) continue
    const distinctTools = new Set(
      chain.map((c) => normalize(c.software)).filter((s) => s.length > 0)
    )
    if (distinctTools.size < MIN_DISTINCT_TOOLS) continue

    const tools = chain.map((c) => c.software ?? '')
    const categories = chain.map((c) => c.category ?? '')
    const start = new Date(chain[0].captured_at).getTime()
    const end = new Date(chain[chain.length - 1].captured_at).getTime()
    out.push({
      steps: chain,
      sequenceHash: hashChain(tools, categories),
      tools,
      categories,
      durationSeconds: Math.round((end - start) / 1000),
    })
  }
  return out
}

// ---- Hashing --------------------------------------------------------------

function normalize(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** Canonical fingerprint of an ordered (tool, category) chain. The same
 *  chain across employees / days produces the same hash so the upserter
 *  rolls them into one row. */
export function hashChain(tools: string[], categories: string[]): string {
  if (tools.length !== categories.length) {
    throw new Error('hashChain: tools and categories must have equal length')
  }
  const parts = tools.map((t, i) => `${normalize(t)}|${normalize(categories[i])}`)
  const raw = parts.join('->')
  return crypto.createHash('sha256').update(raw).digest('hex')
}

// ---- Confidence scoring ---------------------------------------------------

export type SequenceScoringInputs = {
  occurrenceCount: number
  /** Distinct employee_ids whose captures contributed to ANY step of
   *  this sequence. */
  employeeCount: number
  /** Average per-step confidence (0-100) across all step captures of
   *  all occurrences. */
  avgStepConfidence: number
  /** Sorted ascending start-time (ISO) of each occurrence — used to
   *  judge inter-arrival regularity. */
  occurrenceStartTimes: string[]
}

export function scoreSequenceConfidence(input: SequenceScoringInputs): number {
  let score = 0.5
  // +0.1 per additional occurrence beyond the first, capped at +0.3.
  score += Math.min(0.3, 0.1 * Math.max(0, input.occurrenceCount - 1))
  if (input.employeeCount > 1) score += 0.1
  if (input.avgStepConfidence > HIGH_STEP_CONFIDENCE) score += 0.1
  if (hasConsistentInterval(input.occurrenceStartTimes)) score += 0.1
  return clamp01(score)
}

function clamp01(x: number): number {
  return Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000
}

/** True iff occurrence start times are spaced uniformly enough to
 *  suggest a triggered or scheduled workflow. Requires at least 3
 *  occurrences (need at least 2 inter-arrival gaps to compute a CV). */
function hasConsistentInterval(starts: string[]): boolean {
  if (starts.length < 3) return false
  const times = [...starts].map((t) => new Date(t).getTime()).sort((a, b) => a - b)
  const intervals: number[] = []
  for (let i = 1; i < times.length; i++) {
    intervals.push(times[i] - times[i - 1])
  }
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
  if (mean <= 0) return false
  const variance =
    intervals.reduce((a, x) => a + Math.pow(x - mean, 2), 0) / intervals.length
  const cv = Math.sqrt(variance) / mean
  return cv <= INTERVAL_CV_THRESHOLD
}
