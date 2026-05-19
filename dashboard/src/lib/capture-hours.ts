/**
 * Capture-hours config — shared shape + defaults between the settings
 * page, the API endpoint, and any future surface that needs to know
 * when agents are scheduled to run.
 *
 * Stored as jsonb at business_profiles.capture_hours. When the column
 * is null (fresh businesses, pre-migration profiles), we return
 * DEFAULT_CAPTURE_HOURS so every caller gets a sensible answer without
 * having to write defaults inline.
 */

/** Day-of-week abbreviation. Matches ISO weekday names lowercased.
 *  Python's `datetime.now().strftime("%a").lower()` returns the same
 *  shape so the agent can compare directly without translation. */
export type CaptureDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export const ALL_DAYS: CaptureDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export type CaptureHours = {
  /** Days when capture is enabled. Empty = capture never runs. */
  days: CaptureDay[]
  /** HH:MM in 24h local time WITHIN THE BUSINESS TIMEZONE. */
  start_time: string
  /** HH:MM in 24h local time WITHIN THE BUSINESS TIMEZONE. */
  end_time: string
  /** IANA timezone identifier (e.g. "America/Los_Angeles"). The agent
   *  converts the employee's machine time into this zone before
   *  comparing against start/end. Default = America/Los_Angeles. */
  timezone: string
}

/** Default timezone — chosen because it's CK's. Easy to switch later if
 *  we want to localize per-account. */
export const DEFAULT_TIMEZONE = 'America/Los_Angeles'

export const DEFAULT_CAPTURE_HOURS: CaptureHours = {
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  start_time: '08:00',
  end_time: '18:00',
  timezone: DEFAULT_TIMEZONE,
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidTime(s: unknown): s is string {
  return typeof s === 'string' && TIME_RE.test(s)
}

export function isValidDay(s: unknown): s is CaptureDay {
  return (
    typeof s === 'string' &&
    (ALL_DAYS as readonly string[]).includes(s)
  )
}

/** Convert "HH:MM" → minutes since midnight. */
export function timeToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

/** Light IANA timezone validation. We don't ship a full list — we
 *  defer to Intl.DateTimeFormat for the "is this a real zone?" check,
 *  which the runtime supports across node 24 + modern browsers. Any
 *  string that DateTimeFormat rejects falls back to the default. */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0) return false
  try {
    // Constructing a DateTimeFormat with an invalid tz throws.
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Parse a possibly-malformed jsonb value into a valid CaptureHours,
 *  falling back to defaults for anything that doesn't parse cleanly.
 *  Callers (UI + API) can rely on the return being structurally valid. */
export function parseCaptureHours(raw: unknown): CaptureHours {
  if (!raw || typeof raw !== 'object') return DEFAULT_CAPTURE_HOURS
  const obj = raw as Record<string, unknown>
  const days = Array.isArray(obj.days)
    ? (obj.days.filter(isValidDay) as CaptureDay[])
    : DEFAULT_CAPTURE_HOURS.days
  const start_time = isValidTime(obj.start_time)
    ? obj.start_time
    : DEFAULT_CAPTURE_HOURS.start_time
  const end_time = isValidTime(obj.end_time)
    ? obj.end_time
    : DEFAULT_CAPTURE_HOURS.end_time
  const timezone = isValidTimezone(obj.timezone)
    ? obj.timezone
    : DEFAULT_TIMEZONE
  // Defensive: if end is before start, fall back to default (a 0-duration
  // window would mean "agents never capture" which is rarely intentional).
  if (timeToMinutes(end_time) <= timeToMinutes(start_time)) {
    return DEFAULT_CAPTURE_HOURS
  }
  return { days, start_time, end_time, timezone }
}

/** Day-of-week shorthand emitted by Intl.DateTimeFormat 'short'. */
const _INTL_WEEKDAY_TO_DAY: Record<string, CaptureDay> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
}

/**
 * Returns true when `when` falls inside the configured capture window in
 * the BUSINESS timezone. Mirrors the agent's _is_within_business_hours()
 * in main.py so dashboard chips agree with what the agent will actually do.
 *
 * Defensive: any structural problem with the hours config returns true
 * (don't accidentally silence the agent). Parse failures return true too.
 *
 * Used by the dashboard to decide whether "the agent hasn't sent anything
 * for 30 min" should be flagged as "Idle at desk" or accepted as "Off
 * hours, expected silence".
 */
export function isWithinBusinessHours(
  when: Date,
  hours: CaptureHours
): boolean {
  if (!hours || !Array.isArray(hours.days)) return true
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: hours.timezone || DEFAULT_TIMEZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(when)
    const weekdayPart = parts.find((p) => p.type === 'weekday')?.value
    const hourPart = parts.find((p) => p.type === 'hour')?.value
    const minutePart = parts.find((p) => p.type === 'minute')?.value
    if (!weekdayPart || !hourPart || !minutePart) return true

    const day = _INTL_WEEKDAY_TO_DAY[weekdayPart]
    if (!day || !hours.days.includes(day)) return false

    const hourNum = parseInt(hourPart, 10)
    // Intl can emit "24" at midnight depending on hour12/locale combos;
    // normalize to 0 so the minute math is sane.
    const h = hourNum === 24 ? 0 : hourNum
    const m = parseInt(minutePart, 10)
    if (Number.isNaN(h) || Number.isNaN(m)) return true

    const currentMin = h * 60 + m
    const startMin = timeToMinutes(hours.start_time)
    const endMin = timeToMinutes(hours.end_time)
    return currentMin >= startMin && currentMin < endMin
  } catch {
    // Unknown timezone, parse error, etc. — fall open (assume in-hours)
    // so we don't suppress dashboard signals on garbage config.
    return true
  }
}

/** Validate a payload incoming on PATCH from the settings UI. Returns
 *  the normalized CaptureHours or an Error message describing what's
 *  invalid (so the API can 400). */
export function validateCaptureHoursPayload(
  raw: unknown
): { ok: true; value: CaptureHours } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'body must be an object' }
  }
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.days)) {
    return { ok: false, error: 'days must be an array' }
  }
  const days = obj.days.filter(isValidDay) as CaptureDay[]
  if (days.length !== obj.days.length) {
    return { ok: false, error: 'days must contain only mon..sun' }
  }
  if (!isValidTime(obj.start_time)) {
    return { ok: false, error: 'start_time must be HH:MM' }
  }
  if (!isValidTime(obj.end_time)) {
    return { ok: false, error: 'end_time must be HH:MM' }
  }
  if (timeToMinutes(obj.end_time) <= timeToMinutes(obj.start_time)) {
    return { ok: false, error: 'end_time must be after start_time' }
  }
  // timezone is required on PATCH so PATCH callers can't drop it
  // accidentally and revert to the default.
  if (!isValidTimezone(obj.timezone)) {
    return { ok: false, error: 'timezone must be a valid IANA identifier (e.g. America/Los_Angeles)' }
  }
  return {
    ok: true,
    value: {
      days,
      start_time: obj.start_time,
      end_time: obj.end_time,
      timezone: obj.timezone,
    },
  }
}
