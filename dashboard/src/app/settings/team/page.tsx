'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, type Employee } from '@/lib/supabase'
import {
  Users,
  Plus,
  Mail,
  CheckCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Trash2,
  Loader2,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Save,
  AlertCircle,
} from 'lucide-react'
import {
  DEFAULT_CAPTURE_HOURS,
  parseCaptureHours,
  type CaptureHours,
} from '@/lib/capture-hours'
import {
  CaptureScheduleEditor,
  summarizeCaptureHours,
} from '@/components/CaptureScheduleEditor'

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
  const [businessDefault, setBusinessDefault] =
    useState<CaptureHours>(DEFAULT_CAPTURE_HOURS)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [newEmp, setNewEmp] = useState({ name: '', role: '', email: '' })
  // Which employee's schedule editor is currently expanded. Single-open
  // model so the page doesn't get visually noisy.
  const [expandedSchedule, setExpandedSchedule] = useState<string | null>(null)

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
    const [empRes, scheduleRes] = await Promise.all([
      supabase
        .from('employees')
        .select('*')
        .eq('business_id', biz.id)
        .order('created_at'),
      // Owner cookie path → returns the business-level schedule. Used
      // as the "Use business default" preview/fallback for each employee.
      fetch('/api/settings/capture', { cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => null),
    ])
    setEmployees(empRes.data ?? [])
    if (scheduleRes && typeof scheduleRes === 'object' && !scheduleRes.error) {
      setBusinessDefault({
        days: scheduleRes.days,
        start_time: scheduleRes.start_time,
        end_time: scheduleRes.end_time,
        timezone: scheduleRes.timezone || DEFAULT_CAPTURE_HOURS.timezone,
      })
    }
    setLoading(false)
  }

  function updateEmployeeLocal(employeeId: string, patch: Partial<Employee>) {
    setEmployees((emps) =>
      emps.map((e) => (e.id === employeeId ? { ...e, ...patch } : e))
    )
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

  async function deleteEmployee(emp: Employee) {
    // Owner row is the anchor for the business — server refuses too, but
    // the UI shouldn't even offer the affordance.
    if ((emp.role ?? '').trim().toLowerCase() === 'owner') return

    const ok = window.confirm(
      `Are you sure you want to remove ${emp.name} from the team?\n\nThis deletes their captures, opportunities, and role profile. There's no undo.`
    )
    if (!ok) return

    setDeleting(emp.id)
    setError(null)
    // Optimistic remove — snapshot prior state so we can roll back on failure.
    const prior = employees
    setEmployees((current) => current.filter((e) => e.id !== emp.id))

    try {
      const r = await fetch(`/api/employee/${emp.id}`, { method: 'DELETE' })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${r.status}`)
      }
      // Success — keep optimistic state.
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      setError(`Could not remove ${emp.name}: ${message}`)
      // Roll back the optimistic delete.
      setEmployees(prior)
    } finally {
      setDeleting(null)
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
      {error && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <span className="flex-1 break-all">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900 text-xs shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

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
          {employees.map((emp) => {
            const scheduleOpen = expandedSchedule === emp.id
            const hasOverride = emp.capture_hours != null
            return (
              <div key={emp.id}>
                <div className="px-6 py-4 flex items-center justify-between gap-4">
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

                  <div className="shrink-0 flex items-center gap-2">
                    {/* Schedule expand/collapse. Shows a "Custom" chip when
                        the employee has an override, otherwise just an icon. */}
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSchedule(scheduleOpen ? null : emp.id)
                      }
                      title={
                        hasOverride
                          ? 'Custom schedule (click to edit)'
                          : 'Edit schedule for this employee'
                      }
                      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                        hasOverride
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100'
                          : 'text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <CalendarClock className="w-3.5 h-3.5" />
                      {hasOverride ? 'Custom schedule' : 'Schedule'}
                      {scheduleOpen ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>

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

                    {/* Delete — hidden for the Owner row so we can't remove
                        the business anchor. Confirmation handled inline by
                        window.confirm in the click handler. */}
                    {(emp.role ?? '').trim().toLowerCase() !== 'owner' && (
                      <button
                        type="button"
                        onClick={() => deleteEmployee(emp)}
                        disabled={deleting === emp.id}
                        title={`Remove ${emp.name} from the team`}
                        aria-label={`Remove ${emp.name} from the team`}
                        className="flex items-center justify-center w-8 h-8 text-red-500 border border-red-200 rounded-lg hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                      >
                        {deleting === emp.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {scheduleOpen && (
                  <EmployeeScheduleEditor
                    key={`schedule-${emp.id}`}
                    employee={emp}
                    businessDefault={businessDefault}
                    onSaved={(next) =>
                      updateEmployeeLocal(emp.id, { capture_hours: next })
                    }
                  />
                )}
              </div>
            )
          })}

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

// ---------- Per-employee schedule editor ----------

/**
 * Expandable schedule editor for one employee row.
 *
 * Owns local state for the in-flight edit; on save, PATCH to
 * /api/settings/capture with employee_id (+ clear=true when the toggle
 * is back to "use business default"). Reports the final value back via
 * onSaved so the parent can update its local employee list without a
 * full reload.
 */
function EmployeeScheduleEditor({
  employee,
  businessDefault,
  onSaved,
}: {
  employee: Employee
  businessDefault: CaptureHours
  onSaved: (next: CaptureHours | null) => void
}) {
  const hasOverride = employee.capture_hours != null
  // useDefault === true means "follow business schedule", maps to NULL in DB.
  const [useDefault, setUseDefault] = useState(!hasOverride)
  // The in-flight edited hours. Seeded from the override if present,
  // otherwise from the business default so the owner has a sensible
  // starting point when they flip the toggle off.
  const [hours, setHours] = useState<CaptureHours>(
    hasOverride ? parseCaptureHours(employee.capture_hours) : businessDefault
  )
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const body = useDefault
        ? { employee_id: employee.id, clear: true }
        : { employee_id: employee.id, ...hours }
      const r = await fetch('/api/settings/capture', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const respBody = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(respBody.error || `HTTP ${r.status}`)
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(null), 3000)
      // Push the canonical post-save value back up. Null = inherited.
      onSaved(useDefault ? null : hours)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  const defaultSummary = summarizeCaptureHours(businessDefault)

  return (
    <div className="px-6 py-5 bg-gray-50 border-t border-gray-100">
      <div className="mb-4 flex items-start gap-3">
        <input
          type="checkbox"
          id={`use-default-${employee.id}`}
          checked={useDefault}
          onChange={(e) => setUseDefault(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-gray-900 cursor-pointer"
        />
        <label
          htmlFor={`use-default-${employee.id}`}
          className="text-xs text-gray-700 cursor-pointer leading-relaxed"
        >
          <span className="font-medium">Use business default</span>
          <span className="block text-gray-500 mt-0.5">
            {defaultSummary} ({businessDefault.timezone})
          </span>
        </label>
      </div>

      <CaptureScheduleEditor
        value={hours}
        onChange={setHours}
        disabled={useDefault}
      />

      <div className="flex items-center justify-between gap-3 mt-5">
        <div className="text-xs">
          {savedAt && (
            <div className="flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Saved {new Date(savedAt).toLocaleTimeString()}
            </div>
          )}
          {err && (
            <div className="flex items-center gap-1.5 text-red-700">
              <AlertCircle className="w-3.5 h-3.5" />
              {err}
            </div>
          )}
          {!useDefault && hours.days.length === 0 && (
            <div className="text-amber-700">
              No days selected — this employee will not capture at all.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              Save schedule
            </>
          )}
        </button>
      </div>
      <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
        The agent on {employee.name.split(' ')[0]}&rsquo;s machine fetches
        this on startup and once an hour. Changes take effect within an
        hour without a reinstall.
      </p>
    </div>
  )
}
