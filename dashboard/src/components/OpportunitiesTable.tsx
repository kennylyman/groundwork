'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Zap,
  DollarSign,
  TrendingUp,
  ArrowUpDown,
  Filter,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  Repeat,
  Users,
} from 'lucide-react'
import { supabase, Employee } from '@/lib/supabase'

type CapabilityPattern = {
  capability_id?: string
  key_params?: Record<string, string>
  integration_evidence?: {
    verified_via_zapier?: boolean
    total_events?: number
    tools?: Array<{ tool: string; event_count: number }>
  }
  cadence?: 'weekly' | 'biweekly' | 'monthly'
  cadence_avg_days?: number
}

type DetectionTrack = 'high_frequency' | 'recurring'

type OpportunityRow = {
  id: string
  business_id: string
  employee_id: string
  title: string
  description: string | null
  occurrence_count: number
  estimated_weekly_minutes: number
  estimated_annual_cost: number
  estimated_annual_savings: number
  confidence: number
  status: string
  automation_class: 'A' | 'B' | 'C' | null
  capability_pattern: CapabilityPattern | null
  first_detected_at: string
  last_seen_at: string
  detection_track: DetectionTrack | null
  estimated_cadence: 'weekly' | 'biweekly' | 'monthly' | null
  cross_employee_count: number | null
}

const CADENCE_LABEL: Record<'weekly' | 'biweekly' | 'monthly', string> = {
  weekly: 'Appears weekly',
  biweekly: 'Appears biweekly',
  monthly: 'Appears monthly',
}

type SortKey = 'savings' | 'occurrence' | 'confidence' | 'recent'
type TrackFilter = 'all' | 'high_frequency' | 'recurring'

const STATUS_TONE: Record<string, string> = {
  new: 'bg-amber-50 text-amber-700 border-amber-100',
  reviewed: 'bg-blue-50 text-blue-700 border-blue-100',
  approved: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  built: 'bg-purple-50 text-purple-700 border-purple-100',
  tested: 'bg-purple-50 text-purple-700 border-purple-100',
  deployed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  running: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  paused: 'bg-gray-50 text-gray-600 border-gray-200',
  retired: 'bg-gray-50 text-gray-500 border-gray-200',
  dismissed: 'bg-gray-50 text-gray-500 border-gray-200',
}

const CLASS_LABEL: Record<string, string> = {
  A: 'Zapier-able',
  B: 'Composed agent',
  C: 'Custom build',
}

function fmtMoney(n: number) {
  return '$' + n.toLocaleString('en-US')
}

