/**
 * Capability resolver + tool registry.
 *
 * Two layers:
 *   1. TOOL_REGISTRY — what tools we know about, what they're typically used
 *      for, which capabilities they can serve, and how they're typically
 *      detected from window titles / URLs.
 *   2. resolveCapability(business, capability) — given a business's current
 *      integrations[], rank providers (ring 3 > ring 2 > ring 1) and return
 *      the best available one. Phase 5 will invoke; Phase 4 mainly displays.
 *
 * This file is the single source of truth for:
 *   - which tools count as "the same tool" when normalizing captures.software
 *   - which automation capabilities a tool unlocks
 *   - which detection patterns identify a tool in window titles / URLs
 */

import { CAPABILITY_BY_ID } from './capabilities'

export type Ring = 1 | 2 | 3

export type ToolDefinition = {
  /** Lowercase canonical id used in integrations.tool_name and aggregation. */
  id: string
  /** Display name shown in UI. */
  label: string
  /** Free-text category (operations / billing / comms / etc.) — for grouping. */
  category: 'operations' | 'billing' | 'comms' | 'docs' | 'productivity' | 'other'
  /** Capability ids (from lib/capabilities.ts) this tool can typically serve
   *  when connected via Ring 2 (Zapier) or Ring 3 (native). */
  capabilities: string[]
  /** Detection hints. Lowercase substrings checked against window titles + URLs. */
  detect: {
    windowSubstrings?: string[]
    urlSubstrings?: string[]
  }
  /** Whether Ring 2 (Zapier) is available for this tool. */
  ring2Available: boolean
  /** Whether Ring 3 (native OAuth / MCP) is available for this tool. */
  ring3Available: boolean
}

// ----- Tool registry ------------------------------------------------------
// Curated list, broad across SMB verticals. Extend over time as we see new
// tools in production capture streams.

export const TOOL_REGISTRY: ToolDefinition[] = [
  // ----- Home care / clinical -----
  {
    id: 'wellsky',
    label: 'WellSky',
    category: 'operations',
    capabilities: ['workflow.schedule', 'workflow.assign', 'data.entry.form_fill', 'data.lookup.record'],
    detect: { windowSubstrings: ['wellsky', 'clearcare'], urlSubstrings: ['wellsky.com', 'clearcareonline'] },
    ring2Available: true,
    ring3Available: false,
  },
  {
    id: 'hhaexchange',
    label: 'HHAeXchange',
    category: 'operations',
    capabilities: ['workflow.schedule', 'workflow.assign', 'admin.compliance.check'],
    detect: { windowSubstrings: ['hhaexchange'], urlSubstrings: ['hhaexchange.com'] },
    ring2Available: true,
    ring3Available: false,
  },

  // ----- Accounting / billing -----
  {
    id: 'quickbooks',
    label: 'QuickBooks',
    category: 'billing',
    capabilities: ['admin.invoice.create', 'admin.invoice.process', 'admin.payroll.process', 'reporting.generate'],
    detect: { windowSubstrings: ['quickbooks'], urlSubstrings: ['quickbooks.intuit.com', 'qbo.intuit.com'] },
    ring2Available: true,
    ring3Available: false,
  },
  {
    id: 'xero',
    label: 'Xero',
    category: 'billing',
    capabilities: ['admin.invoice.create', 'admin.invoice.process', 'reporting.generate'],
    detect: { windowSubstrings: ['xero'], urlSubstrings: ['xero.com'] },
    ring2Available: true,
    ring3Available: false,
  },
  {
    id: 'waystar',
    label: 'Waystar',
    category: 'billing',
    capabilities: ['admin.invoice.process', 'admin.compliance.check'],
    detect: { windowSubstrings: ['waystar'], urlSubstrings: ['waystar.com'] },
    ring2Available: true,
    ring3Available: false,
  },

  // ----- Comms -----
  {
    id: 'gmail',
    label: 'Gmail',
    category: 'comms',
    capabilities: ['communication.send.email', 'communication.triage.inbox', 'communication.reply.routine'],
    detect: { windowSubstrings: ['gmail', 'inbox'], urlSubstrings: ['mail.google.com'] },
    ring2Available: true,
    ring3Available: true,
  },
  {
    id: 'outlook',
    label: 'Outlook',
    category: 'comms',
    capabilities: ['communication.send.email', 'communication.triage.inbox', 'communication.reply.routine'],
    detect: { windowSubstrings: ['outlook'], urlSubstrings: ['outlook.live.com', 'outlook.office.com'] },
    ring2Available: true,
    ring3Available: true,
  },
  {
    id: 'slack',
    label: 'Slack',
    category: 'comms',
    capabilities: ['communication.send.chat', 'communication.triage.inbox'],
    detect: { windowSubstrings: ['slack'], urlSubstrings: ['slack.com'] },
    ring2Available: true,
    ring3Available: true,
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    category: 'comms',
    capabilities: ['communication.send.chat', 'meeting.attend', 'meeting.followup'],
    detect: { windowSubstrings: ['microsoft teams', 'teams'], urlSubstrings: ['teams.microsoft.com'] },
    ring2Available: true,
    ring3Available: true,
  },
  {
    id: 'twilio',
    label: 'Twilio',
    category: 'comms',
    capabilities: ['communication.send.sms', 'communication.send.notification'],
    detect: { windowSubstrings: ['twilio'], urlSubstrings: ['twilio.com', 'console.twilio.com'] },
    ring2Available: true,
    ring3Available: false,
  },

  // ----- Productivity / docs -----
  {
    id: 'google-drive',
    label: 'Google Drive',
    category: 'docs',
    capabilities: ['document.create', 'document.review', 'document.template_fill'],
    detect: { windowSubstrings: ['google drive', 'docs', 'sheets'], urlSubstrings: ['drive.google.com', 'docs.google.com', 'sheets.google.com'] },
    ring2Available: true,
    ring3Available: true,
  },
  {
    id: 'notion',
    label: 'Notion',
    category: 'docs',
    capabilities: ['document.create', 'document.review', 'search.knowledge'],
    detect: { windowSubstrings: ['notion'], urlSubstrings: ['notion.so'] },
    ring2Available: true,
    ring3Available: true,
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    category: 'docs',
    capabilities: ['document.create', 'document.review'],
    detect: { windowSubstrings: ['dropbox'], urlSubstrings: ['dropbox.com'] },
    ring2Available: true,
    ring3Available: false,
  },

  // ----- Calendar / scheduling -----
  {
    id: 'google-calendar',
    label: 'Google Calendar',
    category: 'productivity',
    capabilities: ['workflow.schedule', 'meeting.prepare'],
    detect: { windowSubstrings: ['google calendar'], urlSubstrings: ['calendar.google.com'] },
    ring2Available: true,
    ring3Available: true,
  },
  {
    id: 'calendly',
    label: 'Calendly',
    category: 'productivity',
    capabilities: ['workflow.schedule'],
    detect: { windowSubstrings: ['calendly'], urlSubstrings: ['calendly.com'] },
    ring2Available: true,
    ring3Available: false,
  },

  // ----- CRM / sales (broad SMB) -----
  {
    id: 'hubspot',
    label: 'HubSpot',
    category: 'operations',
    capabilities: ['data.lookup.record', 'data.entry.form_fill', 'communication.send.email'],
    detect: { windowSubstrings: ['hubspot'], urlSubstrings: ['hubspot.com', 'app.hubspot.com'] },
    ring2Available: true,
    ring3Available: false,
  },
  {
    id: 'salesforce',
    label: 'Salesforce',
    category: 'operations',
    capabilities: ['data.lookup.record', 'data.entry.form_fill', 'reporting.generate'],
    detect: { windowSubstrings: ['salesforce'], urlSubstrings: ['salesforce.com', 'lightning.force.com'] },
    ring2Available: true,
    ring3Available: false,
  },

  // ----- Document signing -----
  {
    id: 'docusign',
    label: 'DocuSign',
    category: 'docs',
    capabilities: ['document.sign', 'document.template_fill'],
    detect: { windowSubstrings: ['docusign'], urlSubstrings: ['docusign.com'] },
    ring2Available: true,
    ring3Available: false,
  },
  {
    id: 'hellosign',
    label: 'HelloSign',
    category: 'docs',
    capabilities: ['document.sign'],
    detect: { windowSubstrings: ['hellosign', 'dropbox sign'], urlSubstrings: ['hellosign.com'] },
    ring2Available: true,
    ring3Available: false,
  },
]

