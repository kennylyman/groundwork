'use client'

/**
 * WorkflowHandoffsPanel + CriticalHandoffBanner — two surfaces for
 * cross-employee handoff data.
 *
 *   <CriticalHandoffBanner />   shows only if there's at least one
 *                               CRITICAL bottleneck (avg gap > 240 min,
 *                               occ >= 3). Renders ABOVE the opportunity
 *                               panel per spec — these are the highest
 *                               -value automation targets. Displays
 *                               estimated annual cost of the delay.
 *
 *   <WorkflowHandoffsPanel />   the full list, normal placement under
 *                               the workflow sequences panel. Standard
 *                               handoffs render gray; bottlenecks
 *                               highlighted in amber; critical in red.
 *
 * Both components hit the same /api/handoffs endpoint and share the
 * shape definition + cost-estimation helper.
 */

import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Clock,
  Users,
  AlertTriangle,
  Loader2,
  Repeat,
} from 'lucide-react'

type EmployeeStub = {
  id: string
  name: string
  role: string | null
}

export type HandoffRow = {
  id: string
  business_id: string
  from_employee_id: string
  to_employee_id: string
  handoff_at: string
  gap_minutes: number
  avg_gap_minutes: number
  from_tool: string | null
  to_tool: string | null
  from_category: string | null
  to_category: string | null
  task_context: string | null
  occurrence_count: number
  confidence_score: number
  is_bottleneck: boolean
  from_employee: EmployeeStub | null
  to_employee: EmployeeStub | null
}

// Threshold mirrors lib/handoffs.ts so dashboards can apply the
// "critical" tier client-side without an extra DB column.
const CRITICAL_BOTTLENECK_GAP_MINUTES = 240
// Default fallback hourly rate when we can't resolve a per-role rate.
// Matches DEFAULT_HOURLY_RATE in lib/rates.ts.
const FALLBACK_HOURLY_RATE = 35

function isCritical(h: HandoffRow): boolean {
  return h.is_bottleneck && h.avg_gap_minutes > CRITICAL_BOTTLENECK_GAP_MINUTES
}

/**
 * Annualize occurrence count from the detection window (30 days) and
 * multiply by the per-occurrence delay cost. The hourly rate is the
 * fallback today; a future pass should resolve per-role rates from
 * business_profiles.role_hourly_rates via /api/settings/rates.
 */
function estimatedAnnualDelayCost(h: HandoffRow): number {
  const annualOccurrences = h.occurrence_count * (365 / 30)
  const hoursPerOccurrence = h.avg_gap_minutes / 60
  return Math.round(annualOccurrences * hoursPerOccurrence * FALLBACK_HOURLY_RATE)
}

function fmtMoney(n: number) {
  return '$' + n.toLocaleString('en-US')
}

function fmtDuration(minutes: number): string {
  if (minutes < 1) return '< 1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(1)} hr`
  return `${(hours / 24).toFixed(1)} days`
}

// =============================================================================
// Data hook
// =============================================================================

function useHandoffs() {
  const [rows, setRows] = useState<HandoffRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch('/api/handoffs', { cache: 'no-store' })
        const body = await r.json()
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
        if (cancelled) return
        setRows((body.handoffs as HandoffRow[]) ?? [])
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { rows, loading, error }
}

// =============================================================================
// CriticalHandoffBanner — surfaces above the opportunities panel
// =============================================================================

