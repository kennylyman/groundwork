'use client'

import { useEffect, useState } from 'react'
import { supabase, Employee, Capture } from '@/lib/supabase'
import { Activity, Users, Zap, TrendingUp, Clock, AlertCircle, FileText, Sparkles, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PauseToggle, PausedBadge } from '@/components/PauseToggle'
import { OpportunitiesTable } from '@/components/OpportunitiesTable'
import { WorkflowSequencesPanel } from '@/components/WorkflowSequencesPanel'
import {
  WorkflowHandoffsPanel,
  CriticalHandoffBanner,
} from '@/components/WorkflowHandoffsPanel'
import { ConnectionPrompts } from '@/components/ConnectionPrompts'
import { WorkflowIntelligenceMap } from '@/components/WorkflowIntelligenceMap'
import { SignOutButton } from '@/components/SignOutButton'
import {
  computeHeartbeatStatus,
  ageLabel,
  agentHealth,
  lastActive,
  type HeartbeatStatus,
  type AgentHealth,
  type LastActive,
} from '@/lib/agent-heartbeat'
import {
  DEFAULT_CAPTURE_HOURS,
  parseCaptureHours,
  type CaptureHours,
} from '@/lib/capture-hours'
import { AgentHealthChip, LastActiveChip } from '@/components/AgentStatusIndicators'

type EmployeeWithStatus = Employee & {
  latest_capture?: Capture
  today_captures: number
  high_automation_count: number
  status: 'active' | 'idle' | 'offline'
  has_unack_role_discovery: boolean
  heartbeat_status: HeartbeatStatus
  heartbeat_age: string
  /** Three-state agent process health — replaces the dot above for the
   *  new split-signal indicators. */
  agent_health: AgentHealth
  /** Latest captures.captured_at for this employee within the last 7 days;
   *  null when the employee has no captures in that window. Used to power
   *  the "Last active" chip. */
  last_capture_at: string | null
  /** Pre-computed "Last active" label + qualifier for rendering. */
  last_active: LastActive
}

const AUTOMATION_COLORS: Record<string, string> = {
  high: 'text-red-500 bg-red-50',
  medium: 'text-amber-500 bg-amber-50',
  low: 'text-blue-500 bg-blue-50',
  none: 'text-gray-400 bg-gray-50',
}

// STATUS_COLORS removed in the split-signal refactor — the colored dot
// on the avatar was a single 3-state (active/idle/offline) signal that
// conflated agent process state with employee activity. Replaced by the
// AgentHealthChip + LastActiveChip pair on the row. The `status` field
// on enriched employees is still computed and used by the activeNow
// stats counter below.

const CATEGORY_COLORS: Record<string, string> = {
  'Schedule Management': 'bg-blue-100 text-blue-700',
  'Billing and Invoicing': 'bg-green-100 text-green-700',
  'Caregiver HR and Onboarding': 'bg-purple-100 text-purple-700',
  'Client Intake and Care Planning': 'bg-pink-100 text-pink-700',
  'Authorization and Compliance': 'bg-orange-100 text-orange-700',
  'Family and Client Communication': 'bg-cyan-100 text-cyan-700',
  'Internal Communication': 'bg-indigo-100 text-indigo-700',
  'Payroll Processing': 'bg-teal-100 text-teal-700',
  'Reporting and Documentation': 'bg-yellow-100 text-yellow-700',
  'Problem Resolution': 'bg-red-100 text-red-700',
  'Meeting or Phone Call': 'bg-slate-100 text-slate-700',
  'Break or Idle': 'bg-gray-100 text-gray-500',
  'Unknown': 'bg-gray-100 text-gray-500',
}