export function OpportunitiesTable() {
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([])
  const [employees, setEmployees] = useState<Record<string, Employee>>({})
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('savings')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [trackFilter, setTrackFilter] = useState<TrackFilter>('all')

  useEffect(() => {
    void loadAll()
  }, [])

  async function loadAll() {
    const [oppsRes, empsRes] = await Promise.all([
      supabase
        .from('opportunities')
        .select('*')
        .order('estimated_annual_savings', { ascending: false })
        .limit(50),
      supabase.from('employees').select('id, name, role').eq('is_active', true),
    ])
    setOpportunities((oppsRes.data as OpportunityRow[]) ?? [])
    const empMap: Record<string, Employee> = {}
    for (const e of (empsRes.data ?? []) as Employee[]) empMap[e.id] = e
    setEmployees(empMap)
    setLoading(false)
  }

  const recurringCount = useMemo(
    () => opportunities.filter((o) => o.detection_track === 'recurring').length,
    [opportunities]
  )

  const sorted = useMemo(() => {
    const filtered = opportunities
      .filter((o) => statusFilter === 'all' || o.status === statusFilter)
      .filter((o) => {
        if (trackFilter === 'all') return true
        // Legacy rows pre-0023 default to 'high_frequency' via the DB
        // default, so a null detection_track still groups as high_freq.
        const track = o.detection_track ?? 'high_frequency'
        return track === trackFilter
      })
    const arr = [...filtered]
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'savings':
          return b.estimated_annual_savings - a.estimated_annual_savings
        case 'occurrence':
          return b.occurrence_count - a.occurrence_count
        case 'confidence':
          return b.confidence - a.confidence
        case 'recent':
          return (
            new Date(b.last_seen_at).getTime() -
            new Date(a.last_seen_at).getTime()
          )
      }
    })
    return arr
  }, [opportunities, sortKey, statusFilter])

  const totalSavings = useMemo(
    () => opportunities.reduce((s, o) => s + o.estimated_annual_savings, 0),
    [opportunities]
  )

  const statusOptions = useMemo(() => {
    const set = new Set<string>(['all'])
    opportunities.forEach((o) => set.add(o.status))
    return Array.from(set)
  }, [opportunities])

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Automation opportunities
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {opportunities.length > 0 ? (
                <>
                  {opportunities.length} detected ·{' '}
                  <span className="font-medium text-gray-700">
                    {fmtMoney(totalSavings)}
                  </span>{' '}
                  potential annual savings
                </>
              ) : (
                'Detected patterns will appear here'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Track filter — lets owners look only at high-frequency
              automations vs only at recurring business processes. */}
          <div className="flex items-center gap-1.5 text-xs">
            <Repeat className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={trackFilter}
              onChange={(e) => setTrackFilter(e.target.value as TrackFilter)}
              className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-medium text-gray-700 focus:outline-none focus:border-gray-400"
              title="Filter by detection track"
            >
              <option value="all">All patterns</option>
              <option value="high_frequency">High frequency</option>
              <option value="recurring">
                Recurring workflows{recurringCount > 0 ? ` (${recurringCount})` : ''}
              </option>
            </select>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <Filter className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-medium text-gray-700 focus:outline-none focus:border-gray-400"
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All statuses' : s}
                </option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1.5 text-xs">
            <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-xs font-medium text-gray-700 focus:outline-none focus:border-gray-400"
            >
              <option value="savings">Highest savings</option>
              <option value="occurrence">Most frequent</option>
              <option value="confidence">Highest confidence</option>
              <option value="recent">Most recent</option>
            </select>
          </div>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="px-6 py-10 text-center">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin mx-auto" />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          filtered={statusFilter !== 'all' || trackFilter !== 'all'}
          trackFilter={trackFilter}
        />
      ) : (
        <div className="divide-y divide-gray-50">
          {sorted.map((opp) => (
            <OpportunityRowView
              key={opp.id}
              opp={opp}
              employee={employees[opp.employee_id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function OpportunityRowView({
  opp,
  employee,
}: {
  opp: OpportunityRow
  employee?: Employee
}) {
  const statusTone = STATUS_TONE[opp.status] || STATUS_TONE.new
  const confidencePct = Math.round(opp.confidence * 100)
  const automation = opp.automation_class
    ? CLASS_LABEL[opp.automation_class]
    : null
  const verifiedViaZapier =
    !!opp.capability_pattern?.integration_evidence?.verified_via_zapier
  const eventCount = opp.capability_pattern?.integration_evidence?.total_events ?? 0
  const isRecurring = opp.detection_track === 'recurring'
  const cadence = opp.estimated_cadence ?? opp.capability_pattern?.cadence ?? null
  const crossEmployee = opp.cross_employee_count ?? 1

  return (
    <Link
      href={employee ? `/employee/${opp.employee_id}` : '#'}
      className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors group"
    >
      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{opp.title}</p>
          <span
            className={`shrink-0 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border ${statusTone}`}
          >
            {opp.status}
          </span>
          {isRecurring && (
            <span
              title="Recurring workflow — a periodic business process detected across multiple cycles"
              className="shrink-0 inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200"
            >
              <Repeat className="w-2.5 h-2.5" />
              Recurring
            </span>
          )}
          {crossEmployee > 1 && (
            <span
              title={`This pattern was detected for ${crossEmployee} employees in this business — much stronger signal than a single-person habit`}
              className="shrink-0 inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border bg-purple-50 text-purple-700 border-purple-200"
            >
              <Users className="w-2.5 h-2.5" />
              {crossEmployee} people
            </span>
          )}
          {verifiedViaZapier && (
            <span
              title={`Confirmed by ${eventCount} Zapier event${eventCount === 1 ? '' : 's'}`}
              className="shrink-0 inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200"
            >
              <CheckCircle2 className="w-2.5 h-2.5" />
              Verified
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
          {employee && (
            <>
              <span className="text-gray-700 font-medium">{employee.name}</span>
              <span className="text-gray-300">·</span>
            </>
          )}
          {isRecurring && cadence ? (
            <span className="text-indigo-700 font-medium">{CADENCE_LABEL[cadence]}</span>
          ) : (
            <span>{opp.occurrence_count}× observed</span>
          )}
          <span className="text-gray-300">·</span>
          <span>{opp.estimated_weekly_minutes} min/wk avg</span>
          {automation && (
            <>
              <span className="text-gray-300">·</span>
              <span className="text-gray-500">{automation}</span>
            </>
          )}
        </div>
      </div>

      {/* Confidence */}
      <div className="w-20 text-center hidden sm:block">
        <p className="text-xs font-medium text-gray-700">{confidencePct}%</p>
        <p className="text-[10px] text-gray-400 uppercase tracking-wider">confidence</p>
      </div>

      {/* Savings */}
      <div className="w-32 text-right">
        <p className="text-sm font-semibold text-gray-900">
          {fmtMoney(opp.estimated_annual_savings)}
        </p>
        <p className="text-[10px] text-gray-400 uppercase tracking-wider">
          potential / yr
        </p>
      </div>

      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors shrink-0" />
    </Link>
  )
}

function EmptyState({
  filtered,
  trackFilter,
}: {
  filtered: boolean
  trackFilter: TrackFilter
}) {
  // Dedicated Track-2 empty state spelling out the "you'll see these
  // after the first cycle" expectation. Owners new to the dashboard
  // shouldn't wonder why "recurring" is empty when they've only had
  // the agent installed for 3 hours.
  if (trackFilter === 'recurring') {
    return (
      <div className="px-6 py-12 text-center">
        <div className="relative inline-block mb-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-50 via-violet-50 to-purple-50 flex items-center justify-center">
            <Repeat className="w-6 h-6 text-indigo-500" />
          </div>
        </div>
        <p className="text-sm font-medium text-gray-900 mb-1">
          No recurring workflows detected yet
        </p>
        <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
          Recurring workflow opportunities appear after patterns are observed
          across multiple cycles. Check back after your first billing or
          payroll run.
        </p>
      </div>
    )
  }
  if (trackFilter === 'high_frequency') {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm text-gray-500">
          No high-frequency patterns yet. They show up after the agent has
          captured a few days of repeated daily tasks.
        </p>
      </div>
    )
  }
  if (filtered) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm text-gray-500">No opportunities match this filter</p>
      </div>
    )
  }
  return (
    <div className="px-6 py-12 text-center">
      <div className="relative inline-block mb-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-50 via-orange-50 to-pink-50 flex items-center justify-center">
          <Zap className="w-6 h-6 text-amber-500" />
        </div>
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white shadow-sm flex items-center justify-center border border-amber-100">
          <Sparkles className="w-2.5 h-2.5 text-amber-500" />
        </div>
      </div>
      <p className="text-sm font-medium text-gray-900 mb-1">No opportunities yet</p>
      <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
        Detection runs daily and surfaces two kinds of patterns: high-frequency
        repetition (daily / multiple times per week) and recurring business
        processes (billing, payroll, reporting on a weekly–monthly cadence).
      </p>
    </div>
  )
}
