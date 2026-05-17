'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Package,
  ShieldAlert,
  Users,
  AlertTriangle,
  Sparkles,
} from 'lucide-react'

type Release = {
  version: string
  download_url: string
  sha256: string
  release_notes: string | null
  is_latest: boolean
  is_min_supported: boolean
  released_at: string
  employee_count: number
}

type Orphan = { version: string; orphan: true; employee_count: number }

type Payload = {
  releases: Release[]
  orphans: Orphan[]
  unknown_employee_count: number
  total_active_employees: number
}

export default function ReleasesSettingsPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyVersion, setBusyVersion] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/settings/releases', { cache: 'no-store' })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setData(body as Payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function setMinSupported(version: string | null) {
    setBusyVersion(version ?? '__clear__')
    setError(null)
    setFlash(null)
    try {
      const r = await fetch('/api/settings/releases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_min_supported', version }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setFlash(
        version === null
          ? 'Cleared minimum supported version'
          : `Set v${version} as minimum supported`
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setBusyVersion(null)
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-12 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading releases...
      </div>
    )
  }

  const total = data?.total_active_employees ?? 0
  const unknown = data?.unknown_employee_count ?? 0
  const releases = data?.releases ?? []
  const orphans = data?.orphans ?? []
  const minSupported = releases.find((r) => r.is_min_supported)?.version ?? null
  const latest = releases.find((r) => r.is_latest)?.version ?? null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-gray-500" />
            Agent releases
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-xl leading-relaxed">
            Version history for the Windows agent. New builds are published
            automatically by CI. Use "minimum supported" to force every
            agent below that version to update on its next startup.
          </p>
        </div>
        {flash && (
          <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {flash}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}
      </div>

      {/* Top-of-page summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          icon={<Sparkles className="w-4 h-4 text-indigo-500" />}
          label="Latest"
          value={latest ? `v${latest}` : 'none yet'}
          hint={latest ? 'Auto-promoted by CI' : 'No release published'}
        />
        <SummaryCard
          icon={<ShieldAlert className="w-4 h-4 text-amber-500" />}
          label="Min supported"
          value={minSupported ? `v${minSupported}` : 'not set'}
          hint={
            minSupported
              ? 'Agents below this force-update'
              : 'No floor — soft updates only'
          }
        />
        <SummaryCard
          icon={<Users className="w-4 h-4 text-gray-500" />}
          label="Active agents"
          value={`${total}`}
          hint={
            unknown > 0
              ? `${unknown} haven't checked in yet`
              : 'All accounted for'
          }
        />
      </div>

      {/* Releases table */}
      {releases.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <Package className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-900">
            No releases registered yet
          </p>
          <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
            The next merge to <code className="text-gray-700">main</code> will
            build the agent, compute its SHA256, and register a release here
            automatically.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Version</th>
                <th className="px-4 py-2.5 text-left font-medium">Released</th>
                <th className="px-4 py-2.5 text-left font-medium">On version</th>
                <th className="px-4 py-2.5 text-left font-medium">Flags</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {releases.map((r) => (
                <ReleaseRowView
                  key={r.version}
                  release={r}
                  totalActive={total}
                  busy={busyVersion === r.version}
                  onSetMinSupported={() => setMinSupported(r.version)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Floor controls */}
      {minSupported && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-amber-800">
            <ShieldAlert className="w-4 h-4" />
            Minimum supported: <span className="font-semibold">v{minSupported}</span>
          </div>
          <button
            type="button"
            onClick={() => setMinSupported(null)}
            disabled={busyVersion === '__clear__'}
            className="text-xs px-3 py-1.5 rounded-lg bg-white border border-amber-200 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            {busyVersion === '__clear__' ? 'Clearing...' : 'Clear floor'}
          </button>
        </div>
      )}

      {/* Orphan / unknown surface */}
      {(orphans.length > 0 || unknown > 0) && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-gray-700 font-medium mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Agents on un-registered versions
          </div>
          <ul className="space-y-1 text-xs text-gray-600">
            {orphans.map((o) => (
              <li key={o.version}>
                <code className="text-gray-800">v{o.version}</code> — {o.employee_count} agent
                {o.employee_count === 1 ? '' : 's'} (no release row — old build?)
              </li>
            ))}
            {unknown > 0 && (
              <li>
                No version reported yet — {unknown} agent{unknown === 1 ? '' : 's'} (likely
                installed pre-update-system)
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1">
        {icon}
        {label}
      </div>
      <p className="text-base font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
    </div>
  )
}

function ReleaseRowView({
  release,
  totalActive,
  busy,
  onSetMinSupported,
}: {
  release: Release
  totalActive: number
  busy: boolean
  onSetMinSupported: () => void
}) {
  const pct =
    totalActive > 0 ? Math.round((release.employee_count / totalActive) * 100) : 0
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <code className="text-sm font-mono text-gray-900">v{release.version}</code>
          {release.release_notes && (
            <span className="text-xs text-gray-500 truncate max-w-xs">
              {release.release_notes}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500">
        {new Date(release.released_at).toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gray-700 rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-gray-700 font-medium">
            {release.employee_count}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {release.is_latest && (
            <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-100">
              Latest
            </span>
          )}
          {release.is_min_supported && (
            <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-100">
              Min supported
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        {!release.is_min_supported && (
          <button
            type="button"
            onClick={onSetMinSupported}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? 'Setting...' : 'Force update floor'}
          </button>
        )}
      </td>
    </tr>
  )
}
