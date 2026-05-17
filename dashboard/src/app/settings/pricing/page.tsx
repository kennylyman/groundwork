'use client'

import { useEffect, useMemo, useState } from 'react'
import { DollarSign, Save, Loader2, CheckCircle2, AlertCircle, Plus, X } from 'lucide-react'

const DEFAULT_RATES: Record<string, number> = {
  owner: 50,
  manager: 35,
  administrator: 25,
  admin: 25,
  scheduler: 24,
  billing: 28,
  caregiver: 20,
}

type RateRow = { role: string; rate: number }

export default function PricingSettingsPage() {
  const [rows, setRows] = useState<RateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/settings/rates')
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      const stored = (body.rates as Record<string, number>) ?? {}
      // Show defaults for roles the owner hasn't customized.
      const merged: Record<string, number> = { ...DEFAULT_RATES, ...stored }
      setRows(
        Object.entries(merged)
          .map(([role, rate]) => ({ role, rate }))
          .sort((a, b) => a.role.localeCompare(b.role))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown')
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const rates: Record<string, number> = {}
      for (const row of rows) {
        const role = row.role.trim().toLowerCase()
        if (!role) continue
        if (!Number.isFinite(row.rate) || row.rate < 0) continue
        rates[role] = row.rate
      }
      const r = await fetch('/api/settings/rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown')
    } finally {
      setSaving(false)
    }
  }

  function updateRow(i: number, patch: Partial<RateRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))
  }
  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i))
  }
  function addRow() {
    setRows((r) => [...r, { role: '', rate: 25 }])
  }

  const hasEdits = useMemo(() => savedAt === null, [savedAt])

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
        <Loader2 className="w-5 h-5 text-gray-400 animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <DollarSign className="w-3.5 h-3.5" />
          </div>
          <h2 className="text-sm font-semibold text-gray-900">Hourly rates by role</h2>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed max-w-2xl mb-5">
          Used to estimate annual cost and automation savings. Matches against
          the employee&rsquo;s role with a tolerant substring lookup
          (e.g. &ldquo;Senior Scheduler&rdquo; matches the
          &ldquo;scheduler&rdquo; rate). Leave unset roles at the default.
        </p>

        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-3">
              <input
                type="text"
                value={row.role}
                onChange={(e) => updateRow(i, { role: e.target.value })}
                placeholder="role"
                className="flex-1 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                  $
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={row.rate}
                  onChange={(e) =>
                    updateRow(i, { rate: Number(e.target.value) })
                  }
                  className="w-28 pl-6 pr-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  /hr
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="p-1.5 text-gray-400 hover:text-gray-700 rounded"
                title="Remove"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 mt-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add a role
          </button>
        </div>

        <div className="flex items-center justify-between mt-6 pt-5 border-t border-gray-100">
          <div>
            {savedAt !== null && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Saved
              </div>
            )}
            {error && (
              <div className="flex items-center gap-1.5 text-xs text-red-700">
                <AlertCircle className="w-3.5 h-3.5" />
                {error}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving || !hasEdits}
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
                Save rates
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
