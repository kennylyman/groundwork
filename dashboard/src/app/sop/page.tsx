'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  FileText,
  Copy,
  Download,
  Sparkles,
  Loader2,
  AlertCircle,
  BookOpen,
  Bell,
  ListChecks,
  Layers,
  Clock,
  Lightbulb,
  Zap,
  Calendar,
  User,
  Tag,
  BarChart3,
} from 'lucide-react'
import { supabase, Employee } from '@/lib/supabase'

type Sop = {
  title: string
  overview: string
  trigger: string
  steps: string[]
  software: string[]
  time_estimate: string
  automation_opportunities: string[]
}

type SopMeta = {
  employee: string
  category: string
  capture_count: number
  generated_at: string
  model: string
}

const CATEGORIES = [
  'Schedule Management',
  'Billing and Invoicing',
  'Caregiver HR and Onboarding',
  'Client Intake and Care Planning',
  'Authorization and Compliance',
  'Family and Client Communication',
  'Internal Communication',
  'Payroll Processing',
  'Reporting and Documentation',
  'Problem Resolution',
  'Meeting or Phone Call',
]

// ---------- Page ----------

export default function SopBuilderPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(false)
  const [sop, setSop] = useState<Sop | null>(null)
  const [meta, setMeta] = useState<SopMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setEmployees(data)
      })
  }, [])

  async function generate() {
    if (!employeeId || !category) {
      setError('Pick an employee and a category first.')
      return
    }
    setError(null)
    setSop(null)
    setMeta(null)
    setLoading(true)
    try {
      const r = await fetch('/api/generate-sop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, category }),
      })
      const body = await r.json()
      if (!r.ok) {
        throw new Error(body.detail || body.error || `HTTP ${r.status}`)
      }
      setSop(body.sop)
      setMeta(body.meta)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setLoading(false)
    }
  }

  function copyAsText() {
    if (!sop) return
    navigator.clipboard.writeText(sopToPlainText(sop, meta)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  function downloadPdf() {
    window.print()
  }

  const employee = employees.find((e) => e.id === employeeId)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav — hidden in print */}
      <div className="bg-white border-b border-gray-200 px-8 py-4 print:hidden">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Back</span>
            </Link>
            <div className="w-px h-4 bg-gray-200" />
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-600" />
              <h1 className="text-sm font-semibold text-gray-900">SOP Builder</h1>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8 pb-32">
        {/* Generation card — hidden in print */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-8 print:hidden">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Generate a new SOP</h2>
          <p className="text-xs text-gray-500 mb-5">
            Pick an employee and a category. We&rsquo;ll pull their last 7 days of
            captures and synthesize a Standard Operating Procedure.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                Employee
              </label>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
              >
                <option value="">Select an employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.role || 'Admin'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
              >
                <option value="">Select a category…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={loading || !employeeId || !category}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating SOP…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate SOP
              </>
            )}
          </button>

          {error && (
            <div className="mt-4 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* SOP document / skeleton / empty state */}
        {loading && <SopSkeleton />}
        {!loading && sop && meta && <SopDocument sop={sop} meta={meta} employee={employee} />}
        {!loading && !sop && !error && <EmptyState />}
      </div>

      {/* Sticky action bar — visible only when a SOP is rendered, hidden in print */}
      {sop && !loading && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-gray-200 px-8 py-3 print:hidden">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {meta && (
                <>
                  <span className="font-medium text-gray-700">{meta.employee}</span>
                  {' · '}
                  {meta.category}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyAsText}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={downloadPdf}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download as PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print stylesheet */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          #sop-document {
            box-shadow: none !important;
            border: 0 !important;
            border-radius: 0 !important;
            padding: 0 !important;
            max-width: 100% !important;
          }
          .sop-section { break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}

// ---------- SOP document ----------

function SopDocument({
  sop,
  meta,
  employee,
}: {
  sop: Sop
  meta: SopMeta
  employee?: Employee
}) {
  return (
    <div
      id="sop-document"
      className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 md:p-14"
    >
      {/* Title block */}
      <header className="mb-8 pb-8 border-b border-gray-100">
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 font-medium mb-3">
          Standard Operating Procedure
        </p>
        <h1 className="text-3xl font-semibold text-gray-900 leading-tight tracking-tight">
          {sop.title}
        </h1>

        <MetadataRow meta={meta} employee={employee} />
      </header>

      {/* Sections */}
      <div className="space-y-6">
        <SectionCard label="Overview" icon={BookOpen} accent="indigo">
          <p className="text-[15px] text-gray-700 leading-relaxed">{sop.overview}</p>
        </SectionCard>

        <SectionCard label="Trigger" icon={Bell} accent="amber">
          <p className="text-[15px] text-gray-700 leading-relaxed">{sop.trigger}</p>
        </SectionCard>

        <SectionCard label="Step-by-step process" icon={ListChecks} accent="slate">
          <StepTimeline steps={sop.steps} />
        </SectionCard>

        <SectionCard label="Software used" icon={Layers} accent="blue">
          <div className="flex flex-wrap gap-2">
            {sop.software.map((s) => (
              <SoftwarePill key={s} name={s} />
            ))}
          </div>
        </SectionCard>

        <SectionCard label="Time estimate" icon={Clock} accent="emerald">
          <p className="text-[15px] text-gray-700 leading-relaxed font-medium">
            {sop.time_estimate}
          </p>
        </SectionCard>

        <SectionCard label="Automation opportunities" icon={Lightbulb} accent="purple">
          <div className="space-y-2.5">
            {sop.automation_opportunities.map((a, i) => (
              <AutomationCard key={i} text={a} />
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

// ---------- Metadata row ----------

function MetadataRow({ meta, employee }: { meta: SopMeta; employee?: Employee }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5">
      <MetaPill icon={User} label={meta.employee} sublabel={employee?.role || undefined} />
      <MetaPill icon={Tag} label={meta.category} />
      <MetaPill icon={BarChart3} label={`${meta.capture_count} captures`} />
      <MetaPill
        icon={Calendar}
        label={new Date(meta.generated_at).toLocaleDateString(undefined, {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}
      />
    </div>
  )
}

function MetaPill({
  icon: Icon,
  label,
  sublabel,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  sublabel?: string
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <Icon className="w-3.5 h-3.5 text-gray-400" />
      <span className="text-gray-700 font-medium">{label}</span>
      {sublabel && <span className="text-gray-400">· {sublabel}</span>}
    </div>
  )
}

// ---------- Section card ----------

type Accent = 'indigo' | 'amber' | 'slate' | 'blue' | 'emerald' | 'purple'

const ACCENT: Record<Accent, { pill: string; icon: string }> = {
  indigo: { pill: 'bg-indigo-50 text-indigo-700 border-indigo-100', icon: 'text-indigo-500' },
  amber: { pill: 'bg-amber-50 text-amber-700 border-amber-100', icon: 'text-amber-500' },
  slate: { pill: 'bg-gray-100 text-gray-800 border-gray-200', icon: 'text-gray-700' },
  blue: { pill: 'bg-blue-50 text-blue-700 border-blue-100', icon: 'text-blue-500' },
  emerald: { pill: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: 'text-emerald-500' },
  purple: { pill: 'bg-purple-50 text-purple-700 border-purple-100', icon: 'text-purple-500' },
}

function SectionCard({
  label,
  icon: Icon,
  accent,
  children,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  accent: Accent
  children: React.ReactNode
}) {
  const colors = ACCENT[accent]
  return (
    <section className="sop-section bg-white rounded-xl border border-gray-100 p-6">
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${colors.pill} mb-4`}
      >
        <Icon className={`w-3.5 h-3.5 ${colors.icon}`} />
        <span className="text-[11px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div>{children}</div>
    </section>
  )
}

// ---------- Step timeline ----------

function StepTimeline({ steps }: { steps: string[] }) {
  return (
    <ol className="relative list-none pl-0 m-0">
      {steps.map((step, i) => {
        const text = step.replace(/^\d+\.\s*/, '')
        const isLast = i === steps.length - 1
        return (
          <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
            {!isLast && (
              <span
                aria-hidden
                className="absolute left-[18px] top-9 -bottom-0 w-px bg-gray-200"
              />
            )}
            <span className="relative z-10 shrink-0 w-9 h-9 rounded-full bg-gray-900 text-white text-sm font-semibold flex items-center justify-center shadow-sm">
              {i + 1}
            </span>
            <p className="text-[15px] text-gray-700 leading-relaxed pt-1.5 flex-1">{text}</p>
          </li>
        )
      })}
    </ol>
  )
}

// ---------- Software pill ----------

// Deterministic color picker — same software name always renders the same color.
const SOFTWARE_PALETTE = [
  { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-400', border: 'border-blue-100' },
  { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-400', border: 'border-emerald-100' },
  { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-400', border: 'border-purple-100' },
  { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400', border: 'border-amber-100' },
  { bg: 'bg-pink-50', text: 'text-pink-700', dot: 'bg-pink-400', border: 'border-pink-100' },
  { bg: 'bg-cyan-50', text: 'text-cyan-700', dot: 'bg-cyan-400', border: 'border-cyan-100' },
  { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-400', border: 'border-rose-100' },
  { bg: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-400', border: 'border-teal-100' },
]

function pickPalette(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return SOFTWARE_PALETTE[h % SOFTWARE_PALETTE.length]
}

function SoftwarePill({ name }: { name: string }) {
  const p = pickPalette(name.toLowerCase())
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${p.bg} ${p.border}`}
    >
      <span className={`w-2 h-2 rounded-full ${p.dot}`} />
      <span className={`text-xs font-medium ${p.text}`}>{name}</span>
    </div>
  )
}

// ---------- Automation card ----------

function AutomationCard({ text }: { text: string }) {
  return (
    <div className="flex gap-3 px-4 py-3 bg-amber-50/60 border border-amber-100 rounded-xl">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
        <Zap className="w-4 h-4" />
      </div>
      <p className="text-[14px] text-amber-900 leading-relaxed pt-0.5">{text}</p>
    </div>
  )
}

// ---------- Loading skeleton ----------

function SopSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 md:p-14 animate-pulse">
      <div className="mb-8 pb-8 border-b border-gray-100">
        <div className="h-3 w-48 bg-gray-200 rounded mb-4" />
        <div className="h-8 w-3/4 bg-gray-200 rounded mb-2" />
        <div className="h-8 w-1/2 bg-gray-200 rounded mb-6" />
        <div className="flex gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-4 w-20 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
      <div className="space-y-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-gray-50 rounded-xl p-6">
            <div className="h-5 w-32 bg-gray-200 rounded-full mb-4" />
            <div className="space-y-2">
              <div className="h-3 w-full bg-gray-200 rounded" />
              <div className="h-3 w-11/12 bg-gray-200 rounded" />
              <div className="h-3 w-4/5 bg-gray-200 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- Empty state ----------

function EmptyState() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 px-6 py-20 text-center">
      <div className="relative inline-block mb-5">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 flex items-center justify-center">
          <FileText className="w-9 h-9 text-indigo-400" />
        </div>
        <div className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full bg-white shadow-sm flex items-center justify-center border border-purple-100">
          <Sparkles className="w-3.5 h-3.5 text-purple-500" />
        </div>
      </div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">No SOP yet</h3>
      <p className="text-sm text-gray-500 max-w-xs mx-auto leading-relaxed">
        Pick an employee and a category above, then hit Generate to build one from
        their last 7 days of captures.
      </p>
    </div>
  )
}

// ---------- Plain-text export for the Copy button ----------

function sopToPlainText(sop: Sop, meta: SopMeta | null): string {
  const lines: string[] = []
  lines.push('STANDARD OPERATING PROCEDURE')
  lines.push(sop.title.toUpperCase())
  if (meta)
    lines.push(
      `${meta.category} · ${meta.employee} · Generated ${new Date(meta.generated_at).toLocaleDateString()}`
    )
  lines.push('')
  lines.push('OVERVIEW')
  lines.push(sop.overview)
  lines.push('')
  lines.push('TRIGGER')
  lines.push(sop.trigger)
  lines.push('')
  lines.push('STEP-BY-STEP PROCESS')
  sop.steps.forEach((s, i) => lines.push(`${i + 1}. ${s.replace(/^\d+\.\s*/, '')}`))
  lines.push('')
  lines.push('SOFTWARE USED')
  sop.software.forEach((s) => lines.push(`- ${s}`))
  lines.push('')
  lines.push('TIME ESTIMATE')
  lines.push(sop.time_estimate)
  lines.push('')
  lines.push('AUTOMATION OPPORTUNITIES')
  sop.automation_opportunities.forEach((a) => lines.push(`- ${a}`))
  return lines.join('\n')
}
