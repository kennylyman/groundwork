'use client'

import { useEffect, useState } from 'react'
import { supabase, Employee, Capture } from '@/lib/supabase'
import { ArrowLeft, Zap, Clock, Activity, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { use } from 'react'
import { PauseToggle, PausedBadge } from '@/components/PauseToggle'

const AUTOMATION_COLORS: Record<string, string> = {
  high: 'text-red-500 bg-red-50 border-red-100',
  medium: 'text-amber-500 bg-amber-50 border-amber-100',
  low: 'text-blue-500 bg-blue-50 border-blue-100',
  none: 'text-gray-400 bg-gray-50 border-gray-100',
}

const ACTIVITY_COLORS: Record<string, string> = {
  high: 'bg-green-400',
  medium: 'bg-blue-400',
  low: 'bg-gray-300',
  idle: 'bg-gray-200',
}

export default function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadEmployee()
  }, [id])

  async function loadEmployee() {
    try {
      const { data: emp } = await supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .single()

      setEmployee(emp)

      const today = new Date()
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()

      const { data: caps } = await supabase
        .from('captures')
        .select('*')
        .eq('employee_id', id)
        .gte('captured_at', todayStart)
        .order('captured_at', { ascending: false })
        .limit(200)

      setCaptures(caps || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const categoryBreakdown = captures.reduce((acc, cap) => {
    if (!cap.is_idle) {
      acc[cap.category] = (acc[cap.category] || 0) + 1
    }
    return acc
  }, {} as Record<string, number>)

  const totalNonIdle = Object.values(categoryBreakdown).reduce((a, b) => a + b, 0)

  const highAutoCaptures = captures.filter(c => c.automation_potential === 'high')
  const avgConfidence = captures.length > 0
    ? Math.round(captures.reduce((sum, c) => sum + c.confidence, 0) / captures.length)
    : 0

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-gray-600 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Back</span>
            </Link>
            <div className="w-px h-4 bg-gray-200" />
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-900 rounded-full flex items-center justify-center text-xs font-medium text-white">
                {employee?.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-semibold text-gray-900">{employee?.name}</h1>
                  {employee?.is_paused && <PausedBadge />}
                </div>
                <p className="text-xs text-gray-500">{employee?.role || 'Admin'} · Today</p>
              </div>
            </div>
          </div>
          {employee && (
            <PauseToggle
              employeeId={employee.id}
              initialPaused={!!employee.is_paused}
              onChange={(paused) => setEmployee((prev) => (prev ? { ...prev, is_paused: paused } : prev))}
            />
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Captures Today', value: captures.length, icon: Activity, color: 'text-blue-500' },
            { label: 'Avg Confidence', value: `${avgConfidence}%`, icon: TrendingUp, color: 'text-purple-500' },
            { label: 'High Auto Flags', value: highAutoCaptures.length, icon: Zap, color: 'text-amber-500' },
            { label: 'Categories', value: Object.keys(categoryBreakdown).length, icon: Clock, color: 'text-green-500' },
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

        <div className="grid grid-cols-3 gap-6">
          {/* Time Distribution */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Time Distribution</h2>
            {Object.entries(categoryBreakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([category, count]) => (
                <div key={category} className="mb-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-gray-600 truncate pr-2">{category}</span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {totalNonIdle > 0 ? Math.round((count / totalNonIdle) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gray-900 rounded-full"
                      style={{ width: `${totalNonIdle > 0 ? (count / totalNonIdle) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            {Object.keys(categoryBreakdown).length === 0 && (
              <p className="text-xs text-gray-400">No data yet today</p>
            )}
          </div>

          {/* Automation Opportunities */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">
              Automation Flags
              {highAutoCaptures.length > 0 && (
                <span className="ml-2 text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">
                  {highAutoCaptures.length} high
                </span>
              )}
            </h2>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {highAutoCaptures.slice(0, 10).map((cap) => (
                <div key={cap.id} className="p-3 bg-amber-50 border border-amber-100 rounded-lg">
                  <p className="text-xs text-gray-700 font-medium line-clamp-2">{cap.task}</p>
                  <p className="text-xs text-amber-600 mt-1">{cap.category}</p>
                </div>
              ))}
              {highAutoCaptures.length === 0 && (
                <p className="text-xs text-gray-400">No high automation flags today</p>
              )}
            </div>
          </div>

          {/* Recent Captures */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Latest Activity</h2>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {captures.slice(0, 8).map((cap) => (
                <div key={cap.id} className="flex items-start gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${ACTIVITY_COLORS[cap.activity_level] || 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 line-clamp-1">{cap.task}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(cap.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {cap.confidence && ` · ${cap.confidence}%`}
                    </p>
                  </div>
                </div>
              ))}
              {captures.length === 0 && (
                <p className="text-xs text-gray-400">No captures today</p>
              )}
            </div>
          </div>
        </div>

        {/* Full Timeline */}
        <div className="mt-6 bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Full Timeline</h2>
            <p className="text-xs text-gray-500 mt-0.5">{captures.length} captures today</p>
          </div>
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {captures.map((cap) => (
              <div key={cap.id} className="px-6 py-3 flex items-start gap-4">
                <span className="text-xs text-gray-400 w-16 shrink-0 pt-0.5">
                  {new Date(cap.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-800">{cap.task}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{cap.category} · {cap.software}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${AUTOMATION_COLORS[cap.automation_potential] || ''}`}>
                    {cap.automation_potential}
                  </span>
                  <span className="text-xs text-gray-400">{cap.confidence}%</span>
                </div>
              </div>
            ))}
            {captures.length === 0 && (
              <div className="px-6 py-8 text-center">
                <p className="text-xs text-gray-400">No captures today yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