export default function Dashboard() {
  const router = useRouter()
  const [employees, setEmployees] = useState<EmployeeWithStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [businessName, setBusinessName] = useState('Groundwork')
  const [stats, setStats] = useState({
    totalCaptures: 0,
    highAutomation: 0,
    activeNow: 0,
    avgConfidence: 0,
  })

  useEffect(() => {
    loadDashboard()
    const interval = setInterval(loadDashboard, 30000)
    return () => clearInterval(interval)
  }, [])

  async function loadDashboard() {
    try {
      const { data: businesses } = await supabase
        .from('businesses')
        .select('*')
        .limit(1)
        .single()

      if (businesses) setBusinessName(businesses.name)

      const { data: employeeList } = await supabase
        .from('employees')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (!employeeList) return

      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString()
      const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      // 7 days back is wide enough to surface "last active" for everyone
      // except actually-stale employees, and narrow enough to keep the
      // returned row count manageable. Beyond 7 days we render
      // "No activity yet" — the operator-actionable signal is the same.
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const employeeIds = employeeList.map((e) => e.id)

      // ----- Bulk reads, no N+1 ------------------------------------------
      // Before: 3 queries × N employees + 1 unack query = 3N+1 round trips.
      // After: bulk reads, regardless of team size. The added 7-day query
      // and business-hours fetch run in parallel with everything else.
      //
      // 1. Unacknowledged role discoveries.
      // 2. Most-recent capture (60 min, full payload) for the "current
      //    task" display.
      // 3. Today's captures (light columns) — counted client-side.
      // 4. NEW: captured_at over 7 days, employee_id-only, for the
      //    "Last active" chip on each row. Tiny row size keeps this cheap.
      // 5. NEW: business-hours config — needed so "30 min idle during
      //    business hours" vs "off-hours silence" reads correctly.

      const [
        { data: unackProfiles },
        { data: recentCaptures },
        { data: todaysCaptures },
        { data: weekCaptures },
        scheduleResp,
      ] = await Promise.all([
        supabase
          .from('employee_role_profiles')
          .select('employee_id')
          .in('employee_id', employeeIds)
          .is('acknowledged_at', null),
        supabase
          .from('captures')
          .select('*')
          .in('employee_id', employeeIds)
          .gte('captured_at', sixtyMinutesAgo)
          .order('captured_at', { ascending: false }),
        supabase
          .from('captures')
          .select('employee_id, automation_potential')
          .in('employee_id', employeeIds)
          .gte('captured_at', todayStart),
        supabase
          .from('captures')
          .select('employee_id, captured_at')
          .in('employee_id', employeeIds)
          .gte('captured_at', sevenDaysAgo)
          .order('captured_at', { ascending: false }),
        fetch('/api/settings/capture', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])

      // Resolve business-hours config from the API response, parsed
      // through the same helper the settings page uses so invalid /
      // missing fields fall through to defaults rather than breaking
      // the dashboard chips.
      const businessHours: CaptureHours = scheduleResp
        ? parseCaptureHours(scheduleResp)
        : DEFAULT_CAPTURE_HOURS

      // First hit per employee in the 7-day query = their most-recent
      // capture (the query is already ordered desc). Map remains tiny —
      // one timestamp per employee.
      const lastCaptureAtByEmployee = new Map<string, string>()
      for (const row of (weekCaptures ?? []) as Array<Pick<Capture, 'employee_id' | 'captured_at'>>) {
        if (!lastCaptureAtByEmployee.has(row.employee_id)) {
          lastCaptureAtByEmployee.set(row.employee_id, row.captured_at)
        }
      }

      const unackSet = new Set((unackProfiles ?? []).map((p) => p.employee_id))

      // Group recent captures by employee, keep only the freshest (the query
      // is already ordered desc, so first hit wins).
      const latestByEmployee = new Map<string, Capture>()
      for (const cap of (recentCaptures ?? []) as Capture[]) {
        if (!latestByEmployee.has(cap.employee_id)) {
          latestByEmployee.set(cap.employee_id, cap)
        }
      }

      // Count today's captures per employee in a single pass.
      const todayCountByEmployee = new Map<string, number>()
      const highAutoCountByEmployee = new Map<string, number>()
      for (const cap of (todaysCaptures ?? []) as Pick<
        Capture,
        'employee_id' | 'automation_potential'
      >[]) {
        todayCountByEmployee.set(
          cap.employee_id,
          (todayCountByEmployee.get(cap.employee_id) ?? 0) + 1
        )
        if (cap.automation_potential === 'high') {
          highAutoCountByEmployee.set(
            cap.employee_id,
            (highAutoCountByEmployee.get(cap.employee_id) ?? 0) + 1
          )
        }
      }

      const enriched: EmployeeWithStatus[] = employeeList.map((emp) => {
        const latest = latestByEmployee.get(emp.id)
        const last_capture_at =
          lastCaptureAtByEmployee.get(emp.id) ?? latest?.captured_at ?? null

        let status: 'active' | 'idle' | 'offline' = 'offline'
        if (latest) {
          const captureTime = new Date(latest.captured_at).toISOString()
          if (captureTime > fifteenMinutesAgo) status = 'active'
          else if (captureTime > sixtyMinutesAgo) status = 'idle'
        }
        // Legacy single-signal heartbeat (still used by the digest cron
        // and any callers we haven't migrated).
        const heartbeat_status = computeHeartbeatStatus({
          agent_version_updated_at: emp.agent_version_updated_at ?? null,
          last_capture_at: latest?.captured_at ?? null,
        })
        const heartbeat_age = ageLabel({
          agent_version_updated_at: emp.agent_version_updated_at ?? null,
          last_capture_at: latest?.captured_at ?? null,
        })

        // New split-signal indicators — primary status display on this
        // page. agent_health uses only the heartbeat (not captures), so
        // an employee at lunch with a healthy agent reads "Active" here
        // while last_active reads "30 min ago" — exactly the
        // disambiguation the legacy single badge couldn't express.
        const agent_health = agentHealth(emp, now)
        const last_active = lastActive(
          {
            last_capture_at,
            agent_health,
            business_hours: businessHours,
          },
          now
        )

        return {
          ...emp,
          latest_capture: latest,
          today_captures: todayCountByEmployee.get(emp.id) ?? 0,
          high_automation_count: highAutoCountByEmployee.get(emp.id) ?? 0,
          has_unack_role_discovery: unackSet.has(emp.id),
          status,
          heartbeat_status,
          heartbeat_age,
          agent_health,
          last_capture_at,
          last_active,
        }
      })

      setEmployees(enriched)

      const activeNow = enriched.filter(e => e.status === 'active').length
      const totalCaptures = enriched.reduce((sum, e) => sum + e.today_captures, 0)
      const highAuto = enriched.reduce((sum, e) => sum + e.high_automation_count, 0)

      setStats({
        totalCaptures,
        highAutomation: highAuto,
        activeNow,
        avgConfidence: 88,
      })

    } catch (err) {
      console.error('Dashboard load error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading Groundwork...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-gray-900">Groundwork</h1>
              <p className="text-xs text-gray-500">{businessName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/sop"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              SOP Builder
            </Link>
            <Link
              href="/settings/integrations"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </Link>
            <SignOutButton />
            <div className="flex items-center gap-2 ml-1">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-xs text-gray-500">Live</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Workflow Intelligence Map — the hero visualization. Full width,
            dark, animated. Shows employees + their tasks + automation
            clusters as a live force-directed graph. Collapses to a thin
            summary bar if the owner prefers the table view. */}
        <div className="mb-8">
          <WorkflowIntelligenceMap />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Active Now', value: stats.activeNow, icon: Users, color: 'text-green-500' },
            { label: 'Captures Today', value: stats.totalCaptures, icon: Activity, color: 'text-blue-500' },
            { label: 'Automation Flags', value: stats.highAutomation, icon: Zap, color: 'text-amber-500' },
            { label: 'Avg Confidence', value: `${stats.avgConfidence}%`, icon: TrendingUp, color: 'text-purple-500' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-500">{stat.label}</span>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Connection prompts for detected-but-not-connected tools.
            Renders nothing when there are no qualifying tools. */}
        <ConnectionPrompts />

        {/* Critical handoff bottlenecks — surfaces ABOVE the opportunities
            panel per spec. Only renders when there's at least one critical
            row (avg gap > 4hrs, occ >= 3). Owners need to see these
            first because they're the highest-value automation targets. */}
        <CriticalHandoffBanner />

        {/* Opportunities — surface highest-leverage detected patterns first */}
        <div className="mb-8">
          <OpportunitiesTable />
        </div>

        {/* Workflow sequences — multi-step chains rolled up from individual
            captures. Sits between the per-pattern opportunities and the
            per-employee status table because it bridges the two views:
            "here's what the team does together" before "here's who's
            doing what right now." */}
        <div className="mb-8">
          <WorkflowSequencesPanel />
        </div>

        {/* Workflow handoffs — cross-employee transitions. Bottlenecks here
            often surface the same problems as the opportunities panel but
            from a different angle: where work IS sitting rather than where
            it COULD be automated. */}
        <div className="mb-8">
          <WorkflowHandoffsPanel />
        </div>

        {/* Employee Table */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Team Overview</h2>
            <p className="text-xs text-gray-500 mt-0.5">Real-time workflow intelligence</p>
          </div>

          {employees.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Users className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No employees yet</p>
              <p className="text-xs text-gray-400 mt-1">Deploy the agent to start capturing data</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {employees.map((emp) => (
                <div
                  key={emp.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/employee/${emp.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/employee/${emp.id}`) }}
                  className={`flex items-center px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                    emp.is_paused ? 'bg-amber-50/40' : ''
                  }`}
                >
                  {/* Status + Name */}
                  <div className="flex items-center gap-3 w-72">
                    <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                      {emp.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 truncate">{emp.name}</p>
                        {emp.is_paused && <PausedBadge />}
                        {emp.has_unack_role_discovery && <RoleDiscoveryBadge />}
                      </div>
                      {/* Split-signal indicators: agent process health
                          (green/red/gray) is distinct from last-activity
                          (timestamp + idle/off-hours qualifier). Owners
                          can finally tell a crashed agent apart from an
                          off-shift employee. */}
                      <div className="flex items-center gap-1 flex-wrap mt-1">
                        <AgentHealthChip
                          health={emp.agent_health}
                          ageLabel={emp.heartbeat_age}
                        />
                        <LastActiveChip value={emp.last_active} />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{emp.role || 'Admin'}</p>
                    </div>
                  </div>

                  {/* Current Task */}
                  <div className="flex-1 px-4">
                    {emp.latest_capture ? (
                      <div>
                        <p className="text-xs text-gray-700 line-clamp-1">{emp.latest_capture.task}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[emp.latest_capture.category] || 'bg-gray-100 text-gray-500'}`}>
                            {emp.latest_capture.category}
                          </span>
                          {emp.latest_capture.software && (
                            <span className="text-xs text-gray-400">{emp.latest_capture.software}</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">No data yet</p>
                    )}
                  </div>

                  {/* Automation */}
                  <div className="w-32 text-center">
                    {emp.latest_capture && (
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${AUTOMATION_COLORS[emp.latest_capture.automation_potential] || ''}`}>
                        {emp.latest_capture.automation_potential} potential
                      </span>
                    )}
                  </div>

                  {/* Captures */}
                  <div className="w-24 text-center">
                    <p className="text-sm font-medium text-gray-900">{emp.today_captures}</p>
                    <p className="text-xs text-gray-400">captures</p>
                  </div>

                  {/* Flags */}
                  <div className="w-24 text-center">
                    {emp.high_automation_count > 0 && (
                      <div className="flex items-center justify-center gap-1">
                        <Zap className="w-3 h-3 text-amber-500" />
                        <span className="text-xs font-medium text-amber-600">{emp.high_automation_count}</span>
                      </div>
                    )}
                  </div>

                  {/* Time */}
                  <div className="w-24 text-right">
                    {emp.latest_capture && (
                      <div className="flex items-center justify-end gap-1">
                        <Clock className="w-3 h-3 text-gray-300" />
                        <span className="text-xs text-gray-400">
                          {new Date(emp.latest_capture.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Pause toggle */}
                  <div className="w-24 flex justify-end pl-4">
                    <PauseToggle
                      employeeId={emp.id}
                      initialPaused={emp.is_paused}
                      size="sm"
                      onChange={(paused) => {
                        setEmployees((prev) =>
                          prev.map((e) => (e.id === emp.id ? { ...e, is_paused: paused } : e))
                        )
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RoleDiscoveryBadge() {
  return (
    <span
      title="New role insight from observed behavior — click through to review"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200"
    >
      <Sparkles className="w-2.5 h-2.5" />
      New role insight
    </span>
  )
}

// HeartbeatBadge removed in the split-signal refactor. Replaced by
// AgentHealthChip + LastActiveChip from @/components/AgentStatusIndicators,
// which expose the two underlying signals as separate chips rather than
// a single combined warning.
