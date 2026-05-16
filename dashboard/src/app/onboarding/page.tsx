'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Plus, Mail, Check, Users, Activity, CheckCircle, Clock } from 'lucide-react'

type Employee = {
  id: string
  name: string
  role: string
  email: string
  install_token: string
  invite_sent_at: string | null
}

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

export default function OnboardingPage() {
  const router = useRouter()
  const [business, setBusiness] = useState<any>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [sent, setSent] = useState<string[]>([])
  const [newEmployee, setNewEmployee] = useState({ name: '', role: '', email: '' })
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: biz } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', user.id)
      .single()

    if (!biz) { router.push('/signup'); return }

    setBusiness(biz)

    const { data: emps } = await supabase
      .from('employees')
      .select('*')
      .eq('business_id', biz.id)
      .order('created_at')

    setEmployees(emps || [])
    setSent((emps || []).filter((e: Employee) => e.invite_sent_at).map((e: Employee) => e.id))
    setLoading(false)
  }

  async function addEmployee() {
    if (!newEmployee.name || !newEmployee.role || !newEmployee.email) return
    setAdding(true)

    const { data, error } = await supabase
      .from('employees')
      .insert({
        business_id: business.id,
        name: newEmployee.name,
        role: newEmployee.role,
        email: newEmployee.email,
        is_active: true,
        install_token: crypto.randomUUID(),
      })
      .select()
      .single()

    if (!error && data) {
      setEmployees(e => [...e, data])
      setNewEmployee({ name: '', role: '', email: '' })
      setShowForm(false)
      await sendInvite(data.id)
    }
    setAdding(false)
  }

  async function sendInvite(employeeId: string) {
    setSending(employeeId)
    try {
      const res = await fetch('/api/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId }),
      })
      if (res.ok) {
        setSent(s => [...s, employeeId])
      }
    } catch (err) {
      console.error('Failed to send invite:', err)
    } finally {
      setSending(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center">
              <Activity className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-900">Groundwork</span>
          </div>
          <button onClick={() => router.push('/')} className="text-xs text-gray-500 hover:text-gray-900 transition-colors">
            Go to dashboard →
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-8 py-12">
        <div className="mb-10">
          <h1 className="text-2xl font-semibold text-gray-900">Set up {business?.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Add your team. Each person gets an email with their personal installer link.
          </p>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 mb-8 text-white">
          <h2 className="text-sm font-semibold mb-4">How it works</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { step: '1', title: 'Add employees', desc: 'Enter name, role, and email' },
              { step: '2', title: 'We send the invite', desc: 'Each person gets a personal installer link' },
              { step: '3', title: 'Insights flow in', desc: 'Data appears in your dashboard in real time' },
            ].map(s => (
              <div key={s.step} className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">{s.step}</div>
                <div>
                  <p className="text-xs font-medium">{s.title}</p>
                  <p className="text-xs text-white/60 mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">Team members</h2>
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{employees.length}</span>
            </div>
            <button
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
                  value={newEmployee.name}
                  onChange={e => setNewEmployee(n => ({ ...n, name: e.target.value }))}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                  autoFocus
                />
                <select
                  value={newEmployee.role}
                  onChange={e => setNewEmployee(n => ({ ...n, role: e.target.value }))}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                >
                  <option value="">Select role</option>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="flex gap-3">
                <input
                  type="email"
                  placeholder="Work email"
                  value={newEmployee.email}
                  onChange={e => setNewEmployee(n => ({ ...n, email: e.target.value }))}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                />
                <button
                  onClick={addEmployee}
                  disabled={adding || !newEmployee.name || !newEmployee.role || !newEmployee.email}
                  className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  {adding ? 'Adding...' : 'Add & send invite'}
                </button>
                <button onClick={() => setShowForm(false)} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="divide-y divide-gray-50">
            {employees.map(emp => (
              <div key={emp.id} className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-medium text-gray-600">
                    {emp.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{emp.name}</p>
                    <p className="text-xs text-gray-500">{emp.role} · {emp.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {sent.includes(emp.id) ? (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 border border-green-100 px-3 py-1.5 rounded-lg">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Invite sent
                    </div>
                  ) : (
                    <button
                      onClick={() => sendInvite(emp.id)}
                      disabled={sending === emp.id}
                      className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      {sending === emp.id ? (
                        <><Clock className="w-3.5 h-3.5" /> Sending...</>
                      ) : (
                        <><Mail className="w-3.5 h-3.5" /> Send invite</>
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
                <p className="text-xs text-gray-400 mt-1">Add your first team member to get started</p>
              </div>
            )}
          </div>

          {employees.length > 0 && (
            <div className="px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => router.push('/')}
                className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-gray-700 transition-colors"
              >
                <Check className="w-4 h-4" />
                Go to dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
