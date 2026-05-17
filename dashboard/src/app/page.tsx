'use client'

import { useEffect, useState } from 'react'
import { supabase, Employee, Capture } from '@/lib/supabase'
import { Activity, Users, Zap, TrendingUp, Clock, AlertCircle, FileText } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PauseToggle, PausedBadge } from '@/components/PauseToggle'
import { OpportunitiesTable } from '@/components/OpportunitiesTable'

type EmployeeWithStatus = Employee & {
  latest_capture?: Capture
  today_captures: number
  high_automation_count: number
  status: 'active' | 'idle' | 'offline'
}

const AUTOMATION_COLORS: Record<string, string> = {
  high: 'text-red-500 bg-red-50',
  medium: 'text-amber-500 bg-amber-50',
  low: 'text-blue-500 bg-blue-50',
  none: 'text-gray-400 bg-gray-50',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-400',
  idle: 'bg-amber-400',
  offline: 'bg-gray-300',
}

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

      const enriched: EmployeeWithStatus[] = await Promise.all(
        employeeList.map(async (emp) => {
          const { data: latest } = await supabase
            .from('captures')
            .select('*')
            .eq('employee_id', emp.id)
            .order('captured_at', { ascending: false })
            .limit(1)
            .single()

          const { count: todayCount } = await supabase
            .from('captures')
            .select('*', { count: 'exact', head: true })
            .eq('employee_id', emp.id)
            .gte('captured_at', todayStart)

          const { count: highAutoCount } = await supabase
            .from('captures')
            .select('*', { count: 'exact', head: true })
            .eq('employee_id', emp.id)
            .eq('automation_potential', 'high')
            .gte('captured_at', todayStart)

          let status: 'active' | 'idle' | 'offline' = 'offline'
          if (latest) {
            const captureTime = new Date(latest.captured_at).toISOString()
            if (captureTime > fifteenMinutesAgo) status = 'active'
            else if (captureTime > sixtyMinutesAgo) status = 'idle'
          }

          return {
            ...emp,
            latest_capture: latest || undefined,
            today_captures: todayCount || 0,
            high_automation_count: highAutoCount || 0,
            status,
          }
        })
      )

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
          <div className="flex items-center gap-4">
            <Link
              href="/sop"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              SOP Builder
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-xs text-gray-500">Live</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
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

        {/* Opportunities — surface highest-leverage detected patterns first */}
        <div className="mb-8">
          <OpportunitiesTable />
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
                  <div className="flex items-center gap-3 w-48">
                    <div className="relative">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-medium text-gray-600">
                        {emp.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </div>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${STATUS_COLORS[emp.status]}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-gray-900 truncate">{emp.name}</p>
                        {emp.is_paused && <PausedBadge />}
                      </div>
                      <p className="text-xs text-gray-500">{emp.role || 'Admin'}</p>
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
