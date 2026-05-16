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
  TrendingUp,
} from 'lucide-react'
import { supabase, Employee } from '@/lib/supabase'
import {
  SopDocument,
  sopToPlainText,
  type Sop,
  type SopMeta,
} from '@/components/SopDocument'
import {
  IntelligenceReport,
  intelligenceToPlainText,
  type Analysis,
  type Cost,
  type IntelMeta,
} from '@/components/IntelligenceReport'

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

type Tab = 'sop' | 'intelligence'

type SopBundle = { sop: Sop; meta: SopMeta }
type IntelBundle = { cost: Cost; analysis: Analysis; meta: IntelMeta }

export default function SopBuilderPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(false)
  const [sopBundle, setSopBundle] = useState<SopBundle | null>(null)
  const [intelBundle, setIntelBundle] = useState<IntelBundle | null>(null)
  const [sopError, setSopError] = useState<string | null>(null)
  const [intelError, setIntelError] = useState<string | null>(null)
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('sop')
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
      setGeneralError('Pick an employee and a category first.')
      return
    }
    setGeneralError(null)
    setSopBundle(null)
    setIntelBundle(null)
    setSopError(null)
    setIntelError(null)
    setLoading(true)

    const payload = JSON.stringify({ employeeId, category })
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }

    // Fire both in parallel. Use allSettled so a failure on one doesn't
    // kill the other — partial results are still useful.
    const [sopRes, intelRes] = await Promise.allSettled([
      fetch('/api/generate-sop', init).then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.detail || body.error || `HTTP ${r.status}`)
        return body as SopBundle
      }),
      fetch('/api/generate-intelligence', init).then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.detail || body.error || `HTTP ${r.status}`)
        return body as IntelBundle
      }),
    ])

    if (sopRes.status === 'fulfilled') setSopBundle(sopRes.value)
    else setSopError(sopRes.reason instanceof Error ? sopRes.reason.message : 'unknown error')

    if (intelRes.status === 'fulfilled') setIntelBundle(intelRes.value)
    else setIntelError(intelRes.reason instanceof Error ? intelRes.reason.message : 'unknown error')

    setLoading(false)
  }

  function copyActiveTab() {
    let text: string | null = null
    if (activeTab === 'sop' && sopBundle) {
      text = sopToPlainText(sopBundle.sop, sopBundle.meta)
    } else if (activeTab === 'intelligence' && intelBundle) {
      text = intelligenceToPlainText(intelBundle.cost, intelBundle.analysis, intelBundle.meta)
    }
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  function downloadPdf() {
    window.print()
  }

  const employee = employees.find((e) => e.id === employeeId)
  const hasAnyResult = !!sopBundle || !!intelBundle
  const activeHasContent =
    (activeTab === 'sop' && !!sopBundle) || (activeTab === 'intelligence' && !!intelBundle)
  const activeErr = activeTab === 'sop' ? sopError : intelError

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
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6 print:hidden">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            Generate a new document
          </h2>
          <p className="text-xs text-gray-500 mb-5">
            Pick an employee and a category. We&rsquo;ll pull their last 7 days of
            captures and produce both a frontline <strong>SOP</strong> and an
            owner-facing <strong>Process Intelligence Report</strong>. Switch between
            them with the tabs once they&rsquo;re ready.
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
                Generating both views…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate
              </>
            )}
          </button>

          {generalError && (
            <div className="mt-4 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-xs text-red-700">{generalError}</p>
            </div>
          )}
        </div>

        {/* Tab switcher — shown once we have at least one result or are loading */}
        {(loading || hasAnyResult) && (
          <TabSwitcher
            active={activeTab}
            onChange={setActiveTab}
            sopReady={!!sopBundle}
            sopError={!!sopError}
            intelReady={!!intelBundle}
            intelError={!!intelError}
            loading={loading}
          />
        )}

        {/* Active tab content */}
        {loading && <Skeleton tab={activeTab} />}

        {!loading && activeHasContent && activeTab === 'sop' && sopBundle && (
          <SopDocument sop={sopBundle.sop} meta={sopBundle.meta} employee={employee} />
        )}

        {!loading && activeHasContent && activeTab === 'intelligence' && intelBundle && (
          <IntelligenceReport
            cost={intelBundle.cost}
            analysis={intelBundle.analysis}
            meta={intelBundle.meta}
          />
        )}

        {!loading && !activeHasContent && activeErr && (
          <TabErrorState tab={activeTab} message={activeErr} onRetry={generate} />
        )}

        {!loading && !hasAnyResult && !generalError && !sopError && !intelError && <EmptyState />}
      </div>

      {/* Sticky action bar — only when the active tab has renderable content */}
      {!loading && activeHasContent && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-gray-200 px-8 py-3 print:hidden">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="text-xs text-gray-500">
              <span className="font-medium text-gray-700">
                {sopBundle?.meta.employee ?? intelBundle?.meta.employee}
              </span>
              {' · '}
              {sopBundle?.meta.category ?? intelBundle?.meta.category}
              {' · '}
              <span className="text-gray-400">{activeTab === 'sop' ? 'SOP' : 'Intelligence'}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyActiveTab}
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
          #sop-document, #intelligence-report {
            box-shadow: none !important;
          }
          .sop-section, .report-card { break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}

