'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, type Employee } from '@/lib/supabase'
import {
  Users,
  Plus,
  Mail,
  CheckCircle,
  Clock,
  ExternalLink,
} from 'lucide-react'

const ROLES = [
  'Owner',
  'Office Manager',
  'Scheduler',
  'Billing Coordinator',
  'HR Coordinator',
  'Care Coordinator',
  'Admin Assistant',
  'Operations Manager',
  'Other',
]

type Business = { id: string; name: string }

export default function TeamSettingsPage() {
  const [business, setBusiness] = useState<Business | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [newEmp, setNewEmp] = useState({ name: '', role: '', email: '' })

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: biz } = await supabase
      .from('businesses')
      .select('id, name')
      .eq('owner_id', user.id)
      .maybeSingle()
    if (!biz) {
      setLoading(false)
      return
    }
    setBusiness(biz)
    const { data: emps } = await supabase
      .from('employees')
      .select('*')
      .eq('business_id', biz.id)
      .order('created_at')
    setEmployees(emps ?? [])
    setLoading(false)
  }

  async function addEmployee() {
    if (!business || !newEmp.name || !newEmp.role || !newEmp.email) return
    setAdding(true)
    const { data, error } = await supabase
      .from('employees')
      .insert({
        business_id: business.id,
        name: newEmp.name,
        role: newEmp.role,
        email: newEmp.email,
        is_active: true,
        install_token: crypto.randomUUID(),
      })
      .select()
      .single()
    if (!error && data) {
      setEmployees((e) => [...e, data])
      setNewEmp({ name: '', role: '', email: '' })
      setShowForm(false)
      await sendInvite(data.id)
    }
    setAdding(false)
  }

  async function sendInvite(employeeId: string) {
    setSending(employeeId)
    try {
      const r = await fetch('/api/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId }),
      })
      if (r.ok) {
        // Reload to pick up invite_sent_at from server
        await load()
      }
    } finally {
      setSending(null)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
        <div className="w-6 h-6 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900">Team</h2>
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {employees.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-xs font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add employee
          </button>
        </div>

        {showForm && (
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <input
                type="text"
                placeholder="Full name"
                value={newEmp.name}
                onChange={(e) => setNewEmp((n) => ({ ...n, name: e.target.value }))}
                className="px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                autoFocus
              />
              <select
                value={newEmp.role}
                onChange={(e) => setNewEmp((n) => ({ ...n, role: e.target.value }))}
                className="px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              >
                <option value="">Select role</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <input
                type="email"
                placeholder="Work email"
                value={newEmp.email}
                onChange={(e) => setNewEmp((n) => ({ ...n, email: e.target.value }))}
                className="flex-1 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              />
              <button
                onClick={addEmployee}
                disabled={adding || !newEmp.name || !newEmp.role || !newEmp.email}
                className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                {adding ? 'Adding…' : 'Add & invite'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-gray-50">
          {employees.map((emp) => (
            <div
              key={emp.id}
              className="px-6 py-4 flex items-center justify-between gap-4"
            >
              <Link
                href={`/employee/${emp.id}`}
                className="flex items-center gap-3 group min-w-0 flex-1"
              >
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-medium text-gray-600">
                  {emp.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 group-hover:underline">
                    {emp.name}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {emp.role}
                    {emp.email && ` · ${emp.email}`}
                  </p>
                </div>
                <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-gray-500 ml-1" />
              </Link>

              <div className="shrink-0">
                {emp.invite_sent_at ? (
                  <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 border border-green-100 px-3 py-1.5 rounded-lg">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Invite sent
                  </div>
                ) : (
                  <button
                    onClick={() => sendInvite(emp.id)}
                    disabled={sending === emp.id}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    {sending === emp.id ? (
                      <>
                        <Clock className="w-3.5 h-3.5" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Mail className="w-3.5 h-3.5" />
                        Send invite
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}

          {employees.length === 0 && !showForm && (
            <div className="px-6 py-10 text-center">
              <Users className="w-6 h-6 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No employees yet</p>
              <p className="text-xs text-gray-400 mt-1">
                Add your first team member to start collecting captures.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
