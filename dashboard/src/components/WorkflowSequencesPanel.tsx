'use client'

/**
 * WorkflowSequencesPanel — displays multi-step workflow chains the
 * detection engine has rolled up from individual captures.
 *
 * Renders below the OpportunitiesTable on the main dashboard. Each
 * sequence card shows the tool chain as a horizontal flow with arrows,
 * plus step count, occurrence count, employees involved, average
 * duration, and confidence score. Sorted by confidence descending.
 *
 * Empty state matches the spec: "Workflow sequences will appear after
 * a few days of team data" — so a fresh deployment doesn't look broken.
 */

import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Clock,
  GitBranch,
  Repeat,
  Users,
  Loader2,
} from 'lucide-react'

type SequenceStep = {
  step_index: number
  tool: string | null
  category: string | null
  task: string | null
  captured_at: string
  employee_id: string | null
}

type SequenceEmployee = {
  id: string
  name: string
  role: string | null
}

type SequenceRow = {
  id: string
  started_at: string
  ended_at: string
  step_count: number
  tools: string[]
  task_categories: string[]
  occurrence_count: number
  last_seen_at: string
  confidence_score: number
  avg_duration_seconds: number
  sequence_hash: string
  steps: SequenceStep[]
  employees: SequenceEmployee[]
}

export function WorkflowSequencesPanel() {
  const [sequences, setSequences] = useState<SequenceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch('/api/sequences', { cache: 'no-store' })
        const body = await r.json()
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
        if (cancelled) return
        setSequences((body.sequences as SequenceRow[]) ?? [])
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
          <GitBranch className="w-3.5 h-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Workflow sequences
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Multi-step chains the team performs together — these are the
            highest-value automation candidates because they span tools.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="px-6 py-10 text-center">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
        </div>
      ) : error ? (
        <div className="px-6 py-8 text-center text-sm text-red-700">{error}</div>
      ) : sequences.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="divide-y divide-gray-50">
          {sequences.map((seq) => (
            <SequenceCard key={seq.id} seq={seq} />
          ))}
        </div>
      )}
    </div>
  )
}

function SequenceCard({ seq }: { seq: SequenceRow }) {
  const confidencePct = Math.round(seq.confidence_score * 100)
  const durationText = formatDuration(seq.avg_duration_seconds)
  // De-dup adjacent identical tools for display so a "WellSky → WellSky →
  // Excel" rendering doesn't look weird. The DB row preserves the raw
  // per-step list; this is purely a cleanup for the chain pill row.
  const displayTools = seq.tools.length > 0 ? seq.tools : []

  return (
    <div className="px-6 py-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div
          className="flex items-center gap-1 flex-wrap"
          title={seq.task_categories.filter(Boolean).join(' → ')}
        >
          {displayTools.map((tool, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-gray-100 text-gray-800 border border-gray-200">
                {tool || 'Unknown'}
              </span>
              {i < displayTools.length - 1 && (
                <ArrowRight className="w-3 h-3 text-gray-400" />
              )}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <Repeat className="w-3 h-3 text-gray-400" />
          {seq.occurrence_count}× observed
        </span>
        <span className="text-gray-300">·</span>
        <span>{seq.step_count} steps</span>
        {seq.employees.length > 0 && (
          <>
            <span className="text-gray-300">·</span>
            <span className="inline-flex items-center gap-1">
              <Users className="w-3 h-3 text-gray-400" />
              {seq.employees.length === 1
                ? seq.employees[0].name
                : `${seq.employees.length} employees`}
            </span>
          </>
        )}
        {durationText && (
          <>
            <span className="text-gray-300">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3 text-gray-400" />
              {durationText} avg
            </span>
          </>
        )}
        <span className="text-gray-300">·</span>
        <span
          className={`font-medium ${
            confidencePct >= 80
              ? 'text-emerald-700'
              : confidencePct >= 70
              ? 'text-amber-700'
              : 'text-gray-600'
          }`}
        >
          {confidencePct}% confidence
        </span>
      </div>
    </div>
  )
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 30) return ''
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const remainder = mins % 60
  return remainder ? `${hrs}h ${remainder}m` : `${hrs}h`
}

function EmptyState() {
  return (
    <div className="px-6 py-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-50 via-violet-50 to-purple-50 flex items-center justify-center mx-auto mb-4">
        <GitBranch className="w-6 h-6 text-indigo-500" />
      </div>
      <p className="text-sm font-medium text-gray-900 mb-1">
        No workflow sequences detected yet
      </p>
      <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
        Workflow sequences will appear after a few days of team data. The
        engine looks for multi-step chains (e.g. WellSky → Excel → Outlook)
        that recur across sessions and surface high-value automation
        candidates that span tools.
      </p>
    </div>
  )
}
