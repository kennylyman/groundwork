'use client'

/**
 * TimezoneSelect — a searchable, grouped IANA timezone picker.
 *
 * Why custom: the native <select> renders 400+ raw IANA strings in alphabetical
 * order ("Africa/Abidjan" first, "Pacific/Wallis" last), with no offsets and no
 * search. For an international workforce that's unusable. We render a popover
 * with a search box, region-grouped options, and live DST-aware UTC offsets
 * derived via the Intl API.
 *
 * The stored value is unchanged — the consumer still sees a raw IANA string
 * like "Asia/Manila". Only the display changes.
 *
 * No new dependencies: built on React + the platform's Intl API + lucide-react
 * icons that the dashboard already uses.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, Check } from 'lucide-react'

interface TimezoneSelectProps {
  value: string
  onChange: (iana: string) => void
  className?: string
  disabled?: boolean
}

type TimezoneOption = {
  iana: string
  label: string
  region: string
  offset: string        // display, e.g. "UTC−7" / "UTC+5:30" / "UTC±0"
  offsetMinutes: number // signed minutes from UTC, e.g. -420
}

export default function TimezoneSelect({
  value,
  onChange,
  className,
  disabled,
}: TimezoneSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Build the option list once. Offsets are DST-aware via the Intl runtime,
  // so they reflect *current* offset. If we ever need to display a future
  // schedule we'd recompute against the target date instead of `new Date()`.
  const allOptions = useMemo<TimezoneOption[]>(() => buildOptions(value), [value])

  const grouped = useMemo(() => {
    const filtered = filterOptions(allOptions, query)
    return groupAndSortByRegion(filtered)
  }, [allOptions, query])

  // Autofocus the search input when the popover opens.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [open])

  // Click outside → close.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Escape → close. Also resets the query so the next open starts clean.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const currentOption = allOptions.find((o) => o.iana === value)
  const displayLabel = currentOption
    ? `${currentOption.label} (${currentOption.offset})`
    : value || 'Select timezone'

  function pick(iana: string) {
    onChange(iana)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full min-w-[20rem] flex items-center justify-between gap-2 px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate text-left">{displayLabel}</span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-20 mt-1 w-full min-w-[20rem] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
        >
          <div className="border-b border-gray-100 p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search city, region, or UTC offset (e.g. +8)"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {grouped.length === 0 ? (
              <p className="px-3 py-6 text-xs text-gray-400 text-center">
                No timezones match &ldquo;{query}&rdquo;.
              </p>
            ) : (
              grouped.map(({ region, options }) => (
                <div key={region}>
                  <div className="sticky top-0 bg-gray-50 px-3 py-1 text-[10px] uppercase tracking-wider font-semibold text-gray-500 border-b border-gray-100">
                    {region}
                  </div>
                  {options.map((opt) => {
                    const selected = opt.iana === value
                    return (
                      <button
                        key={opt.iana}
                        type="button"
                        onClick={() => pick(opt.iana)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left hover:bg-gray-50 ${
                          selected ? 'bg-gray-50' : ''
                        }`}
                      >
                        <span className="truncate text-gray-900">{opt.label}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-gray-500 tabular-nums">
                            {opt.offset}
                          </span>
                          {selected && <Check className="w-3.5 h-3.5 text-gray-900" />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- option building ----------

function buildOptions(currentValue: string): TimezoneOption[] {
  const all = listAllZones()
  // The saved value might be an obscure zone the runtime doesn't enumerate
  // (e.g. legacy aliases like Asia/Calcutta). Make sure it's always in the list
  // so the user doesn't see their config silently swapped to a default.
  if (currentValue && !all.includes(currentValue)) all.unshift(currentValue)

  const out: TimezoneOption[] = []
  for (const iana of all) {
    const offsetMin = offsetMinutes(iana)
    if (offsetMin === null) continue // skip zones the runtime can't resolve
    out.push({
      iana,
      label: friendlyLabel(iana),
      region: regionFor(iana),
      offset: formatOffset(offsetMin),
      offsetMinutes: offsetMin,
    })
  }
  return out
}

function listAllZones(): string[] {
  type IntlExt = { supportedValuesOf?: (key: 'timeZone') => string[] }
  const intlExt = Intl as unknown as IntlExt
  if (typeof intlExt.supportedValuesOf === 'function') {
    try {
      const all = intlExt.supportedValuesOf('timeZone')
      if (Array.isArray(all) && all.length > 0) return [...all]
    } catch {
      // fall through to the curated fallback
    }
  }
  // Older runtimes: fall back to the keys of our friendly-name map. This is
  // small (~90 zones) but covers every market we'd reasonably onboard.
  return Object.keys(FRIENDLY_NAMES)
}

// ---------- display names ----------

/**
 * Curated display labels for the ~90 most common business timezones.
 *
 * Format:
 *   - US zones use the well-known region name + city (e.g. "Pacific Time —
 *     Los Angeles") so admins can scan by familiar US-business shorthand.
 *   - International zones use the city name, with country/aliases appended
 *     when useful for disambiguation (e.g. "Beijing · Shanghai").
 *
 * Anything not in this map falls back to the last IANA segment with spaces.
 */
