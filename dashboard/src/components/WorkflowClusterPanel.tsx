/**
 * WorkflowClusterPanel — slide-in side panel that shows the full detail
 * of a clicked automation cluster.
 *
 * Read-only for now. Phase 5 will add "Build this automation" actions; v1
 * is pure intelligence display. The panel surfaces:
 *
 *   - Cluster headline + ROI
 *   - Each participating employee with their specific matching task and
 *     similarity score
 *   - Capability tags (so owners see what kind of automation this is)
 *   - Confidence + automation class
 */
'use client'

import { useEffect, useState } from 'react'
import { X, Users, Clock, DollarSign, Zap, TrendingUp, Sparkles } from 'lucide-react'
import { useCapabilities } from '@/lib/capabilities-client'
import { supabase, type CaptureEnrichments } from '@/lib/supabase'
import { CaptureEnrichmentSummary } from './CaptureEnrichmentSummary'
import type {
  EmployeeNode,
  WorkflowCluster,
} from '@/lib/workflow-intelligence-types'

const CLASS_LABEL: Record<string, string> = {
  A: 'Zapier-able',
  B: 'Composed agent',
  C: 'Custom build',
}

const CLASS_DESCRIPTION: Record<string, string> = {
  A: 'Single trigger and action between named tools. Ready for a Zap or native integration.',
  B: 'Multi-step workflow with intermediate reasoning. Needs a composed agent.',
  C: 'Unusual data shapes or APIs. Will need a custom integration.',
}

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US')
}

type EnrichmentByPair = Record<string, CaptureEnrichments | null>

