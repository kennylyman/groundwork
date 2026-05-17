'use client'

import { useState } from 'react'
import {
  Sparkles,
  ArrowRight,
  Check,
  X,
  Clock,
  CheckCircle,
  Info,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { useCapabilities } from '@/lib/capabilities-client'

export type ActivityCluster = {
  label: string
  pct_of_time: number
  software: string[]
  typical_cadence: string
  capabilities_used: string[]
  representative_capture_ids?: string[]
}

export type RoleProfile = {
  id: string
  employee_id: string
  observed_role: string | null
  observed_role_summary: string | null
  role_confidence: number
  stated_role: string | null
  stated_vs_observed_mismatch: boolean
  activity_clusters: ActivityCluster[]
  primary_workflows: string[]
  time_distribution: Record<string, number>
  capture_count_at_run: number
  last_run_at: string
  acknowledged_at: string | null
  acknowledgment_action: 'accepted' | 'dismissed' | null
}

const CLUSTER_PALETTE = [
  'bg-indigo-400',
  'bg-emerald-400',
  'bg-amber-400',
  'bg-rose-400',
  'bg-cyan-400',
  'bg-purple-400',
  'bg-blue-400',
]

function fmtPct(n: number) {
  return `${Math.round(n * 100)}%`
}

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone =
    pct >= 75
      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
      : pct >= 50
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-semibold ${tone}`}
    >
      {pct}% confidence
    </span>
  )
}

export function RoleDiscoveryCard({
  profile,
  onChange,
}: {
  profile: RoleProfile
  onChange?: (next: RoleProfile) => void
}) {
  const [busy, setBusy] = useState<null | 'accept' | 'dismiss'>(null)
  const [error, setError] = useState<string | null>(null)
  const [localAction, setLocalAction] = useState<
    'accepted' | 'dismissed' | null
  >(profile.acknowledgment_action)
  const acknowledged = !!profile.acknowledged_at || !!localAction

  async function act(action: 'accept' | 'dismiss') {
    setBusy(action)
    setError(null)
    try {
      const r = await fetch(
        `/api/employee/${profile.employee_id}/acknowledge-role`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }
      )
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setLocalAction(action === 'accept' ? 'accepted' : 'dismissed')
      onChange?.({
        ...profile,
        acknowledged_at: new Date().toISOString(),
        acknowledgment_action: action === 'accept' ? 'accepted' : 'dismissed',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setBusy(null)
    }
  }

  const stated = profile.stated_role?.trim() || '(none on file)'
  const observed = profile.observed_role?.trim() || '(uncertain)'
  const mismatch = profile.stated_vs_observed_mismatch

  return (
    <div
      className={`rounded-2xl border ${
        acknowledged
          ? 'bg-gray-50 border-gray-200'
          : 'bg-white border-indigo-200 shadow-sm'
      } overflow-hidden`}
    >
      {/* Header strip */}
      <div
        className={`px-6 py-4 border-b ${
          acknowledged
            ? 'border-gray-100'
            : 'bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-100'
        }`}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                acknowledged
                  ? 'bg-gray-200 text-gray-500'
                  : 'bg-indigo-100 text-indigo-600'
              }`}
            >
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-indigo-700">
                {acknowledged ? 'Role discovery' : 'New role discovery'}
              </p>
              <h2 className="text-sm font-semibold text-gray-900">
                {mismatch ? 'What we observed differs from the role on file' : 'Confirms the role on file'}
              </h2>
            </div>
          </div>
          <ConfidencePill value={profile.role_confidence} />
        </div>
      </div>

      {/* Diff */}
      <div className="px-6 py-5">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center mb-5">
          <RoleSide label="Stated" value={stated} muted />
          <ArrowRight className="w-5 h-5 text-gray-300" />
          <RoleSide
            label="Observed"
            value={observed}
            highlight={mismatch && !acknowledged}
          />
        </div>

        {profile.observed_role_summary && (
          <p className="text-sm text-gray-700 leading-relaxed mb-5">
            {profile.observed_role_summary}
          </p>
        )}

        <p className="text-xs text-gray-500 flex items-center gap-1 mb-5">
          <Info className="w-3 h-3" />
          Based on {profile.capture_count_at_run} captures, analyzed{' '}
          {new Date(profile.last_run_at).toLocaleDateString()}.
        </p>

        {/* Activity clusters */}
        {profile.activity_clusters.length > 0 && (
          <div className="mb-5">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
              How they spend their time
            </p>
            {/* Stacked bar */}
            <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-3">
              {profile.activity_clusters.map((c, i) => (
                <div
                  key={i}
                  className={`${CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]}`}
                  style={{ width: `${Math.max(0, c.pct_of_time) * 100}%` }}
                  title={`${c.label} · ${fmtPct(c.pct_of_time)}`}
                />
              ))}
            </div>
            {/* Cluster details */}
            <div className="space-y-2.5">
              {profile.activity_clusters.map((c, i) => (
                <ClusterRow
                  key={i}
                  cluster={c}
                  paletteClass={CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]}
                />
              ))}
            </div>
          </div>
        )}

        {/* Primary workflows */}
        {profile.primary_workflows.length > 0 && (
          <div className="mb-5">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
              Primary workflows
            </p>
            <div className="flex flex-wrap gap-1.5">
              {profile.primary_workflows.map((w, i) => (
                <span
                  key={i}
                  className="text-xs px-2.5 py-1 bg-gray-100 text-gray-700 rounded-md font-medium"
                >
                  {w}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Actions OR acknowledged status */}
        {!acknowledged ? (
          <div className="flex items-center gap-2 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => act('accept')}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {busy === 'accept' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Updating…
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  {mismatch ? `Set role to "${observed}"` : 'Confirm role on file'}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => act('dismiss')}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {busy === 'dismiss' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Dismissing…
                </>
              ) : (
                <>
                  <X className="w-4 h-4" />
                  Dismiss
                </>
              )}
            </button>
            {error && (
              <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-100 px-2.5 py-1.5 rounded-lg ml-auto">
                <AlertCircle className="w-3.5 h-3.5" />
                {error}
              </div>
            )}
          </div>
        ) : (
          <div className="pt-4 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-500">
            {localAction === 'accepted' ? (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                Accepted{profile.acknowledged_at && ` on ${new Date(profile.acknowledged_at).toLocaleDateString()}`}
              </>
            ) : (
              <>
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                Dismissed{profile.acknowledged_at && ` on ${new Date(profile.acknowledged_at).toLocaleDateString()}`}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function RoleSide({
  label,
  value,
  highlight,
  muted,
}: {
  label: string
  value: string
  highlight?: boolean
  muted?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
        {label}
      </p>
      <p
        className={`text-lg font-semibold leading-tight ${
          highlight
            ? 'text-indigo-700'
            : muted
            ? 'text-gray-500'
            : 'text-gray-900'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function ClusterRow({
  cluster,
  paletteClass,
}: {
  cluster: ActivityCluster
  paletteClass: string
}) {
  const { capabilityLabel } = useCapabilities()
  return (
    <div className="flex items-start gap-3">
      <span className={`shrink-0 mt-1 w-2 h-2 rounded-full ${paletteClass}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-gray-900 truncate">{cluster.label}</p>
          <p className="text-sm font-semibold text-gray-700 shrink-0">
            {fmtPct(cluster.pct_of_time)}
          </p>
        </div>
        <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {cluster.typical_cadence && <span>{cluster.typical_cadence}</span>}
          {cluster.software?.length > 0 && (
            <span className="text-gray-400">·</span>
          )}
          {cluster.software?.length > 0 && (
            <span>{cluster.software.join(', ')}</span>
          )}
        </div>
        {cluster.capabilities_used?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {cluster.capabilities_used.slice(0, 6).map((capId) => (
              <span
                key={capId}
                className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium"
              >
                {capabilityLabel(capId)}
              </span>
            ))}
            {cluster.capabilities_used.length > 6 && (
              <span className="text-[10px] text-gray-400">
                +{cluster.capabilities_used.length - 6} more
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
