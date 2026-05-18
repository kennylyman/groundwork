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

export type Ring = 1 | 2 | 3

export type ToolDefinition = {
  /** Lowercase canonical id used in integrations.tool_name and aggregation. */
  id: string
  /** Display name shown in UI. */
  label: string
  /** Free-text category (operations / billing / comms / etc.) — for grouping. */
  category: 'operations' | 'billing' | 'comms' | 'docs' | 'productivity' | 'other'
  /** Capability ids (from the capability_registry table) this tool can
   *  typically serve when connected via Ring 2 (Zapier) or Ring 3 (native). */
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
  // Microsoft 365 is the unified-OAuth registry entry — one connection
  // covers Outlook (email + calendar), Teams (chat + meetings),
  // SharePoint (files), and OneDrive. We keep detect substrings very
  // narrow: only the literal suite name "microsoft 365" (with space +
  // digit). Real captures say "Microsoft Teams", "Microsoft Outlook",
  // "Microsoft Excel (via Teams)" — none of which contain the substring
  // "microsoft 365", so they still fall through to the granular tools
  // below (teams / outlook). The native adapter's matchesCapture() does
  // its own M365-surface detection across all four products and pulls
  // enrichment from Microsoft Graph regardless of which surface the
  // capture lands on.
  //
  // Why this entry needs ANY detect at all: intake tool_stack entries
  // come through as raw owner-typed strings like "Microsoft 365". Without
  // a substring here, normalizeToolName falls back to the lowercased
  // string ("microsoft 365" with a space), which doesn't match this
  // canonical id ('microsoft-365' with a hyphen) and the suite leaks into
  // "Other tools detected" with a misleading "Connect via Zapier" CTA.
  {
    id: 'microsoft-365',
    label: 'Microsoft 365',
    category: 'productivity',
    capabilities: [
      'communication.send.email',
      'communication.triage.inbox',
      'communication.send.chat',
      'meeting.attend',
      'meeting.followup',
      'workflow.schedule',
      'document.create',
      'document.review',
    ],
    detect: { windowSubstrings: ['microsoft 365', 'office 365'], urlSubstrings: ['portal.office.com', 'office.com'] },
    ring2Available: true,
    ring3Available: true,
  },
  // Google Workspace — same pattern as Microsoft 365. One OAuth covers
  // Gmail, Calendar, Drive (and Docs/Sheets/Slides through Drive). The
  // detect substrings are intentionally narrow ("google workspace",
  // "g suite") so per-product captures ("Gmail", "Google Drive",
  // "Google Calendar") still match the granular tools below; the
  // adapter's matchesCapture() unifies across all Google surfaces for
  // enrichment.
  {
    id: 'google-workspace',
    label: 'Google Workspace',
    category: 'productivity',
    capabilities: [
      'communication.send.email',
      'communication.triage.inbox',
      'meeting.attend',
      'meeting.followup',
      'workflow.schedule',
      'document.create',
      'document.review',
    ],
    detect: { windowSubstrings: ['google workspace', 'g suite', 'gsuite'], urlSubstrings: ['workspace.google.com', 'admin.google.com'] },
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

// ----- Coverage map -------------------------------------------------------

/**
 * Parent suite → child tools it functionally covers.
 *
 * When a parent integration is already connected for a business (ring 2
 * or ring 3, status connected/pending), the listed children are already
 * covered and any "connect this tool via Zapier" prompt for those
 * children should be suppressed.
 *
 * Example: Microsoft 365 native OAuth gives us Microsoft Graph read
 * access across Teams, Outlook, OneDrive, SharePoint, Excel, and Word —
 * so prompting the owner to also wire Teams up via Zapier is noise.
 *
 * Notable non-entries:
 *   - 'zapier' is intentionally NOT a parent here. A generic Zapier
 *     webhook receiver doesn't cover individual tools — the owner still
 *     has to author a Zap per tool — so it shouldn't suppress per-tool
 *     prompts.
 *
 * Tool ids use the canonical hyphenated form stored in
 * integrations.tool_name and TOOL_BY_ID (e.g. 'microsoft-365', not
 * 'microsoft_365'). Some children (onedrive, sharepoint, excel, word,
 * google-docs, google-sheets) don't have TOOL_REGISTRY entries yet —
 * they're listed here forward-looking so they'll be suppressed if
 * normalizeToolName starts emitting them later.
 */
export const INTEGRATION_COVERAGE_MAP: Record<string, string[]> = {
  'microsoft-365': [
    'teams',
    'outlook',
    'onedrive',
    'sharepoint',
    'excel',
    'word',
  ],
  'google-workspace': [
    'gmail',
    'google-drive',
    'google-calendar',
    'google-docs',
    'google-sheets',
  ],
}

type CoverageIntegrationRow = {
  tool_name: string
  ring: number
  status: string
}

/**
 * Returns the set of tool_ids that are functionally covered by at least
 * one "live" integration for this business. A row is "live" when it's
 * ring=2 (Zapier connect) or ring=3 (native OAuth) with status connected
 * or pending. Ring=1 detected-only doesn't count — detection is what
 * surfaces the prompt in the first place, so treating it as coverage
 * would suppress every prompt we ever wanted to show.
 *
 * The returned set includes both:
 *   - the live integration's own tool_name (so we don't reprompt to
 *     connect a tool that's already connected directly)
 *   - every child listed for that parent in INTEGRATION_COVERAGE_MAP
 */
export function coveredToolIds(
  integrations: CoverageIntegrationRow[]
): Set<string> {
  const covered = new Set<string>()
  for (const i of integrations) {
    const liveRing = i.ring === 2 || i.ring === 3
    const liveStatus = i.status === 'connected' || i.status === 'pending'
    if (!liveRing || !liveStatus) continue
    covered.add(i.tool_name)
    for (const child of INTEGRATION_COVERAGE_MAP[i.tool_name] ?? []) {
      covered.add(child)
    }
  }
  return covered
}

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