export function WorkflowClusterPanel({
  cluster,
  employees,
  onClose,
}: {
  cluster: WorkflowCluster
  employees: EmployeeNode[]
  onClose: () => void
}) {
  const { capabilityLabel } = useCapabilities()
  const empById = new Map(employees.map((e) => [e.id, e]))
  const confidencePct = Math.round(cluster.confidence * 100)
  // Live tool context per matching task — fetched on panel open. Most
  // panels are never opened; we keep workflow-intelligence cache small
  // by deferring this enrichment lookup to the moment the owner asks
  // for detail.
  const [enrichmentByPair, setEnrichmentByPair] = useState<EnrichmentByPair>({})
  const [enrichmentsLoading, setEnrichmentsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadEnrichments() {
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      // Pull the most recent enriched capture per (employee_id, task) pair
      // in the cluster. One query per pair (bounded ~6 per cluster); fast
      // because the partial index on (business_id, captured_at desc) WHERE
      // capture_enrichments IS NULL only excludes nulls — the reverse query
      // (NOT NULL) still scans the same hot index, just inverts the filter.
      const results = await Promise.all(
        cluster.matching_tasks.map(async (mt) => {
          const { data } = await supabase
            .from('captures')
            .select('capture_enrichments, captured_at')
            .eq('employee_id', mt.employee_id)
            .eq('task', mt.task)
            .gte('captured_at', since)
            .not('capture_enrichments', 'is', null)
            .order('captured_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          return {
            key: `${mt.employee_id}::${mt.task}`,
            enrichments:
              (data?.capture_enrichments as CaptureEnrichments | null) ?? null,
          }
        })
      )
      if (cancelled) return
      const next: EnrichmentByPair = {}
      for (const r of results) next[r.key] = r.enrichments
      setEnrichmentByPair(next)
      setEnrichmentsLoading(false)
    }
    void loadEnrichments()
    return () => {
      cancelled = true
    }
  }, [cluster.id, cluster.matching_tasks])

  // Aggregate enrichments across all matching tasks for the "what we're
  // seeing live" rollup at the top of the panel.
  const aggregatedEnrichments = (() => {
    const merged: CaptureEnrichments = {}
    for (const enrich of Object.values(enrichmentByPair)) {
      if (!enrich) continue
      for (const [k, v] of Object.entries(enrich)) {
        if (!merged[k]) merged[k] = v
      }
    }
    return Object.keys(merged).length > 0 ? merged : null
  })()

  return (
    <>
      {/* Backdrop — click to close */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      <aside
        className="fixed right-0 top-0 bottom-0 w-full max-w-md z-50 bg-gray-950 border-l border-gray-800 shadow-2xl overflow-y-auto"
        style={{ color: '#fff' }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-300/80">
                Automation cluster
              </p>
              <h2 className="text-base font-semibold leading-tight mt-1">
                {cluster.label}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 shrink-0"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5 text-gray-300" />
            </button>
          </div>
          <p className="text-sm text-gray-300 mt-2 leading-relaxed">
            {cluster.description}
          </p>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-2 gap-2 px-5 py-4 border-b border-gray-800">
          <StatTile
            icon={<Users className="w-3.5 h-3.5 text-indigo-300" />}
            label="Participants"
            value={`${cluster.employee_ids.length}`}
          />
          <StatTile
            icon={<Clock className="w-3.5 h-3.5 text-cyan-300" />}
            label="Time / wk"
            value={`${cluster.weekly_minutes} min`}
          />
          <StatTile
            icon={<DollarSign className="w-3.5 h-3.5 text-amber-300" />}
            label="Annual cost"
            value={fmtMoney(cluster.annual_cost)}
          />
          <StatTile
            icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-300" />}
            label="Potential savings"
            value={fmtMoney(cluster.annual_savings)}
            highlight
          />
        </div>

        {/* Confidence + automation class */}
        <div className="px-5 py-4 border-b border-gray-800 space-y-3">
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
                Confidence
              </p>
              <p className="text-xs font-semibold">{confidencePct}%</p>
            </div>
            <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  confidencePct >= 75
                    ? 'bg-emerald-400'
                    : confidencePct >= 50
                    ? 'bg-amber-400'
                    : 'bg-gray-500'
                }`}
                style={{ width: `${confidencePct}%` }}
              />
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Zap className="w-3.5 h-3.5 text-indigo-300 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-white">
                {CLASS_LABEL[cluster.automation_class] ?? cluster.automation_class}
              </p>
              <p className="text-[11px] text-gray-400 leading-relaxed mt-0.5">
                {CLASS_DESCRIPTION[cluster.automation_class] ?? ''}
              </p>
            </div>
          </div>
        </div>

        {/* Live tool context — rendered above matching tasks when any of
            the matching captures had OAuth-enriched data (Slack channel
            messages, calendar events around capture time, unread email
            samples). Helps the owner see the actual workflow, not just
            the screen-text classification. */}
        {(aggregatedEnrichments || enrichmentsLoading) && (
          <div className="px-5 py-4 border-b border-gray-800">
            <div className="flex items-center gap-2 mb-2.5">
              <Sparkles className="w-3 h-3 text-emerald-300" />
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
                Live context from connected tools
              </p>
            </div>
            {enrichmentsLoading ? (
              <p className="text-[11px] text-gray-500">Loading...</p>
            ) : aggregatedEnrichments ? (
              <CaptureEnrichmentSummary
                enrichments={aggregatedEnrichments}
                variant="panel"
              />
            ) : null}
          </div>
        )}

        {/* Matching tasks per employee */}
        <div className="px-5 py-4 border-b border-gray-800">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-2.5">
            Matching tasks
          </p>
          <div className="space-y-2.5">
            {cluster.matching_tasks.map((mt, i) => {
              const emp = empById.get(mt.employee_id)
              const simPct = Math.round(mt.similarity * 100)
              return (
                <div
                  key={i}
                  className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-[9px] font-semibold shrink-0">
                        {emp?.initials ?? '?'}
                      </div>
                      <p className="text-xs font-medium text-white truncate">
                        {emp?.name ?? 'Unknown'}
                      </p>
                      {emp?.role && (
                        <p className="text-[10px] text-gray-500 truncate">
                          · {emp.role}
                        </p>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 shrink-0">
                      <span className="text-emerald-300">{simPct}%</span> match
                    </p>
                  </div>
                  <p className="text-[11px] text-gray-300 mt-1.5 leading-relaxed">
                    "{mt.task}"
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Capabilities */}
        {cluster.capabilities.length > 0 && (
          <div className="px-5 py-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-2">
              What kind of work this is
            </p>
            <div className="flex flex-wrap gap-1.5">
              {cluster.capabilities.map((capId) => (
                <span
                  key={capId}
                  className="text-[11px] px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-200"
                >
                  {capabilityLabel(capId)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Footer note — read-only for now */}
        <div className="px-5 py-4 border-t border-gray-800 mt-4">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            This is a read-only view for now. "Build this automation"
            actions arrive in the next phase — for now, use this analysis
            to scope the work or hand it to your integrations team.
          </p>
        </div>
      </aside>
    </>
  )
}

function StatTile({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-lg px-3 py-2.5 border ${
        highlight
          ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-gray-900/60 border-gray-800'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
          {label}
        </p>
      </div>
      <p
        className={`text-base font-semibold mt-1 ${
          highlight ? 'text-amber-300' : 'text-white'
        }`}
      >
        {value}
      </p>
    </div>
  )
}