const FRIENDLY_NAMES: Record<string, string> = {
  // ===== Americas — US =====
  'America/Los_Angeles': 'Pacific Time — Los Angeles',
  'America/Anchorage': 'Alaska Time — Anchorage',
  'America/Adak': 'Hawaii–Aleutian Time — Adak',
  'America/Denver': 'Mountain Time — Denver',
  'America/Boise': 'Mountain Time — Boise',
  'America/Phoenix': 'Mountain Time (no DST) — Phoenix',
  'America/Chicago': 'Central Time — Chicago',
  'America/New_York': 'Eastern Time — New York',
  'America/Detroit': 'Eastern Time — Detroit',
  'America/Indiana/Indianapolis': 'Eastern Time — Indianapolis',
  'America/Indianapolis': 'Eastern Time — Indianapolis',
  'America/Kentucky/Louisville': 'Eastern Time — Louisville',
  'Pacific/Honolulu': 'Hawaii Time — Honolulu',

  // ===== Americas — Canada =====
  'America/Vancouver': 'Pacific Time — Vancouver',
  'America/Edmonton': 'Mountain Time — Edmonton',
  'America/Winnipeg': 'Central Time — Winnipeg',
  'America/Toronto': 'Eastern Time — Toronto',
  'America/Halifax': 'Atlantic Time — Halifax',
  'America/St_Johns': "Newfoundland Time — St. John's",

  // ===== Americas — Mexico / Caribbean =====
  'America/Tijuana': 'Pacific Time — Tijuana',
  'America/Hermosillo': 'Mountain Time (no DST) — Hermosillo',
  'America/Mexico_City': 'Central Time — Mexico City',
  'America/Monterrey': 'Central Time — Monterrey',
  'America/Cancun': 'Eastern Time — Cancún',
  'America/Havana': 'Havana',
  'America/Santo_Domingo': 'Santo Domingo',
  'America/Puerto_Rico': 'San Juan',
  'America/Jamaica': 'Kingston',

  // ===== Americas — Central / South =====
  'America/Guatemala': 'Guatemala City',
  'America/Costa_Rica': 'San José',
  'America/Panama': 'Panama City',
  'America/Bogota': 'Bogotá',
  'America/Lima': 'Lima',
  'America/Caracas': 'Caracas',
  'America/La_Paz': 'La Paz',
  'America/Santiago': 'Santiago',
  'America/Buenos_Aires': 'Buenos Aires',
  'America/Argentina/Buenos_Aires': 'Buenos Aires',
  'America/Sao_Paulo': 'São Paulo',
  'America/Montevideo': 'Montevideo',
  'America/Asuncion': 'Asunción',

  // ===== Europe =====
  'Europe/London': 'London',
  'Europe/Dublin': 'Dublin',
  'Europe/Lisbon': 'Lisbon',
  'Europe/Madrid': 'Madrid',
  'Europe/Paris': 'Paris',
  'Europe/Brussels': 'Brussels',
  'Europe/Amsterdam': 'Amsterdam',
  'Europe/Luxembourg': 'Luxembourg',
  'Europe/Zurich': 'Zürich',
  'Europe/Berlin': 'Berlin',
  'Europe/Vienna': 'Vienna',
  'Europe/Prague': 'Prague',
  'Europe/Rome': 'Rome',
  'Europe/Athens': 'Athens',
  'Europe/Helsinki': 'Helsinki',
  'Europe/Stockholm': 'Stockholm',
  'Europe/Oslo': 'Oslo',
  'Europe/Copenhagen': 'Copenhagen',
  'Europe/Warsaw': 'Warsaw',
  'Europe/Budapest': 'Budapest',
  'Europe/Bucharest': 'Bucharest',
  'Europe/Sofia': 'Sofia',
  'Europe/Belgrade': 'Belgrade',
  'Europe/Moscow': 'Moscow',
  'Europe/Istanbul': 'Istanbul',
  'Europe/Kyiv': 'Kyiv',
  'Europe/Kiev': 'Kyiv',

  // ===== Africa =====
  'Africa/Cairo': 'Cairo',
  'Africa/Lagos': 'Lagos',
  'Africa/Johannesburg': 'Johannesburg',
  'Africa/Nairobi': 'Nairobi',
  'Africa/Casablanca': 'Casablanca',
  'Africa/Algiers': 'Algiers',
  'Africa/Tunis': 'Tunis',
  'Africa/Accra': 'Accra',
  'Africa/Addis_Ababa': 'Addis Ababa',

  // ===== Asia — Middle East =====
  'Asia/Jerusalem': 'Jerusalem',
  'Asia/Beirut': 'Beirut',
  'Asia/Damascus': 'Damascus',
  'Asia/Baghdad': 'Baghdad',
  'Asia/Riyadh': 'Riyadh',
  'Asia/Qatar': 'Doha',
  'Asia/Dubai': 'Dubai',
  'Asia/Tehran': 'Tehran',

  // ===== Asia — South / Central =====
  'Asia/Kabul': 'Kabul',
  'Asia/Karachi': 'Karachi',
  'Asia/Tashkent': 'Tashkent',
  'Asia/Almaty': 'Almaty',
  'Asia/Kolkata': 'Mumbai · Delhi · Kolkata',
  'Asia/Calcutta': 'Mumbai · Delhi · Kolkata',
  'Asia/Colombo': 'Colombo',
  'Asia/Kathmandu': 'Kathmandu',
  'Asia/Dhaka': 'Dhaka',

  // ===== Asia — Southeast =====
  'Asia/Yangon': 'Yangon',
  'Asia/Bangkok': 'Bangkok',
  'Asia/Ho_Chi_Minh': 'Ho Chi Minh City',
  'Asia/Jakarta': 'Jakarta',
  'Asia/Singapore': 'Singapore',
  'Asia/Kuala_Lumpur': 'Kuala Lumpur',
  'Asia/Manila': 'Manila',

  // ===== Asia — East =====
  'Asia/Hong_Kong': 'Hong Kong',
  'Asia/Shanghai': 'Beijing · Shanghai',
  'Asia/Taipei': 'Taipei',
  'Asia/Seoul': 'Seoul',
  'Asia/Tokyo': 'Tokyo',

  // ===== Australia =====
  'Australia/Perth': 'Perth',
  'Australia/Adelaide': 'Adelaide',
  'Australia/Darwin': 'Darwin',
  'Australia/Brisbane': 'Brisbane',
  'Australia/Sydney': 'Sydney',
  'Australia/Melbourne': 'Melbourne',
  'Australia/Hobart': 'Hobart',

  // ===== Pacific =====
  'Pacific/Auckland': 'Auckland',
  'Pacific/Fiji': 'Fiji',
  'Pacific/Guam': 'Guam',
  'Pacific/Apia': 'Apia',
  'Pacific/Pago_Pago': 'Pago Pago',
  'Pacific/Tahiti': 'Tahiti',

  // ===== Atlantic =====
  'Atlantic/Azores': 'Azores',
  'Atlantic/Reykjavik': 'Reykjavík',
  'Atlantic/Cape_Verde': 'Cape Verde',
  'Atlantic/Bermuda': 'Bermuda',

  // ===== Indian Ocean =====
  'Indian/Maldives': 'Maldives',
  'Indian/Mauritius': 'Mauritius',
  'Indian/Reunion': 'Réunion',

  // ===== UTC =====
  UTC: 'Coordinated Universal Time',
}

