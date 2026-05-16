'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import {
  Plus,
  Mail,
  Check,
  Users,
  Activity,
  CheckCircle,
  Clock,
  Building2,
  ArrowRight,
} from 'lucide-react'

// ---------- Types ----------

type Employee = {
  id: string
  name: string
  role: string
  email: string
  install_token: string
  invite_sent_at: string | null
}

type Business = {
  id: string
  name: string
  industry: string
  owner_id: string
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

const INDUSTRIES = [
  'Home Care',
  'Healthcare',
  'Legal',
  'Accounting',
  'Real Estate',
  'Insurance',
  'Construction',
  'Retail',
  'Restaurant',
  'Other',
]

// ---------- Page ----------

export default function TeamOnboardingPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    // Middleware already guarantees authentication for this route, but we
    // re-fetch the user so the no-business form can use their id/email
    // when creating the business + first employee.
    const {
      data: { user: u },
    } = await supabase.auth.getUser()
    if (!u) {
      router.push('/login')
      return
    }
    setUser(u)

    const { data: biz } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_id', u.id)
      .maybeSingle()

    setBusiness(biz ?? null)
    setLoading(false)
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
      <Header showDashboardLink={!!business} onGoToDashboard={() => router.push('/')} />

      <div className="max-w-3xl mx-auto px-8 py-12">
        {!business && user && (
          <CreateBusinessView user={user} onCreated={(b) => setBusiness(b)} />
        )}
        {business && <TeamView business={business} />}
      </div>
    </div>
  )
}

function Header({
  showDashboardLink,
  onGoToDashboard,
}: {
  showDashboardLink: boolean
  onGoToDashboard: () => void
}) {
  return (
    <div className="bg-white border-b border-gray-200 px-8 py-4">
      <div className="max-w-3xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center">
            <Activity className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-gray-900">Groundwork</span>
        </div>
        {showDashboardLink && (
          <button
            onClick={onGoToDashboard}
            className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
          >
            Go to dashboard →
          </button>
        )}
      </div>
    </div>
  )
}

// ---------- Create-business view (no business yet) ----------

