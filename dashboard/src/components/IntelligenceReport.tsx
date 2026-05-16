'use client'

import {
  Zap,
  Wrench,
  BarChart3,
  DollarSign,
  Clock,
  Info,
} from 'lucide-react'

export type Analysis = {
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

export type Cost = {
  annual_cost_dollars: number
  annual_hours: number
  weekly_hours: number
  hourly_rate_dollars: number
  hourly_rate_source: string
}

export type IntelMeta = {
  employee: string | null
  role: string | null
  category: string
  capture_count: number
  generated_at: string
  model: string
}

function fmtMoney(n: number) {
  return '$' + n.toLocaleString('en-US')
}

function fmtHours(n: number) {
  return n.toLocaleString('en-US') + ' hrs'
}

export function IntelligenceReport({
  cost,
  analysis,
  meta,
}: {
  cost: Cost
  analysis: Analysis
  meta: IntelMeta
}) {
  return (
    <div id="intelligence-report" className="space-y-6">
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

      <HeroCostCard cost={cost} category={meta.category} />
      <OpportunityCard opp={analysis.top_opportunity} hourlyRate={cost.hourly_rate_dollars} />

      <div className="grid md:grid-cols-2 gap-6">
        <BenchmarkCard benchmark={analysis.benchmark} />
        <ImplementationCard impl={analysis.implementation} />
      </div>
    </div>
  )
}

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

function OpportunityCard({
  opp,
  hourlyRate,
}: {
  opp: Analysis['top_opportunity']
  hourlyRate: number
}) {
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
              <ConfidencePill conf={opp.confidence} />
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

function BenchmarkCard({ benchmark }: { benchmark: Analysis['benchmark'] }) {
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

export function intelligenceToPlainText(
  cost: Cost,
  analysis: Analysis,
  meta: IntelMeta
): string {
  const lines: string[] = []
  lines.push('PROCESS INTELLIGENCE REPORT')
  lines.push(meta.category.toUpperCase())
  lines.push(
    `${meta.employee ?? 'Unknown'}${meta.role ? ' · ' + meta.role : ''} · Generated ${new Date(meta.generated_at).toLocaleDateString()}`
  )
  lines.push('')
  lines.push('ANNUAL COST')
  lines.push(`${fmtMoney(cost.annual_cost_dollars)} / year`)
  lines.push(
    `${fmtHours(cost.annual_hours)} · ${cost.weekly_hours} hrs/week observed · ${fmtMoney(cost.hourly_rate_dollars)}/hr (${cost.hourly_rate_source})`
  )
  lines.push('')
  lines.push('TOP OPPORTUNITY')
  lines.push(analysis.top_opportunity.title)
  lines.push(
    `Savings: ${fmtMoney(analysis.top_opportunity.annual_savings_dollars)}/year · ${fmtHours(analysis.top_opportunity.annual_hours_saved)} · ${analysis.top_opportunity.confidence} confidence`
  )
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