// ---------- Tab switcher ----------

function TabSwitcher({
  active,
  onChange,
  sopReady,
  sopError,
  intelReady,
  intelError,
  loading,
}: {
  active: Tab
  onChange: (t: Tab) => void
  sopReady: boolean
  sopError: boolean
  intelReady: boolean
  intelError: boolean
  loading: boolean
}) {
  return (
    <div className="mb-6 flex items-center gap-1 p-1 bg-gray-100 rounded-xl w-fit print:hidden">
      <TabButton
        active={active === 'sop'}
        onClick={() => onChange('sop')}
        icon={<FileText className="w-3.5 h-3.5" />}
        label="SOP"
        sublabel="Frontline"
        ready={sopReady}
        errored={sopError}
        loading={loading}
      />
      <TabButton
        active={active === 'intelligence'}
        onClick={() => onChange('intelligence')}
        icon={<TrendingUp className="w-3.5 h-3.5" />}
        label="Intelligence"
        sublabel="Owner"
        ready={intelReady}
        errored={intelError}
        loading={loading}
      />
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  sublabel,
  ready,
  errored,
  loading,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  sublabel: string
  ready: boolean
  errored: boolean
  loading: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-white text-gray-900 shadow-sm'
          : 'text-gray-600 hover:text-gray-900'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className={`text-[10px] uppercase tracking-wider font-semibold ${active ? 'text-gray-400' : 'text-gray-400'}`}>
        {sublabel}
      </span>
      {loading && !ready && !errored && (
        <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
      )}
      {errored && (
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Failed to generate" />
      )}
    </button>
  )
}

// ---------- Skeleton (varies by tab) ----------

function Skeleton({ tab }: { tab: Tab }) {
  if (tab === 'intelligence') return <IntelligenceSkeleton />
  return <SopSkeleton />
}

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
        {[1, 2, 3, 4, 5].map((i) => (
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

function IntelligenceSkeleton() {
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

// ---------- Per-tab error state ----------

function TabErrorState({
  tab,
  message,
  onRetry,
}: {
  tab: Tab
  message: string
  onRetry: () => void
}) {
  const label = tab === 'sop' ? 'SOP' : 'Intelligence Report'
  return (
    <div className="bg-white rounded-2xl border border-red-100 px-6 py-10 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
        <AlertCircle className="w-5 h-5 text-red-500" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        {label} failed to generate
      </h3>
      <p className="text-xs text-gray-500 mb-4 max-w-md mx-auto leading-relaxed">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-xs font-medium text-gray-700 bg-gray-100 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
      >
        Try again
      </button>
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
      <h3 className="text-base font-semibold text-gray-900 mb-1">No document yet</h3>
      <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">
        Pick an employee and a category above, then hit Generate. We&rsquo;ll build
        both a frontline SOP and an owner-facing Process Intelligence Report from
        their last 7 days of captures.
      </p>
    </div>
  )
}
