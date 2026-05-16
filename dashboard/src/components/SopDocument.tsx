'use client'

import {
  BookOpen,
  Bell,
  ListChecks,
  Layers,
  Clock,
  Calendar,
  User,
  Tag,
  BarChart3,
} from 'lucide-react'
import type { Employee } from '@/lib/supabase'

export type Sop = {
  title: string
  overview: string
  trigger: string
  steps: string[]
  software: string[]
  time_estimate: string
}

export type SopMeta = {
  employee: string
  category: string
  capture_count: number
  generated_at: string
  model: string
}

export function SopDocument({
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
      <header className="mb-8 pb-8 border-b border-gray-100">
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 font-medium mb-3">
          Standard Operating Procedure
        </p>
        <h1 className="text-3xl font-semibold text-gray-900 leading-tight tracking-tight">
          {sop.title}
        </h1>
        <MetadataRow meta={meta} employee={employee} />
      </header>

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
      </div>
    </div>
  )
}

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

export function sopToPlainText(sop: Sop, meta: SopMeta | null): string {
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
  return lines.join('\n')
}
