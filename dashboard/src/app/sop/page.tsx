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
    const text = sopToPlainText(sop, meta)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  function downloadPdf() {
    // Native print → "Save as PDF" in the system dialog. The print stylesheet
    // hides everything except the SOP body so the output is clean.
    window.print()
  }

  const employeeName = employees.find((e) => e.id === employeeId)?.name

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header — hidden in print */}
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

      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Inputs — hidden in print */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 print:hidden">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Generate a new SOP</h2>
          <p className="text-xs text-gray-500 mb-5">
            Pick an employee and a category. We&rsquo;ll pull their captures from the last
            7 days and synthesize a Standard Operating Procedure.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                Employee
              </label>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-gray-400"
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
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-gray-400"
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

        {/* SOP output */}
        {sop && (
          <div
            id="sop-document"
            className="bg-white rounded-xl border border-gray-200 p-8 print:border-0 print:rounded-none print:p-0 print:shadow-none"
          >
            {/* Action bar — hidden in print */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100 print:hidden">
              <div className="text-xs text-gray-500">
                {meta && (
                  <>
                    <span className="font-medium text-gray-700">{meta.employee}</span>
                    {' · '}
                    {meta.category}
                    {' · '}
                    {meta.capture_count} captures
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyAsText}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={downloadPdf}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download as PDF
                </button>
              </div>
            </div>

            {/* Document */}
            <article className="prose-sop">
              <header className="mb-8">
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
                  Standard Operating Procedure
                </p>
                <h1 className="text-2xl font-semibold text-gray-900 mb-2 leading-tight">
                  {sop.title}
                </h1>
                {meta && (
                  <p className="text-xs text-gray-400">
                    {meta.category} · Generated {new Date(meta.generated_at).toLocaleDateString()}
                  </p>
                )}
              </header>

              <SopSection title="Overview">
                <p className="text-sm text-gray-700 leading-relaxed">{sop.overview}</p>
              </SopSection>

              <SopSection title="Trigger">
                <p className="text-sm text-gray-700 leading-relaxed">{sop.trigger}</p>
              </SopSection>

              <SopSection title="Step-by-step process">
                <ol className="space-y-2 list-none pl-0">
                  {sop.steps.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm text-gray-700 leading-relaxed">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-semibold flex items-center justify-center mt-0.5">
                        {i + 1}
                      </span>
                      <span>{step.replace(/^\d+\.\s*/, '')}</span>
                    </li>
                  ))}
                </ol>
              </SopSection>

              <SopSection title="Software used">
                <ul className="flex flex-wrap gap-2 list-none pl-0">
                  {sop.software.map((s) => (
                    <li
                      key={s}
                      className="text-xs px-2.5 py-1 bg-gray-100 text-gray-700 rounded-md font-medium"
                    >
                      {s}
                    </li>
                  ))}
                </ul>
              </SopSection>

              <SopSection title="Time estimate">
                <p className="text-sm text-gray-700 leading-relaxed">{sop.time_estimate}</p>
              </SopSection>

              <SopSection title="Automation opportunities">
                <ul className="space-y-2 list-disc pl-5 marker:text-amber-500">
                  {sop.automation_opportunities.map((a, i) => (
                    <li key={i} className="text-sm text-gray-700 leading-relaxed">
                      {a}
                    </li>
                  ))}
                </ul>
              </SopSection>
            </article>
          </div>
        )}

        {!sop && !loading && !error && (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-16 text-center">
            <FileText className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No SOP yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Pick an employee and category above to generate one.
            </p>
          </div>
        )}
      </div>

      {/* Print stylesheet — only the SOP document, no chrome, no shadows */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          #sop-document { max-width: 100% !important; }
        }
      `}</style>
    </div>
  )
}

function SopSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        {title}
      </h2>
      {children}
    </section>
  )
}

function sopToPlainText(sop: Sop, meta: SopMeta | null): string {
  const lines: string[] = []
  lines.push('STANDARD OPERATING PROCEDURE')
  lines.push(sop.title.toUpperCase())
  if (meta) lines.push(`${meta.category} — Generated ${new Date(meta.generated_at).toLocaleDateString()}`)
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