export function CriticalHandoffBanner() {
  const { rows } = useHandoffs()
  const critical = rows.filter(isCritical).slice(0, 3)
  if (critical.length === 0) return null

  return (
    <div className="bg-gradient-to-br from-red-50 via-rose-50 to-orange-50 border border-red-200 rounded-2xl p-5 mb-8">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-red-100 text-red-700 flex items-center justify-center">
          <AlertTriangle className="w-3.5 h-3.5" />
        </div>
        <h2 className="text-sm font-semibold text-gray-900">
          Critical handoff bottlenecks
        </h2>
        <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border bg-red-100 text-red-700 border-red-200">
          {critical.length}
        </span>
      </div>
      <p className="text-xs text-gray-700 mb-4 leading-relaxed">
        Work is sitting more than 4 hours between team members on these flows.
        These are your highest-value automation targets.
      </p>
      <div className="space-y-2">
        {critical.map((h) => (
          <div
            key={h.id}
            className="flex items-center gap-3 bg-white/70 backdrop-blur border border-red-100 rounded-xl px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">
                <span>{h.from_employee?.name ?? 'Unknown'}</span>
                <ArrowRight className="inline w-3.5 h-3.5 mx-1.5 text-red-500" />
                <span>{h.to_employee?.name ?? 'Unknown'}</span>
                <span className="text-xs text-gray-500 font-normal ml-2">
                  · {h.task_context || 'handoff'}
                </span>
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {h.from_tool || 'Unknown'} → {h.to_tool || 'Unknown'} ·{' '}
                {h.occurrence_count}× observed · avg {fmtDuration(h.avg_gap_minutes)} delay
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-red-700">
                {fmtMoney(estimatedAnnualDelayCost(h))}
              </p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                delay cost / yr
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// WorkflowHandoffsPanel — full list
// =============================================================================

export function WorkflowHandoffsPanel() {
  const { rows, loading, error } = useHandoffs()

  // Bottlenecks come first in the API response; the additional client-
  // side sort keeps things stable if a row was inserted out of order.
  const sorted = [...rows].sort((a, b) => {
    if (a.is_bottleneck !== b.is_bottleneck) return a.is_bottleneck ? -1 : 1
    if (b.avg_gap_minutes !== a.avg_gap_minutes)
      return b.avg_gap_minutes - a.avg_gap_minutes
    return b.occurrence_count - a.occurrence_count
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
          <Users className="w-3.5 h-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Workflow handoffs
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Cross-employee work transitions — bottlenecks here are typically
            the highest-value automation targets.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="px-6 py-10 text-center">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
        </div>
      ) : error ? (
        <div className="px-6 py-8 text-center text-sm text-red-700">{error}</div>
      ) : sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="divide-y divide-gray-50">
          {sorted.map((h) => (
            <HandoffCard key={h.id} handoff={h} />
          ))}
        </div>
      )}
    </div>
  )
}

function HandoffCard({ handoff: h }: { handoff: HandoffRow }) {
  const critical = isCritical(h)
  const containerTone = critical
    ? 'bg-red-50/40'
    : h.is_bottleneck
    ? 'bg-amber-50/30'
    : ''
  return (
    <div className={`px-6 py-4 ${containerTone}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="text-sm font-medium text-gray-900">
              <span>{h.from_employee?.name ?? 'Unknown'}</span>
              <ArrowRight className="inline w-3.5 h-3.5 mx-1.5 text-gray-400" />
              <span>{h.to_employee?.name ?? 'Unknown'}</span>
            </p>
            {h.task_context && (
              <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200">
                {h.task_context}
              </span>
            )}
            {critical ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border bg-red-100 text-red-800 border-red-200">
                <AlertTriangle className="w-2.5 h-2.5" />
                Critical bottleneck
              </span>
            ) : h.is_bottleneck ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border bg-amber-100 text-amber-800 border-amber-200">
                <AlertTriangle className="w-2.5 h-2.5" />
                Bottleneck
              </span>
            ) : null}
          </div>
          <p className="text-xs text-gray-600">
            <span className="font-medium text-gray-800">
              {h.from_tool || 'Unknown'}
            </span>
            <ArrowRight className="inline w-3 h-3 mx-1 text-gray-400" />
            <span className="font-medium text-gray-800">
              {h.to_tool || 'Unknown'}
            </span>
          </p>
          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Repeat className="w-3 h-3 text-gray-400" />
              {h.occurrence_count}× observed
            </span>
            <span className="text-gray-300">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3 text-gray-400" />
              avg {fmtDuration(h.avg_gap_minutes)} gap
            </span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-500">
              {Math.round(h.confidence_score * 100)}% confidence
            </span>
          </div>
        </div>
        {h.is_bottleneck && (
          <div className="text-right shrink-0">
            <p
              className={`text-sm font-semibold ${
                critical ? 'text-red-700' : 'text-amber-700'
              }`}
            >
              {fmtDuration(h.avg_gap_minutes)}
            </p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">
              avg delay
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="px-6 py-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-50 via-violet-50 to-purple-50 flex items-center justify-center mx-auto mb-4">
        <Users className="w-6 h-6 text-indigo-500" />
      </div>
      <p className="text-sm font-medium text-gray-900 mb-1">
        No handoff patterns yet
      </p>
      <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
        Handoff patterns appear after multiple team members have been
        active for several days. The engine looks for directional work
        transitions — one person ending on a task that another picks up
        within hours.
      </p>
    </div>
  )
}