function CreateBusinessView({
  user,
  onCreated,
}: {
  user: User
  onCreated: (b: Business) => void
}) {
  const [form, setForm] = useState({
    businessName: '',
    industry: '',
    ownerName: (user.user_metadata?.full_name as string) || '',
  })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function createBusiness(e: React.FormEvent) {
    e.preventDefault()
    if (!form.businessName || !form.industry || !form.ownerName) return
    setCreating(true)
    setError('')

    try {
      const { data: business, error: bizErr } = await supabase
        .from('businesses')
        .insert({
          name: form.businessName,
          industry: form.industry,
          owner_id: user.id,
        })
        .select()
        .single()

      if (bizErr) throw bizErr
      if (!business) throw new Error('Business creation returned no row')

      // Create the owner as the first employee — mirrors the signup flow so
      // the team management view (and the dashboard) immediately has a row
      // to anchor everything else to.
      const { error: empErr } = await supabase.from('employees').insert({
        business_id: business.id,
        name: form.ownerName,
        role: 'Owner',
        email: user.email,
        is_active: true,
        install_token: crypto.randomUUID(),
      })

      // Non-fatal — business exists either way, owner can re-add themselves
      // from the team view if this errored.
      if (empErr) console.error('Failed to add owner as first employee:', empErr)

      onCreated(business as Business)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create business'
      setError(message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-gray-900">
          Let&rsquo;s set up your business
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Signed in as <span className="font-medium text-gray-700">{user.email}</span>.
          Tell us a little about your company and we&rsquo;ll spin up your dashboard.
        </p>
      </div>

      <div className="bg-gray-900 rounded-2xl p-6 mb-8 text-white">
        <h2 className="text-sm font-semibold mb-4">How it works</h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            { step: '1', title: 'Create your business', desc: 'Name, industry, your role' },
            { step: '2', title: 'Add your team', desc: 'Each person gets an installer link' },
            { step: '3', title: 'Insights flow in', desc: 'Real-time workflow intelligence' },
          ].map((s) => (
            <div key={s.step} className="flex gap-3">
              <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                {s.step}
              </div>
              <div>
                <p className="text-xs font-medium">{s.title}</p>
                <p className="text-xs text-white/60 mt-0.5">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <form
        onSubmit={createBusiness}
        className="bg-white rounded-2xl border border-gray-200 p-6"
      >
        <div className="flex items-center gap-2 mb-5">
          <Building2 className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Business details</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Business name
            </label>
            <input
              type="text"
              required
              autoFocus
              value={form.businessName}
              onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              placeholder="Acme Home Care"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Industry
              </label>
              <select
                required
                value={form.industry}
                onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              >
                <option value="">Select industry</option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Your name
              </label>
              <input
                type="text"
                required
                value={form.ownerName}
                onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                placeholder="Jane Smith"
              />
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={
              creating || !form.businessName || !form.industry || !form.ownerName
            }
            className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {creating ? (
              <>Creating your business…</>
            ) : (
              <>
                Create business
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="text-[11px] text-gray-400 text-center pt-1">
            You can rename or change industry later from settings.
          </p>
        </div>
      </form>
    </>
  )
}

// ---------- Team view (business exists) ----------

function TeamView({ business }: { business: Business }) {
  const router = useRouter()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [sent, setSent] = useState<string[]>([])
  const [newEmployee, setNewEmployee] = useState({ name: '', role: '', email: '' })
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    loadEmployees()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id])

  async function loadEmployees() {
    const { data: emps } = await supabase
      .from('employees')
      .select('*')
      .eq('business_id', business.id)
      .order('created_at')

    setEmployees(emps || [])
    setSent(
      (emps || [])
        .filter((e: Employee) => e.invite_sent_at)
        .map((e: Employee) => e.id)
    )
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
      setEmployees((e) => [...e, data])
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
        setSent((s) => [...s, employeeId])
      }
    } catch (err) {
      console.error('Failed to send invite:', err)
    } finally {
      setSending(null)
    }
  }

  return (
    <>
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-gray-900">Set up {business.name}</h1>
        <p className="text-sm text-gray-500 mt-1">
          Add your team. Each person gets an email with their personal installer link.
        </p>
      </div>

      <div className="bg-gray-900 rounded-2xl p-6 mb-8 text-white">
        <h2 className="text-sm font-semibold mb-4">How it works</h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            { step: '1', title: 'Add employees', desc: 'Enter name, role, and email' },
            {
              step: '2',
              title: 'We send the invite',
              desc: 'Each person gets a personal installer link',
            },
            {
              step: '3',
              title: 'Insights flow in',
              desc: 'Data appears in your dashboard in real time',
            },
          ].map((s) => (
            <div key={s.step} className="flex gap-3">
              <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                {s.step}
              </div>
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
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {employees.length}
            </span>
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
                onChange={(e) => setNewEmployee((n) => ({ ...n, name: e.target.value }))}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                autoFocus
              />
              <select
                value={newEmployee.role}
                onChange={(e) => setNewEmployee((n) => ({ ...n, role: e.target.value }))}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
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
                value={newEmployee.email}
                onChange={(e) => setNewEmployee((n) => ({ ...n, email: e.target.value }))}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
              />
              <button
                onClick={addEmployee}
                disabled={
                  adding || !newEmployee.name || !newEmployee.role || !newEmployee.email
                }
                className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {adding ? 'Adding…' : 'Add & send invite'}
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
            <div key={emp.id} className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-medium text-gray-600">
                  {emp.name
                    .split(' ')
                    .map((n: string) => n[0])
                    .join('')
                    .slice(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{emp.name}</p>
                  <p className="text-xs text-gray-500">
                    {emp.role} · {emp.email}
                  </p>
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
                      <>
                        <Clock className="w-3.5 h-3.5" /> Sending…
                      </>
                    ) : (
                      <>
                        <Mail className="w-3.5 h-3.5" /> Send invite
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
                Add your first team member to get started
              </p>
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
    </>
  )
}
