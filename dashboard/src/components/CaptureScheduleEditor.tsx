'use client'

/**
 * CaptureScheduleEditor — controlled UI for editing a CaptureHours value.
 *
 * Just the form: day-of-week toggles, time pickers, timezone select.
 * Persistence is the caller's job. Used in two places:
 *   - /settings/profile (business-level schedule)
 *   - /settings/team (per-employee override)
 *
 * Both surfaces want the same widget; only the load/save plumbing differs.
 */

import { ALL_DAYS, type CaptureDay, type CaptureHours } from '@/lib/capture-hours'
import TimezoneSelect from '@/components/ui/TimezoneSelect'

const DAY_LABELS: Record<CaptureDay, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

export function CaptureScheduleEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: CaptureHours
  onChange: (next: CaptureHours) => void
  disabled?: boolean
}) {
  function toggleDay(day: CaptureDay) {
    const has = value.days.includes(day)
    const next = has ? value.days.filter((d) => d !== day) : [...value.days, day]
    // Canonical week order so the stored shape is stable.
    const sorted = ALL_DAYS.filter((d) => next.includes(d))
    onChange({ ...value, days: sorted })
  }

  return (
    <div className={disabled ? 'opacity-50 pointer-events-none' : ''}>
      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
          Days
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_DAYS.map((d) => {
            const on = value.days.includes(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                disabled={disabled}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  on
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                {DAY_LABELS[d]}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
          Hours
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="time"
            value={value.start_time}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, start_time: e.target.value })}
            className="px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white w-32"
          />
          <span className="text-xs text-gray-500">to</span>
          <input
            type="time"
            value={value.end_time}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, end_time: e.target.value })}
            className="px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white w-32"
          />
          <span className="text-xs text-gray-500">in</span>
          <TimezoneSelect
            value={value.timezone}
            onChange={(tz) => onChange({ ...value, timezone: tz })}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  )
}

// ----- Human-readable summary (used in row chips/labels) -------------------

const DAY_GROUPS: { match: CaptureDay[]; label: string }[] = [
  { match: ['mon', 'tue', 'wed', 'thu', 'fri'], label: 'Mon-Fri' },
  { match: ['sat', 'sun'], label: 'Sat-Sun' },
  { match: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], label: 'Every day' },
]

/** Compact, human-readable summary of a schedule. Used to show what's
 *  active without unfolding the editor — e.g. "Mon-Fri, 8:00 AM – 6:00 PM". */
export function summarizeCaptureHours(h: CaptureHours): string {
  if (h.days.length === 0) return 'No capture days set'
  const sorted = ALL_DAYS.filter((d) => h.days.includes(d))
  let daysLabel = ''
  for (const group of DAY_GROUPS) {
    if (sorted.length === group.match.length && group.match.every((d) => sorted.includes(d))) {
      daysLabel = group.label
      break
    }
  }
  if (!daysLabel) daysLabel = sorted.map((d) => DAY_LABELS[d]).join(', ')
  return `${daysLabel}, ${formatTime12(h.start_time)} – ${formatTime12(h.end_time)}`
}

function formatTime12(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
}
