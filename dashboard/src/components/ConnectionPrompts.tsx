'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plug, Zap, X } from 'lucide-react'
import { TOOL_BY_ID, coveredToolIds } from '@/lib/integrations'

/**
 * Surfaces the top 1-3 detected tools that aren't yet Ring-2 connected, with
 * a one-line value pitch ("Connect QuickBooks via Zapier — invoice creation
 * automation, ~$X/yr"). Clicking sends the owner to /settings/integrations.
 *
 * Designed to be unobtrusive: hidden when there are no qualifying tools, and
 * each prompt can be dismissed (localStorage) for one week.
 */

const MIN_DETECTIONS = 10
const DISMISS_KEY = 'groundwork.connection-prompts.dismissed.v1'
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000

type IntegrationRow = {
  id: string
  tool_name: string
  ring: 1 | 2 | 3
  status: 'detected' | 'pending' | 'connected' | 'error' | 'disconnected'
}

type DetectedTool = {
  tool_id: string
  tool_label: string
  capture_count_7d: number
  category: string
}

type StateResponse = {
  integrations: IntegrationRow[]
  detected_tools: DetectedTool[]
}

type Dismissed = Record<string, number>

export function ConnectionPrompts() {
  const [state, setState] = useState<StateResponse | null>(null)
  const [dismissed, setDismissed] = useState<Dismissed>({})

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY)
      if (raw) setDismissed(JSON.parse(raw) as Dismissed)
    } catch {
      // ignore
    }
    void load()
  }, [])

  async function load() {
    try {
      const r = await fetch('/api/integrations/state')
      if (!r.ok) return
      const body = (await r.json()) as StateResponse
      setState(body)
    } catch {
      // silent
    }
  }

  function dismiss(toolId: string) {
    const next = { ...dismissed, [toolId]: Date.now() + DISMISS_TTL_MS }
    setDismissed(next)
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  if (!state) return null

  // Includes both the tool_name of every live (ring 2/3, connected/pending)
  // integration AND any children covered by a parent suite — e.g. when
  // microsoft-365 is connected, this set contains 'microsoft-365', 'teams',
  // 'outlook', etc. Stops us from prompting "Connect Teams via Zapier" when
  // the owner already wired Microsoft 365 natively. See INTEGRATION_COVERAGE_MAP.
  const covered = coveredToolIds(state.integrations)

  const now = Date.now()
  const candidates = state.detected_tools
    .filter((t) => t.capture_count_7d >= MIN_DETECTIONS)
    .filter((t) => !covered.has(t.tool_id))
    .filter((t) => !(dismissed[t.tool_id] && dismissed[t.tool_id] > now))
    .filter((t) => {
      // Skip tools we don't actually offer Ring 2 for
      const def = TOOL_BY_ID[t.tool_id]
      return def?.ring2Available !== false
    })
    .slice(0, 3)

  if (candidates.length === 0) return null

  return (
    <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-pink-50 border border-amber-100 rounded-2xl p-5 mb-8">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
          <Plug className="w-3.5 h-3.5" />
        </div>
        <h2 className="text-sm font-semibold text-gray-900">
          Tools we&rsquo;ve detected — connect to unlock automations
        </h2>
      </div>
      <p className="text-xs text-gray-600 mb-4 leading-relaxed">
        Your team is using these tools but they aren&rsquo;t connected to
        Groundwork yet. Connecting them via Zapier lets us surface concrete
        automation opportunities with dollar savings.
      </p>
      <div className="space-y-2">
        {candidates.map((tool) => (
          <PromptRow
            key={tool.tool_id}
            tool={tool}
            onDismiss={() => dismiss(tool.tool_id)}
          />
        ))}
      </div>
    </div>
  )
}

function PromptRow({
  tool,
  onDismiss,
}: {
  tool: DetectedTool
  onDismiss: () => void
}) {
  const def = TOOL_BY_ID[tool.tool_id]
  const capabilityHint = def?.capabilities?.[0]
  const pitch = capabilityHint
    ? `Unlocks ${capabilityHint.replace(/^.*\./, '').replace(/_/g, ' ')} automation.`
    : 'Unlocks automation opportunities.'

  return (
    <div className="flex items-center gap-3 bg-white/70 backdrop-blur border border-amber-100 rounded-xl px-4 py-3">
      <div className="shrink-0 w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-semibold">
        {tool.tool_label[0]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">
          {tool.tool_label}
          <span className="text-xs text-gray-500 font-normal">
            {' '}
            · {tool.capture_count_7d}× this week
          </span>
        </p>
        <p className="text-xs text-gray-600 mt-0.5">{pitch}</p>
      </div>
      <Link
        href="/settings/integrations"
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 transition-colors"
      >
        <Zap className="w-3.5 h-3.5" />
        Connect via Zapier
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 p-1 text-gray-400 hover:text-gray-700 rounded"
        title="Dismiss for a week"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
