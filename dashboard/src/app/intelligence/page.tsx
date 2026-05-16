'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  TrendingUp,
  Copy,
  Download,
  Sparkles,
  Loader2,
  AlertCircle,
  Zap,
  Wrench,
  BarChart3,
  DollarSign,
  Clock,
  Info,
} from 'lucide-react'
import { supabase, Employee } from '@/lib/supabase'

type Analysis = {
  top_opportunity: {
    title: string
    description: string
    annual_savings_dollars: number
    annual_hours_saved: number
    confidence: 'high' | 'medium' | 'low'
  }
  benchmark: {
    your_position: string
    comparison: string
    best_practice: string
  }
  implementation: {
    effort: 'Low' | 'Medium' | 'High'
    estimated_days: string
    summary: string
  }
}

type Cost = {
  annual_cost_dollars: number
  annual_hours: number
  weekly_hours: number
  hourly_rate_dollars: number
  hourly_rate_source: string
}

type Meta = {
  employee: string | null
  role: string | null
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

function fmtMoney(n: number) {
  return '$' + n.toLocaleString('en-US')
}

function fmtHours(n: number) {
  return n.toLocaleString('en-US') + ' hrs'
}

export default function IntelligencePage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(false)
  const [cost, setCost] = useState<Cost | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
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
    setCost(null)
    setAnalysis(null)
    setMeta(null)
    setLoading(true)
    try {
      const r = await fetch('/api/generate-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, category }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.detail || body.error || `HTTP ${r.status}`)
      setCost(body.cost)
      setAnalysis(body.analysis)
      setMeta(body.meta)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setLoading(false)
    }
  }

  function copyAsText() {
    if (!cost || !analysis || !meta) return
    navigator.clipboard.writeText(reportToText(cost, analysis, meta)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  function downloadPdf() {
    window.print()
  }

  const hasReport = cost && analysis && meta

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
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
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <h1 className="text-sm font-semibold text-gray-900">Process Intelligence</h1>
              <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                Owner view
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8 pb-32">
        {/* Generation card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-8 print:hidden">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            Generate a Process Intelligence Report
          </h2>
          <p className="text-xs text-gray-500 mb-5">
            Pick an employee and a category. We&rsquo;ll calculate the annual cost,
            identify the top automation opportunity, and benchmark against the
            industry.
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
                Analyzing captures…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Report
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

        {loading && <ReportSkeleton />}
        {!loading && hasReport && <Report cost={cost} analysis={analysis} meta={meta} />}
        {!loading && !hasReport && !error && <EmptyState />}
      </div>

      {hasReport && !loading && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-gray-200 px-8 py-3 print:hidden">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="text-xs text-gray-500">
              <span className="font-medium text-gray-700">{meta!.employee}</span>
              {' · '}
              {meta!.category}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyAsText}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? 'Copied' : 'Copy summary'}
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

      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .report-card { break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}

// ---------- Report ----------

function Report({
  cost,
  analysis,
  meta,
}: {
  cost: Cost
  analysis: Analysis
  meta: Meta
}) {
  return (
    <div id="report" className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-200 px-7 py-6 report-card">
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 font-medium mb-2">
          Process Intelligence Report
        </p>
        <h1 className="text-2xl font-semibold text-gray-900 leading-tight mb-1">
          {meta.category}
        </h1>
        <p className="text-sm text-gray-500">
          <span className="font-medium text-gray-700">{meta.employee}</span>
          {meta.role && <span className="text-gray-400"> · {meta.role}</span>}
          <span> · {meta.capture_count} captures over 7 days</span>
          <span> · Generated {new Date(meta.generated_at).toLocaleDateString()}</span>
        </p>
      </div>

      {/* Hero: annual cost */}
      <HeroCostCard cost={cost} category={meta.category} />

      {/* Top opportunity */}
      <OpportunityCard opp={analysis.top_opportunity} hourlyRate={cost.hourly_rate_dollars} />

      {/* Benchmark + Implementation side by side */}
      <div className="grid md:grid-cols-2 gap-6">
        <BenchmarkCard benchmark={analysis.benchmark} />
        <ImplementationCard impl={analysis.implementation} />
      </div>
    </div>
  )
}

// ---------- Hero cost card ----------

function HeroCostCard({ cost, category }: { cost: Cost; category: string }) {
  return (
    <div className="report-card relative overflow-hidden bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl px-8 py-10 text-white">
      <div className="absolute top-0 right-0 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

      <div className="relative">
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/10 border border-white/10 mb-4">
          <DollarSign className="w-3 h-3 text-emerald-300" />
          <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-100">
            Annual Cost
          </span>
        </div>

        <div className="flex items-baseline gap-3 mb-3">
          <span className="text-5xl md:text-6xl font-bold tracking-tight">
            {fmtMoney(cost.annual_cost_dollars)}
          </span>
          <span className="text-sm text-gray-400">/ year</span>
        </div>

        <p className="text-sm text-gray-300 mb-5 max-w-xl leading-relaxed">
          Estimated labor cost of {category.toLowerCase()} for this employee, based
          on 7 days of captured activity.
        </p>

        <div className="grid grid-cols-3 gap-4 max-w-lg">
          <Stat
            icon={Clock}
            label="Annual hours"
            value={fmtHours(cost.annual_hours)}
          />
          <Stat
            icon={BarChart3}
            label="Weekly observed"
            value={`${cost.weekly_hours} hrs`}
          />
          <Stat
            icon={DollarSign}
            label="Rate (est.)"
            value={`${fmtMoney(cost.hourly_rate_dollars)}/hr`}
          />
        </div>

        <p className="text-[11px] text-gray-500 mt-5 flex items-center gap-1">
          <Info className="w-3 h-3" />
          {cost.hourly_rate_source}, 250 working days, captures × 30s.
        </p>
      </div>
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3 text-gray-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
          {label}
        </span>
      </div>
      <p className="text-sm font-semibold text-white">{value}</p>
    </div>
  )
}

// ---------- Top opportunity card ----------

function OpportunityCard({
  opp,
  hourlyRate,
}: {
  opp: Analysis['top_opportunity']
  hourlyRate: number
}) {
  const conf = opp.confidence
  return (
    <div className="report-card bg-white rounded-2xl border-2 border-amber-200 overflow-hidden">
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-7 py-5 border-b border-amber-100 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 mb-1">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-700">
                Top Opportunity
              </span>
              <ConfidencePill conf={conf} />
            </div>
            <h3 className="text-base font-semibold text-gray-900 leading-snug">
              {opp.title}
            </h3>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-0.5">
            Annual Savings
          </p>
          <p className="text-2xl font-bold text-gray-900 leading-tight">
            {fmtMoney(opp.annual_savings_dollars)}
          </p>
          <p className="text-[11px] text-gray-500">
            {fmtHours(opp.annual_hours_saved)} saved · {fmtMoney(hourlyRate)}/hr
          </p>
        </div>
      </div>

      <div className="px-7 py-5">
        <p className="text-[15px] text-gray-700 leading-relaxed">{opp.description}</p>
      </div>
    </div>
  )
}

function ConfidencePill({ conf }: { conf: 'high' | 'medium' | 'low' }) {
  const styles = {
    high: 'bg-emerald-100 text-emerald-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-gray-100 text-gray-600',
  }[conf]
  return (
    <span className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${styles}`}>
      {conf} confidence
    </span>
  )
}

// ---------- Benchmark + Implementation ----------

function BenchmarkCard({ benchmark }: { benchmark: Analysis['benchmark'] }) {
  // Color tone derived from "your_position" — easier for owner to scan.
  const position = benchmark.your_position.toLowerCase()
  const tone = position.includes('above')
    ? 'bg-red-50 text-red-700 border-red-100'
    : position.includes('below')
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : 'bg-gray-50 text-gray-700 border-gray-200'

  return (
    <div className="report-card bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
          <BarChart3 className="w-4 h-4" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">Industry benchmark</h3>
      </div>

      <div className={`inline-block px-3 py-1 rounded-full border text-xs font-semibold mb-4 ${tone}`}>
        {benchmark.your_position}
      </div>

      <p className="text-sm text-gray-700 leading-relaxed mb-4">{benchmark.comparison}</p>

      <div className="pt-4 border-t border-gray-100">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
          Best practice
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">{benchmark.best_practice}</p>
      </div>
    </div>
  )
}

function ImplementationCard({ impl }: { impl: Analysis['implementation'] }) {
  const effortTone = {
    Low: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    Medium: 'bg-amber-50 text-amber-700 border-amber-100',
    High: 'bg-red-50 text-red-700 border-red-100',
  }[impl.effort]

  return (
    <div className="report-card bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center">
          <Wrench className="w-4 h-4" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">Implementation effort</h3>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className={`inline-block px-3 py-1 rounded-full border text-xs font-semibold ${effortTone}`}>
          {impl.effort} effort
        </span>
        <span className="text-xs text-gray-500">·</span>
        <span className="text-xs font-medium text-gray-700">{impl.estimated_days}</span>
      </div>

      <p className="text-sm text-gray-700 leading-relaxed">{impl.summary}</p>
    </div>
  )
}

// ---------- Skeleton ----------

function ReportSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="bg-white rounded-2xl border border-gray-200 px-7 py-6">
        <div className="h-3 w-44 bg-gray-200 rounded mb-3" />
        <div className="h-8 w-2/3 bg-gray-200 rounded mb-2" />
        <div className="h-3 w-1/2 bg-gray-200 rounded" />
      </div>
      <div className="bg-gray-900/90 rounded-2xl px-8 py-10">
        <div className="h-3 w-24 bg-white/10 rounded mb-4" />
        <div className="h-14 w-1/2 bg-white/10 rounded mb-4" />
        <div className="h-3 w-2/3 bg-white/10 rounded mb-6" />
        <div className="grid grid-cols-3 gap-4 max-w-lg">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-white/10 rounded" />
          ))}
        </div>
      </div>
      <div className="bg-white rounded-2xl border-2 border-amber-200 p-6">
        <div className="h-5 w-1/2 bg-gray-200 rounded mb-3" />
        <div className="h-3 w-full bg-gray-200 rounded mb-1.5" />
        <div className="h-3 w-11/12 bg-gray-200 rounded" />
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="h-4 w-40 bg-gray-200 rounded mb-4" />
          <div className="h-3 w-full bg-gray-200 rounded mb-1.5" />
          <div className="h-3 w-3/4 bg-gray-200 rounded" />
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="h-4 w-40 bg-gray-200 rounded mb-4" />
          <div className="h-3 w-full bg-gray-200 rounded mb-1.5" />
          <div className="h-3 w-3/4 bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  )
}

// ---------- Empty state ----------

function EmptyState() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 px-6 py-20 text-center">
      <div className="relative inline-block mb-5">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-50 via-cyan-50 to-blue-50 flex items-center justify-center">
          <TrendingUp className="w-9 h-9 text-emerald-500" />
        </div>
        <div className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full bg-white shadow-sm flex items-center justify-center border border-amber-100">
          <DollarSign className="w-3.5 h-3.5 text-amber-500" />
        </div>
      </div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">
        No report generated yet
      </h3>
      <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">
        Pick an employee and a category above. We&rsquo;ll surface the annual cost,
        top automation opportunity, and how the team compares to industry norms.
      </p>
    </div>
  )
}

// ---------- Plain-text export ----------

function reportToText(cost: Cost, analysis: Analysis, meta: Meta): string {
  const lines: string[] = []
  lines.push('PROCESS INTELLIGENCE REPORT')
  lines.push(meta.category.toUpperCase())
  lines.push(
    `${meta.employee ?? 'Unknown'}${meta.role ? ' · ' + meta.role : ''} · Generated ${new Date(meta.generated_at).toLocaleDateString()}`
  )
  lines.push('')
  lines.push('ANNUAL COST')
  lines.push(`${fmtMoney(cost.annual_cost_dollars)} / year`)
  lines.push(`${fmtHours(cost.annual_hours)} · ${cost.weekly_hours} hrs/week observed · ${fmtMoney(cost.hourly_rate_dollars)}/hr (${cost.hourly_rate_source})`)
  lines.push('')
  lines.push('TOP OPPORTUNITY')
  lines.push(analysis.top_opportunity.title)
  lines.push(`Savings: ${fmtMoney(analysis.top_opportunity.annual_savings_dollars)}/year · ${fmtHours(analysis.top_opportunity.annual_hours_saved)} · ${analysis.top_opportunity.confidence} confidence`)
  lines.push(analysis.top_opportunity.description)
  lines.push('')
  lines.push('BENCHMARK')
  lines.push(analysis.benchmark.your_position)
  lines.push(analysis.benchmark.comparison)
  lines.push(`Best practice: ${analysis.benchmark.best_practice}`)
  lines.push('')
  lines.push('IMPLEMENTATION')
  lines.push(`${analysis.implementation.effort} effort · ${analysis.implementation.estimated_days}`)
  lines.push(analysis.implementation.summary)
  return lines.join('\n')
}