function friendlyLabel(iana: string): string {
  const explicit = FRIENDLY_NAMES[iana]
  if (explicit) return explicit
  // Generic fallback: take the final segment, swap underscores for spaces.
  // Multi-segment zones like "America/Indiana/Vincennes" become "Vincennes",
  // which is the most useful for searching by city.
  const last = iana.split('/').pop() ?? iana
  return last.replace(/_/g, ' ')
}

// ---------- region grouping ----------

function regionFor(iana: string): string {
  if (iana === 'UTC' || iana === 'GMT' || iana.startsWith('Etc/')) return 'UTC'
  const prefix = iana.split('/')[0]
  switch (prefix) {
    case 'America':
      return 'Americas'
    case 'Europe':
      return 'Europe'
    case 'Africa':
      return 'Africa'
    case 'Asia':
      return 'Asia'
    case 'Australia':
    case 'Pacific':
      return 'Pacific'
    case 'Atlantic':
      return 'Atlantic'
    case 'Indian':
      return 'Indian Ocean'
    case 'Antarctica':
      return 'Antarctica'
    case 'Arctic':
      return 'Arctic'
    default:
      return 'Other'
  }
}

const REGION_ORDER = [
  'Americas',
  'Europe',
  'Africa',
  'Asia',
  'Pacific',
  'Atlantic',
  'Indian Ocean',
  'Arctic',
  'Antarctica',
  'UTC',
  'Other',
]

