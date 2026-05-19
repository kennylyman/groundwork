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


// =============================================================================
// Split-signal status — agent health vs last active.
//
// The original computeHeartbeatStatus() above conflates "is the process
// alive" with "is the human at the desk". For the team overview we want
// them rendered as two distinct chips so an owner can tell at a glance:
//
//   green + Active now           → fully working
//   green + 30+ min · Idle       → process is fine, person stepped away
//   green + Last cap · Off hours → end of shift, expected silence
//   red   + N hrs ago            → agent crashed, needs relaunch
//   gray  + No activity yet      → never installed
//
// The old single-status helpers stay in place for /api/heartbeat-digest
// and any callers we haven't migrated yet.
// =============================================================================

import { isWithinBusinessHours, type CaptureHours } from './capture-hours'

/** Three-state health of the agent PROCESS. Distinct from whether the
 *  employee is actively working. */
export type AgentHealth = 'active' | 'no_heartbeat' | 'not_installed'

/** Spec: heartbeat within last 90 minutes counts as "active". The agent
 *  pings /api/agent-version on startup + once per idle hour, so 90 min
 *  catches the worst-case "just refreshed after 60 min idle" + slack. */
const AGENT_HEARTBEAT_FRESH_MINUTES = 90

/** Compute agent health from the employee row. */
export function agentHealth(emp: {
  agent_version?: string | null
  agent_version_updated_at?: string | null
}, now: Date = new Date()): AgentHealth {
  if (!emp.agent_version) return 'not_installed'
  const ts = emp.agent_version_updated_at
  if (!ts) return 'no_heartbeat'
  const ageMin = (now.getTime() - new Date(ts).getTime()) / 60_000
  return ageMin <= AGENT_HEARTBEAT_FRESH_MINUTES ? 'active' : 'no_heartbeat'
}

/** Subtle qualifier rendered next to the last-active timestamp.
 *  - 'idle': agent is alive AND in business hours now AND last capture
 *            was 30+ min ago AND that last capture itself fell in hours
 *            (so the silence is genuinely "at desk, not working")
 *  - 'off_hours': last capture timestamp fell outside the configured
 *                 window (end of shift; silence is expected) */
export type LastActiveQualifier = 'idle' | 'off_hours' | null

export type LastActive = {
  /** Human-readable relative timestamp: "Active now", "12 min ago",
   *  "2 hrs ago", "Yesterday", "No activity yet". */
  text: string
  qualifier: LastActiveQualifier
}

const IDLE_THRESHOLD_MINUTES = 30

/** Build the two-part Last-active label for an employee row. */
export function lastActive(
  args: {
    last_capture_at: string | null
    agent_health: AgentHealth
    business_hours: CaptureHours
  },
  now: Date = new Date()
): LastActive {
  const lastStr = args.last_capture_at
  if (!lastStr) return { text: 'No activity yet', qualifier: null }
  const last = new Date(lastStr)
  if (Number.isNaN(last.getTime())) {
    return { text: 'No activity yet', qualifier: null }
  }

  const ageMin = (now.getTime() - last.getTime()) / 60_000
  const text = relativeAgeLabel(ageMin, now, last)

  // Qualifier rules (see spec). Off-hours wins when applicable; idle
  // only applies when the silence is happening *during* business hours.
  const lastWasInHours = isWithinBusinessHours(last, args.business_hours)
  const nowIsInHours = isWithinBusinessHours(now, args.business_hours)

  // Last capture's clock fell outside the configured window → end-of-
  // shift silence. Don't imply the user is idling at their desk.
  if (!lastWasInHours) return { text, qualifier: 'off_hours' }

  // Silence is happening during a workday now AND the agent is alive →
  // genuine "at desk but not working" signal. 30 min threshold matches
  // the spec.
  if (
    args.agent_health === 'active' &&
    nowIsInHours &&
    ageMin >= IDLE_THRESHOLD_MINUTES
  ) {
    return { text, qualifier: 'idle' }
  }

  return { text, qualifier: null }
}

/** Friendly relative-age string. Same shape as the spec's examples. */
function relativeAgeLabel(ageMin: number, now: Date, last: Date): string {
  if (ageMin < 2) return 'Active now'
  if (ageMin < 60) return `${Math.floor(ageMin)} min ago`
  const ageHr = ageMin / 60
  if (ageHr < 24) {
    const h = Math.floor(ageHr)
    return `${h} hr${h === 1 ? '' : 's'} ago`
  }
  // Calendar-day comparison so 26 hours during a single overnight reads
  // as "Yesterday" rather than "1 day ago".
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(last, yesterday)) return 'Yesterday'
  const ageDays = Math.floor(ageHr / 24)
  if (ageDays < 7) return `${ageDays} days ago`
  return last.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