export const TOOL_BY_ID: Record<string, ToolDefinition> = Object.fromEntries(
  TOOL_REGISTRY.map((t) => [t.id, t])
)

// ----- Normalization ------------------------------------------------------

/**
 * Map a raw software / window / url string to a canonical tool id, or null
 * if we don't recognize it. Case-insensitive substring match against the
 * tool's detection hints.
 */
export function normalizeToolName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.toLowerCase()
  for (const tool of TOOL_REGISTRY) {
    for (const sub of tool.detect.windowSubstrings || []) {
      if (s.includes(sub)) return tool.id
    }
    for (const sub of tool.detect.urlSubstrings || []) {
      if (s.includes(sub)) return tool.id
    }
  }
  return null
}

// ----- Capability resolver ------------------------------------------------

export type IntegrationRow = {
  id: string
  tool_name: string
  ring: Ring
  status: string
}

export type ResolvedProvider = {
  tool_id: string
  tool_label: string
  ring: Ring
  available: boolean
}

/**
 * Given a business's integrations[] and a capability id, return ranked
 * providers that could serve that capability. Highest ring first.
 *
 * Phase 5 will invoke the top provider; Phase 4 mainly uses this to display
 * "to enable [X], connect [Y]" prompts on the dashboard.
 */
export function resolveCapability(
  capabilityId: string,
  integrations: IntegrationRow[]
): ResolvedProvider[] {
  const out: ResolvedProvider[] = []
  for (const tool of TOOL_REGISTRY) {
    if (!tool.capabilities.includes(capabilityId)) continue
    // What rings can this tool serve, and which of those does the business
    // currently have connected (or detected)?
    for (const ring of [3, 2, 1] as Ring[]) {
      if (ring === 3 && !tool.ring3Available) continue
      if (ring === 2 && !tool.ring2Available) continue
      const matching = integrations.find(
        (i) => i.tool_name === tool.id && i.ring === ring
      )
      const isAvailable =
        !!matching && (matching.status === 'connected' || matching.status === 'detected')
      out.push({
        tool_id: tool.id,
        tool_label: tool.label,
        ring,
        available: isAvailable,
      })
    }
  }
  // Sort: available first, then by ring (3 → 2 → 1)
  out.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1
    return b.ring - a.ring
  })
  return out
}

/**
 * Human-readable label for a capability id (for dashboards / prompts).
 * Wraps the capability taxonomy.
 */
export function capabilityShortLabel(id: string): string {
  return CAPABILITY_BY_ID[id]?.label ?? id
}