function groupAndSortByRegion(
  options: TimezoneOption[]
): { region: string; options: TimezoneOption[] }[] {
  const byRegion = new Map<string, TimezoneOption[]>()
  for (const opt of options) {
    if (!byRegion.has(opt.region)) byRegion.set(opt.region, [])
    byRegion.get(opt.region)!.push(opt)
  }
  // Within each region, alphabetical by label.
  for (const list of byRegion.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label))
  }
  const out: { region: string; options: TimezoneOption[] }[] = []
  for (const region of REGION_ORDER) {
    if (byRegion.has(region)) {
      out.push({ region, options: byRegion.get(region)! })
      byRegion.delete(region)
    }
  }
  // Any leftover regions (shouldn't happen, but defensive) get appended.
  for (const [region, opts] of byRegion) {
    out.push({ region, options: opts })
  }
  return out
}

// ---------- offset math ----------

/**
 * Compute current UTC offset (in minutes) for a zone. DST-aware because
 * Intl.DateTimeFormat evaluates against `new Date()`. Returns null if the
 * runtime can't resolve the zone — caller filters those out.
 */
function offsetMinutes(iana: string): number | null {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: iana,
      timeZoneName: 'shortOffset',
    })
    const parts = dtf.formatToParts(new Date())
    const tzPart = parts.find((p) => p.type === 'timeZoneName')
    if (!tzPart) return null
    const raw = tzPart.value
    if (raw === 'GMT' || raw === 'UTC') return 0
    // Examples seen across runtimes: "GMT-7", "GMT+5:30", "GMT+13", "GMT-3:30"
    const m = raw.match(/^GMT([+\-−])(\d{1,2})(?::?(\d{2}))?$/)
    if (!m) return 0
    const sign = m[1] === '+' ? 1 : -1
    const h = parseInt(m[2], 10)
    const mm = m[3] ? parseInt(m[3], 10) : 0
    return sign * (h * 60 + mm)
  } catch {
    return null
  }
}

function formatOffset(mins: number): string {
  if (mins === 0) return 'UTC±0'
  // Use U+2212 MINUS SIGN so it matches typographic conventions and lines up
  // visually with the + sign (− is the same width as +; ASCII '-' isn't).
  const sign = mins >= 0 ? '+' : '−'
  const abs = Math.abs(mins)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`
}

/**
 * Parse a UTC offset query like "+8", "UTC+8", "GMT-3:30", "−5".
 * Returns the offset in minutes, or null if not an offset query.
 */
function parseOffsetQuery(q: string): number | null {
  const m = q.trim().match(/^(?:utc|gmt)?\s*([+\-−])(\d{1,2})(?::?(\d{2}))?$/i)
  if (!m) return null
  const sign = m[1] === '+' ? 1 : -1
  const h = parseInt(m[2], 10)
  const mm = m[3] ? parseInt(m[3], 10) : 0
  if (h > 14 || mm > 59) return null
  return sign * (h * 60 + mm)
}

// ---------- search filter ----------

function filterOptions(all: TimezoneOption[], q: string): TimezoneOption[] {
  const trimmed = q.trim()
  if (!trimmed) return all

  // First-pass: if the query parses as a UTC offset, match exact offset minutes.
  // This lets "+8" surface every zone currently at UTC+8 across regions.
  const targetOffset = parseOffsetQuery(trimmed)
  if (targetOffset !== null) {
    return all.filter((o) => o.offsetMinutes === targetOffset)
  }

  // Otherwise: substring match across label, IANA, region, and formatted offset.
  // (Searching offset as text lets "UTC+8" still work even if the user typed
  // it without the bare-number short form.)
  const lc = trimmed.toLowerCase()
  return all.filter(
    (o) =>
      o.label.toLowerCase().includes(lc) ||
      o.iana.toLowerCase().includes(lc) ||
      o.region.toLowerCase().includes(lc) ||
      o.offset.toLowerCase().includes(lc)
  )
}
