'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Plug,
  CheckCircle2,
  Eye,
  Zap,
  Boxes,
  Copy,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react'
import { TOOL_BY_ID, TOOL_REGISTRY } from '@/lib/integrations'

type Ring = 1 | 2 | 3

type IntegrationRow = {
  id: string
  tool_name: string
  ring: Ring
  status: 'detected' | 'pending' | 'connected' | 'error' | 'disconnected'
  connected_at: string | null
  last_event_at: string | null
  event_count: number
  config: Record<string, unknown>
  external_account_label: string | null
  token_expires_at: string | null
}

type DetectedTool = {
  tool_id: string
  tool_label: string
  capture_count_7d: number
  category: string
}

type IntakeTool = {
  tool_id: string
  tool_label: string
  used_for: string[]
}

type StateResponse = {
  business_id: string
  business_name: string
  integrations: IntegrationRow[]
  detected_tools: DetectedTool[]
  intake_tools: IntakeTool[]
  native_tools: string[]
}

type ToolEntry = {
  tool_id: string
  tool_label: string
  capture_count_7d: number
  in_intake: boolean
  in_intake_used_for: string[]
  rings: {
    1: IntegrationRow | null
    2: IntegrationRow | null
    3: IntegrationRow | null
  }
  capabilities: string[]
  ring2Available: boolean
  ring3Available: boolean
  native: boolean
}

export default function IntegrationsSettingsPage() {
  // useSearchParams forces dynamic rendering at the boundary; wrap the
  // OAuth-callback-aware inner component in Suspense so the rest of the
  // settings shell can prerender.
  return (
    <Suspense fallback={<IntegrationsLoading />}>
      <IntegrationsSettingsInner />
    </Suspense>
  )
}

function IntegrationsLoading() {
  return (
    <div className="px-6 py-12 text-center">
      <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
    </div>
  )
}

function IntegrationsSettingsInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [state, setState] = useState<StateResponse | null>(null)
  const [secret, setSecret] = useState<{ secret: string; webhook_url: string } | null>(null)
  const [loadingState, setLoadingState] = useState(true)
  const [loadingSecret, setLoadingSecret] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [expandedTool, setExpandedTool] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showZapierFallback, setShowZapierFallback] = useState(false)

  // Surface OAuth callback redirects (?connected=slack&account=Acme or ?error=...)
  useEffect(() => {
    const connected = searchParams.get('connected')
    const account = searchParams.get('account')
    const err = searchParams.get('error')
    if (connected) {
      const label = TOOL_BY_ID[connected]?.label || connected
      setFlash(
        `${label} connected${account ? ` — workspace: ${account}` : ''}`
      )
      router.replace('/settings/integrations')
    } else if (err) {
      setError(err)
      router.replace('/settings/integrations')
    }
  }, [searchParams, router])

  useEffect(() => {
    void loadState()
  }, [])

  async function loadState() {
    setLoadingState(true)
    setError(null)
    try {
      const r = await fetch('/api/integrations/state', { cache: 'no-store' })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setState(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setLoadingState(false)
    }
  }

  async function loadSecret() {
    setLoadingSecret(true)
    try {
      const r = await fetch('/api/integrations/secret')
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setSecret(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setLoadingSecret(false)
    }
  }

  /** Native OAuth: full-page redirect to /api/integrations/oauth/<tool>.
   *  Browser follows redirects to the provider, user authorizes, callback
   *  brings them back here with ?connected= or ?error=. */
  function connectNative(toolId: string) {
    setBusy(`${toolId}:3:connect`)
    window.location.href = `/api/integrations/oauth/${toolId}`
  }

  async function disconnectNative(toolId: string) {
    setBusy(`${toolId}:3:disconnect`)
    setError(null)
    try {
      const r = await fetch('/api/integrations/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_name: toolId, ring: 3, action: 'disconnect' }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      await loadState()
      setFlash(`Disconnected ${TOOL_BY_ID[toolId]?.label || toolId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setBusy(null)
    }
  }

  async function toggleZapierConnect(
    tool_id: string,
    action: 'connect' | 'disconnect'
  ) {
    setBusy(`${tool_id}:2:${action}`)
    setError(null)
    try {
      const r = await fetch('/api/integrations/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_name: tool_id, ring: 2, action }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      await loadState()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setBusy(null)
    }
  }

  function copyText(label: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  // ----- Build the unified tool list -----
  const tools: ToolEntry[] = (() => {
    if (!state) return []
    const seen = new Map<string, ToolEntry>()
    const nativeSet = new Set(state.native_tools)

    function ensure(tool_id: string, tool_label: string): ToolEntry {
      const existing = seen.get(tool_id)
      if (existing) return existing
      const def = TOOL_BY_ID[tool_id]
      const fresh: ToolEntry = {
        tool_id,
        tool_label: def?.label || tool_label,
        capture_count_7d: 0,
        in_intake: false,
        in_intake_used_for: [],
        rings: { 1: null, 2: null, 3: null },
        capabilities: def?.capabilities || [],
        ring2Available: def?.ring2Available ?? true,
        ring3Available: nativeSet.has(tool_id),
        native: nativeSet.has(tool_id),
      }
      seen.set(tool_id, fresh)
      return fresh
    }

    // Always show every natively-supported tool so owners discover them
    // even before the agent has captured anything.
    for (const native of state.native_tools) {
      ensure(native, TOOL_BY_ID[native]?.label || native)
    }
    for (const d of state.detected_tools) {
      const t = ensure(d.tool_id, d.tool_label)
      t.capture_count_7d = d.capture_count_7d
    }
    for (const i of state.intake_tools) {
      const t = ensure(i.tool_id, i.tool_label)
      t.in_intake = true
      t.in_intake_used_for = i.used_for
    }
    for (const row of state.integrations) {
      const t = ensure(row.tool_name, TOOL_BY_ID[row.tool_name]?.label || row.tool_name)
      t.rings[row.ring] = row
    }

    return Array.from(seen.values()).sort((a, b) => {
      // Connected (ring 3) first, then native (offering 1-click) next,
      // then connected via Zapier, then by detection volume, then alpha.
      const a3 = a.rings[3]?.status === 'connected'
      const b3 = b.rings[3]?.status === 'connected'
      if (a3 !== b3) return a3 ? -1 : 1
      if (a.native !== b.native) return a.native ? -1 : 1
      const a2 = a.rings[2]?.status === 'connected'
      const b2 = b.rings[2]?.status === 'connected'
      if (a2 !== b2) return a2 ? -1 : 1
      if (a.capture_count_7d !== b.capture_count_7d)
        return b.capture_count_7d - a.capture_count_7d
      return a.tool_label.localeCompare(b.tool_label)
    })
  })()

  const nativeTools = tools.filter((t) => t.native)
  const otherTools = tools.filter((t) => !t.native)

  return (
    <div className="space-y-6">
      {/* Flash banner — success or error from OAuth callback */}
      {flash && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-800">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="flex-1">{flash}</span>
          <button
            type="button"
            onClick={() => setFlash(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1 break-all">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900 text-xs shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Native integrations — the primary path */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                One-click integrations
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Connect directly to your tools with a single OAuth. Real-time
                capture enrichment unlocks once the link is in place.
              </p>
            </div>
          </div>
        </div>

        {loadingState ? (
          <div className="px-6 py-12 text-center">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
          </div>
        ) : nativeTools.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-500">
            No native integrations available yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {nativeTools.map((tool) => (
              <NativeToolRow
                key={tool.tool_id}
                tool={tool}
                busy={busy}
                onConnect={() => connectNative(tool.tool_id)}
                onDisconnect={() => disconnectNative(tool.tool_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Other tools list — these can still be connected via Zapier */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center">
              <Boxes className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Other tools detected
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Tools your team uses that we don&rsquo;t natively integrate with yet.
                Connect them via Zapier (below) to surface event data.
              </p>
            </div>
          </div>
        </div>

        {loadingState ? (
          <div className="px-6 py-12 text-center">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
          </div>
        ) : otherTools.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-500">
            No other tools detected yet. Once your team uses tools on a
            Groundwork-instrumented machine, they&rsquo;ll appear here.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {otherTools.map((tool) => (
              <ToolRow
                key={tool.tool_id}
                tool={tool}
                expanded={expandedTool === tool.tool_id}
                onToggle={() =>
                  setExpandedTool(expandedTool === tool.tool_id ? null : tool.tool_id)
                }
                onConnect={(ring) =>
                  ring === 2 ? toggleZapierConnect(tool.tool_id, 'connect') : undefined
                }
                onDisconnect={(ring) =>
                  ring === 2 ? toggleZapierConnect(tool.tool_id, 'disconnect') : undefined
                }
                busyKey={busy}
              />
            ))}
          </div>
        )}
      </div>

      {/* Zapier webhook — now a collapsible "advanced" section */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <button
          type="button"
          onClick={() => setShowZapierFallback((v) => !v)}
          className="w-full px-6 py-4 flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Connect other tools via Zapier
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                For tools we don&rsquo;t natively integrate with — point a Zap at our
                webhook. Requires a Zapier account.
              </p>
            </div>
          </div>
          {showZapierFallback ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </button>

        {showZapierFallback && (
          <div className="px-6 pb-5 border-t border-gray-50 pt-4">
            {!secret ? (
              <button
                type="button"
                onClick={loadSecret}
                disabled={loadingSecret}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                {loadingSecret ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading…
                  </>
                ) : (
                  <>Reveal webhook URL + token</>
                )}
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-600 leading-relaxed">
                  Configure your Zap with these. The action is &ldquo;Webhooks by Zapier
                  → POST&rdquo; with the URL below and the
                  {' '}<code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">X-Groundwork-Token</code> header
                  set to the token.
                </p>
                <SecretRow
                  label="Webhook URL"
                  value={secret.webhook_url}
                  onCopy={() => copyText('url', secret.webhook_url)}
                  copied={copied === 'url'}
                />
                <SecretRow
                  label="X-Groundwork-Token"
                  value={secret.secret}
                  onCopy={() => copyText('token', secret.secret)}
                  copied={copied === 'token'}
                  mono
                />
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Treat the token like a password. Anyone with it can post events to
                  your dashboard.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 text-center">
        {TOOL_REGISTRY.length} tools recognized today; native integrations land continuously.
      </p>
    </div>
  )
}

// ---------- Native tool row ----------

function NativeToolRow({
  tool,
  busy,
  onConnect,
  onDisconnect,
}: {
  tool: ToolEntry
  busy: string | null
  onConnect: () => void
  onDisconnect: () => void
}) {
  const ring3 = tool.rings[3]
  const connected = ring3?.status === 'connected'
  const errored = ring3?.status === 'error'
  const connectKey = `${tool.tool_id}:3:connect`
  const disconnectKey = `${tool.tool_id}:3:disconnect`
  const busyConnect = busy === connectKey
  const busyDisconnect = busy === disconnectKey

  return (
    <div className="px-6 py-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold">
          {tool.tool_label[0]}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-900 truncate">
              {tool.tool_label}
            </p>
            {connected && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold uppercase tracking-wider inline-flex items-center gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Connected
              </span>
            )}
            {errored && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-semibold uppercase tracking-wider">
                Re-auth needed
              </span>
            )}
            {tool.capture_count_7d > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-600 border border-gray-200 font-medium">
                {tool.capture_count_7d}× this week
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {connected && ring3?.external_account_label ? (
              <>Workspace: {ring3.external_account_label}</>
            ) : connected ? (
              <>Connected via OAuth</>
            ) : (
              <>One-click native integration</>
            )}
          </p>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        {connected ? (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busyDisconnect}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {busyDisconnect ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={busyConnect}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 ${
              errored
                ? 'text-white bg-red-600 hover:bg-red-700'
                : 'text-white bg-gray-900 hover:bg-gray-700'
            }`}
          >
            {busyConnect ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Redirecting…
              </span>
            ) : errored ? (
              'Re-connect'
            ) : (
              `Connect ${tool.tool_label}`
            )}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------- Sub-components ----------

function SecretRow({
  label,
  value,
  onCopy,
  copied,
  mono,
}: {
  label: string
  value: string
  onCopy: () => void
  copied: boolean
  mono?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code
          className={`flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 select-all overflow-x-auto whitespace-nowrap ${mono ? 'font-mono' : ''}`}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
        >
          <Copy className="w-3.5 h-3.5" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

function ToolRow({
  tool,
  expanded,
  onToggle,
  onConnect,
  onDisconnect,
  busyKey,
}: {
  tool: ToolEntry
  expanded: boolean
  onToggle: () => void
  onConnect: (ring: Ring) => void
  onDisconnect: (ring: Ring) => void
  busyKey: string | null
}) {
  const ring1 = tool.rings[1]
  const ring2 = tool.rings[2]

  // Ring 1 is auto-on when there are recent detections.
  const ring1Connected = tool.capture_count_7d > 0 || ring1?.status === 'connected'
  const ring2Connected = ring2?.status === 'connected'

  return (
    <div className="px-6 py-4">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center text-sm font-semibold">
            {tool.tool_label[0]}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-gray-900 truncate">
                {tool.tool_label}
              </p>
              {tool.in_intake && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold uppercase tracking-wider">
                  in intake
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">
              {tool.capture_count_7d > 0
                ? `${tool.capture_count_7d}× detected in last 7 days`
                : 'No recent detections'}
              {tool.in_intake_used_for.length > 0 && (
                <span> · {tool.in_intake_used_for.join(', ')}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <RingPill ring={1} active={ring1Connected} label="Detected" />
          {tool.ring2Available && (
            <RingPill
              ring={2}
              active={ring2Connected}
              pending={ring2?.status === 'pending'}
              label="Zapier"
            />
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400 ml-1" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 ml-1" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="mt-4 ml-12 space-y-3">
          <RingDetail
            ring={1}
            label="Detection"
            icon={Eye}
            description="Groundwork sees this tool in window titles and URLs. No connection required."
            row={ring1}
            connected={ring1Connected}
            actions={null}
          />

          {tool.ring2Available && (
            <RingDetail
              ring={2}
              label="Zapier bridge"
              icon={Zap}
              description="Connect via Zapier to ship event data to Groundwork. Configure a Zap with the webhook URL + token from the section below, then mark connected here."
              row={ring2}
              connected={ring2Connected}
              actions={
                ring2Connected || ring2?.status === 'pending' ? (
                  <button
                    type="button"
                    onClick={() => onDisconnect(2)}
                    disabled={busyKey === `${tool.tool_id}:2:disconnect`}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onConnect(2)}
                    disabled={busyKey === `${tool.tool_id}:2:connect`}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-50"
                  >
                    {busyKey === `${tool.tool_id}:2:connect`
                      ? 'Marking…'
                      : "I've set up the Zap"}
                  </button>
                )
              }
            />
          )}

          {tool.capabilities.length > 0 && (
            <div className="pt-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5">
                Capabilities this would unlock
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tool.capabilities.slice(0, 8).map((c) => (
                  <span
                    key={c}
                    className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RingPill({
  ring,
  active,
  pending,
  label,
}: {
  ring: 1 | 2 | 3
  active: boolean
  pending?: boolean
  label: string
}) {
  const tone = active
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : pending
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-gray-50 text-gray-500 border-gray-200'
  return (
    <span
      title={`Ring ${ring} — ${label}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${tone}`}
    >
      {active && <CheckCircle2 className="w-2.5 h-2.5" />}
      {label}
    </span>
  )
}

function RingDetail({
  ring,
  label,
  icon: Icon,
  description,
  row,
  connected,
  actions,
}: {
  ring: 1 | 2 | 3
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  row: IntegrationRow | null
  connected: boolean
  actions: React.ReactNode
}) {
  return (
    <div className="border-l-2 border-gray-100 pl-4 py-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className="w-3.5 h-3.5 text-gray-400" />
            <p className="text-xs font-semibold text-gray-700">
              Ring {ring} · {label}
            </p>
            {connected && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold uppercase tracking-wider">
                Connected
              </span>
            )}
            {row?.status === 'pending' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold uppercase tracking-wider">
                Awaiting first event
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 leading-relaxed mt-1">{description}</p>
          {row && row.event_count > 0 && (
            <p className="text-[11px] text-gray-500 mt-1">
              {row.event_count} events received
              {row.last_event_at && (
                <span> · last {new Date(row.last_event_at).toLocaleString()}</span>
              )}
            </p>
          )}
        </div>
        <div className="shrink-0">{actions}</div>
      </div>
    </div>
  )
}
