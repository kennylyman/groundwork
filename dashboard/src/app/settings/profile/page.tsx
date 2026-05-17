'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import {
  Sparkles,
  Save,
  Plus,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react'

type ToolEntry = { name: string; used_for: string[] }
type WorkflowEntry = { name: string; description: string }
type PainPointEntry = { description: string; severity?: 'high' | 'medium' | 'low' }

type EditableState = {
  business_name: string
  industry: string
  sub_industry: string
  size_band: string
  tool_stack: ToolEntry[]
  workflows: WorkflowEntry[]
  pain_points: PainPointEntry[]
  compliance_constraints: string[]
}

type Meta = {
  intake_completed_at: string | null
  intake_skipped_at: string | null
}

const SIZE_BANDS = ['solo', 'small (2-10)', 'small (10-50)', 'medium (50-200)', 'large']

const EMPTY: EditableState = {
  business_name: '',
  industry: '',
  sub_industry: '',
  size_band: '',
  tool_stack: [],
  workflows: [],
  pain_points: [],
  compliance_constraints: [],
}

export default function ProfileSettingsPage() {
  const [state, setState] = useState<EditableState>(EMPTY)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [exists, setExists] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // Compliance edited as a comma-separated string so the input stays simple.
  const [complianceInput, setComplianceInput] = useState('')

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
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
    const { data: profile } = await supabase
      .from('business_profiles')
      .select('*')
      .eq('business_id', biz.id)
      .maybeSingle()

    const tools = ((profile?.tool_stack as ToolEntry[] | null) ?? []).map((t) => ({
      name: t.name ?? '',
      used_for: Array.isArray(t.used_for) ? t.used_for : [],
    }))
    const workflows = ((profile?.workflows as WorkflowEntry[] | null) ?? []).map((w) => ({
      name: w.name ?? '',
      description: w.description ?? '',
    }))
    const painPoints = ((profile?.pain_points as PainPointEntry[] | null) ?? []).map(
      (p) => ({
        description: p.description ?? '',
        severity: p.severity,
      })
    )
    const compliance = (profile?.compliance_constraints as string[] | null) ?? []

    setState({
      business_name: biz.name ?? '',
      industry: profile?.industry ?? '',
      sub_industry: profile?.sub_industry ?? '',
      size_band: profile?.size_band ?? '',
      tool_stack: tools,
      workflows,
      pain_points: painPoints,
      compliance_constraints: compliance,
    })
    setComplianceInput(compliance.join(', '))
    setMeta(
      profile
        ? {
            intake_completed_at: profile.intake_completed_at ?? null,
            intake_skipped_at: profile.intake_skipped_at ?? null,
          }
        : null
    )
    setExists(!!profile)
    setLoading(false)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const body = {
        ...state,
        // Parse compliance from the comma-separated input back to an array.
        compliance_constraints: complianceInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }
      const r = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const resBody = await r.json()
      if (!r.ok) throw new Error(resBody.error || `HTTP ${r.status}`)
      setSavedAt(Date.now())
      // Re-read so we pick up any server-side normalization.
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
        <Loader2 className="w-5 h-5 text-gray-400 animate-spin mx-auto" />
      </div>
    )
  }

  if (!exists && !state.business_name) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
        <p className="text-sm text-gray-500 mb-3">No profile yet.</p>
        <Link
          href="/team-onboarding"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Run the intake chat
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="bg-white rounded-2xl border border-gray-200 px-7 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
              Business profile
            </p>
            <h2 className="text-2xl font-semibold text-gray-900">
              {state.business_name || 'Untitled business'}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {meta?.intake_completed_at
                ? `Intake completed ${new Date(meta.intake_completed_at).toLocaleDateString()}`
                : meta?.intake_skipped_at
                ? `Intake skipped ${new Date(meta.intake_skipped_at).toLocaleDateString()}`
                : 'No intake on file yet'}
            </p>
          </div>
          <Link
            href="/team-onboarding"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            title="Re-run intake to refresh fields"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Re-run intake
          </Link>
        </div>
      </div>

      {/* Basics */}
      <FieldSection title="Basics">
        <TextField
          label="Business name"
          value={state.business_name}
          onChange={(v) => setState((s) => ({ ...s, business_name: v }))}
        />
        <TextField
          label="Industry"
          value={state.industry}
          onChange={(v) => setState((s) => ({ ...s, industry: v }))}
          placeholder="Home Care, Real Estate, Legal, …"
        />
        <TextareaField
          label="Description"
          value={state.sub_industry}
          onChange={(v) => setState((s) => ({ ...s, sub_industry: v }))}
          placeholder="A richer one-line description of what the business does."
        />
        <SelectField
          label="Size band"
          value={state.size_band}
          options={['', ...SIZE_BANDS]}
          onChange={(v) => setState((s) => ({ ...s, size_band: v }))}
        />
      </FieldSection>

      {/* Tool stack */}
      <ListSection
        title="Tools the team uses"
        items={state.tool_stack}
        empty="No tools recorded yet"
        onAdd={() =>
          setState((s) => ({
            ...s,
            tool_stack: [...s.tool_stack, { name: '', used_for: [] }],
          }))
        }
        onRemove={(i) =>
          setState((s) => ({
            ...s,
            tool_stack: s.tool_stack.filter((_, idx) => idx !== i),
          }))
        }
        render={(item, i) => (
          <div className="grid grid-cols-[1fr_2fr] gap-2 w-full">
            <input
              type="text"
              value={item.name}
              placeholder="Tool name"
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  tool_stack: s.tool_stack.map((t, idx) =>
                    idx === i ? { ...t, name: e.target.value } : t
                  ),
                }))
              }
              className="px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <input
              type="text"
              value={item.used_for.join(', ')}
              placeholder="used for: scheduling, billing"
              onChange={(e) => {
                const parts = e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                setState((s) => ({
                  ...s,
                  tool_stack: s.tool_stack.map((t, idx) =>
                    idx === i ? { ...t, used_for: parts } : t
                  ),
                }))
              }}
              className="px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
        )}
      />

      {/* Workflows */}
      <ListSection
        title="Named workflows"
        items={state.workflows}
        empty="No workflows recorded yet"
        onAdd={() =>
          setState((s) => ({
            ...s,
            workflows: [...s.workflows, { name: '', description: '' }],
          }))
        }
        onRemove={(i) =>
          setState((s) => ({
            ...s,
            workflows: s.workflows.filter((_, idx) => idx !== i),
          }))
        }
        render={(item, i) => (
          <div className="grid grid-cols-[1fr_2fr] gap-2 w-full">
            <input
              type="text"
              value={item.name}
              placeholder="Workflow name"
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  workflows: s.workflows.map((w, idx) =>
                    idx === i ? { ...w, name: e.target.value } : w
                  ),
                }))
              }
              className="px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <input
              type="text"
              value={item.description}
              placeholder="Short description"
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  workflows: s.workflows.map((w, idx) =>
                    idx === i ? { ...w, description: e.target.value } : w
                  ),
                }))
              }
              className="px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
        )}
      />

      {/* Pain points */}
      <ListSection
        title="Pain points"
        items={state.pain_points}
        empty="No pain points recorded yet"
        onAdd={() =>
          setState((s) => ({
            ...s,
            pain_points: [...s.pain_points, { description: '' }],
          }))
        }
        onRemove={(i) =>
          setState((s) => ({
            ...s,
            pain_points: s.pain_points.filter((_, idx) => idx !== i),
          }))
        }
        render={(item, i) => (
          <div className="grid grid-cols-[1fr_auto] gap-2 w-full">
            <input
              type="text"
              value={item.description}
              placeholder="What's frustrating about this work?"
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  pain_points: s.pain_points.map((p, idx) =>
                    idx === i ? { ...p, description: e.target.value } : p
                  ),
                }))
              }
              className="px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <select
              value={item.severity ?? ''}
              onChange={(e) => {
                const v = e.target.value
                setState((s) => ({
                  ...s,
                  pain_points: s.pain_points.map((p, idx) =>
                    idx === i
                      ? {
                          ...p,
                          severity:
                            v === 'high' || v === 'medium' || v === 'low'
                              ? v
                              : undefined,
                        }
                      : p
                  ),
                }))
              }}
              className="px-3 py-1.5 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
            >
              <option value="">severity</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </div>
        )}
      />

      {/* Compliance */}
      <FieldSection title="Compliance constraints">
        <TextareaField
          label="Comma-separated"
          value={complianceInput}
          onChange={setComplianceInput}
          placeholder="HIPAA, data must stay in WellSky, …"
          rows={2}
        />
      </FieldSection>

      {/* Save bar */}
      <div className="sticky bottom-4 z-10 bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-3 flex items-center justify-between gap-4">
        <div className="text-xs">
          {savedAt !== null && (
            <div className="flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Saved {new Date(savedAt).toLocaleTimeString()}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-1.5 text-red-700">
              <AlertCircle className="w-3.5 h-3.5" />
              {error}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save profile
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ---------- helpers ----------

function FieldSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-3">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
      />
    </div>
  )
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt || '— none —'}
          </option>
        ))}
      </select>
    </div>
  )
}

function ListSection<T>({
  title,
  items,
  empty,
  onAdd,
  onRemove,
  render,
}: {
  title: string
  items: T[]
  empty: string
  onAdd: () => void
  onRemove: (i: number) => void
  render: (item: T, i: number) => React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">
          {title}
        </h3>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
        >
          <Plus className="w-3.5 h-3.5" />
          Add row
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">{empty}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              {render(item, i)}
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="shrink-0 p-1.5 text-gray-400 hover:text-gray-700 rounded"
                title="Remove"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
