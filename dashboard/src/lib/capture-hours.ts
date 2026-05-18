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
  /** HH:MM in 24h local time. Inclusive lower bound. */
  start_time: string
  /** HH:MM in 24h local time. Exclusive upper bound. */
  end_time: string
}

export const DEFAULT_CAPTURE_HOURS: CaptureHours = {
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  start_time: '08:00',
  end_time: '18:00',
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
  // Defensive: if end is before start, fall back to default (a 0-duration
  // window would mean "agents never capture" which is rarely intentional).
  if (timeToMinutes(end_time) <= timeToMinutes(start_time)) {
    return DEFAULT_CAPTURE_HOURS
  }
  return { days, start_time, end_time }
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
  return {
    ok: true,
    value: { days, start_time: obj.start_time, end_time: obj.end_time },
  }
}
