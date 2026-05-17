/**
 * Agent heartbeat status — shared logic for "is this employee's agent
 * actually running right now?"
 *
 * Two signals exist:
 *   - employees.agent_version_updated_at: written by /api/agent-version on
 *     startup + once per idle hour. The most reliable indicator that the
 *     agent process is alive.
 *   - max(captures.captured_at) per employee: written every 30s during
 *     active work. Indicates the agent is also doing classification +
 *     transmission (not just polling for updates).
 *
 * Status thresholds:
 *   - active       : last heartbeat within the last 30 minutes
 *   - warning      : last heartbeat 30 min - 2 hours ago AND it's
 *                    business hours in the viewer's local time
 *   - silent_long  : last heartbeat > 24 hours ago
 *   - silent       : last heartbeat 2-24 hours ago, or outside business
 *                    hours
 *   - never        : agent has never checked in (agent_version_updated_at
 *                    is null and no captures)
 *
 * The "during business hours" gate prevents false alarms for legitimate
 * off-work periods (overnight, weekends). Pre-Monday we keep this simple
 * — viewer local time, Mon-Fri 08:00-18:00. We can promote this to a
 * per-business profile field later.
 */

export type HeartbeatStatus =
  | 'active'
  | 'warning'
  | 'silent'
  | 'silent_long'
  | 'never'

export type HeartbeatInputs = {
  agent_version_updated_at: string | null
  /** Most recent capture timestamp (may be null if no captures). */
  last_capture_at: string | null
}

const WARN_AFTER_MINUTES = 30
const SILENT_AFTER_MINUTES = 120 // 2 hours
const LONG_SILENT_AFTER_HOURS = 24

/** Local-time check used by the dashboard UI. The digest cron has its own
 *  global definition (just "silent_long") and doesn't care about
 *  business-hours gating. */
export function isBusinessHoursNow(now: Date = new Date()): boolean {
  const day = now.getDay() // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false
  const hour = now.getHours()
  return hour >= 8 && hour < 18
}

/** Latest of the two heartbeat signals. Returns null if neither exists. */
function latestSignal(inputs: HeartbeatInputs): Date | null {
  const a = inputs.agent_version_updated_at
    ? new Date(inputs.agent_version_updated_at)
    : null
  const b = inputs.last_capture_at ? new Date(inputs.last_capture_at) : null
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  return a.getTime() > b.getTime() ? a : b
}

export function computeHeartbeatStatus(
  inputs: HeartbeatInputs,
  now: Date = new Date()
): HeartbeatStatus {
  const last = latestSignal(inputs)
  if (!last) return 'never'

  const ageMinutes = (now.getTime() - last.getTime()) / 1000 / 60
  if (ageMinutes < WARN_AFTER_MINUTES) return 'active'

  const ageHours = ageMinutes / 60
  if (ageHours >= LONG_SILENT_AFTER_HOURS) return 'silent_long'

  if (ageMinutes < SILENT_AFTER_MINUTES) {
    return isBusinessHoursNow(now) ? 'warning' : 'active'
  }
  return isBusinessHoursNow(now) ? 'silent' : 'silent'
}

export function ageLabel(
  inputs: HeartbeatInputs,
  now: Date = new Date()
): string {
  const last = latestSignal(inputs)
  if (!last) return 'never connected'
  const ageMinutes = (now.getTime() - last.getTime()) / 1000 / 60
  if (ageMinutes < 1) return 'just now'
  if (ageMinutes < 60) return `${Math.floor(ageMinutes)}m ago`
  const ageHours = ageMinutes / 60
  if (ageHours < 24) return `${Math.floor(ageHours)}h ago`
  return `${Math.floor(ageHours / 24)}d ago`
}
