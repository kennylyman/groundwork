'use client'

/**
 * Renders a compact summary of capture_enrichments for a single capture.
 *
 * Shape contract — each adapter writes a top-level key (slack /
 * microsoft-365 / google-workspace) under capture_enrichments. Each
 * value is jsonb the adapter controls. This component knows the shape
 * the three current adapters write and renders a short human-readable
 * summary; unknown adapters degrade to a generic "Live context
 * available" pill.
 *
 * Used by:
 *   - Employee detail page timeline (compact, inline under each capture)
 *   - WorkflowClusterPanel (full, in the cluster detail drawer)
 *
 * Variant `inline` is small + 1-line, `panel` shows the full breakdown.
 */

// lucide-react in our pinned version doesn't expose a Slack glyph;
// MessageSquare reads as a chat icon and is consistent across providers.
import { Mail, Calendar, MessageSquare } from 'lucide-react'
import type { CaptureEnrichments } from '@/lib/supabase'

type Variant = 'inline' | 'panel'

type SlackEnrichment = {
  matched?: boolean
  channel_id?: string
  reason?: string
  error?: string
  messages?: Array<{
    ts?: string
    user?: string | null
    text?: string
    subtype?: string | null
  }>
}

type M365Enrichment = {
  matched?: boolean
  surface?: string
  error?: string
  calendar_events?: Array<{
    subject?: string
    start?: string | null
    end?: string | null
    attendees?: number
    is_online?: boolean
  }>
  unread_emails?: Array<{
    subject?: string
    from?: string | null
    received_at?: string | null
    preview?: string
  }>
}

type GoogleEnrichment = M365Enrichment // identical shape

export function CaptureEnrichmentSummary({
  enrichments,
  variant = 'inline',
}: {
  enrichments: CaptureEnrichments | null | undefined
  variant?: Variant
}) {
  if (!enrichments || Object.keys(enrichments).length === 0) return null

  const slack = enrichments.slack as SlackEnrichment | undefined
  const m365 = enrichments['microsoft-365'] as M365Enrichment | undefined
  const google = enrichments['google-workspace'] as GoogleEnrichment | undefined

  // None of the known adapters produced anything useful — bail.
  const hasUseful =
    (slack && slack.matched && (slack.messages?.length ?? 0) > 0) ||
    (m365 &&
      m365.matched &&
      ((m365.calendar_events?.length ?? 0) > 0 ||
        (m365.unread_emails?.length ?? 0) > 0)) ||
    (google &&
      google.matched &&
      ((google.calendar_events?.length ?? 0) > 0 ||
        (google.unread_emails?.length ?? 0) > 0))
  if (!hasUseful) return null

  if (variant === 'inline') {
    return <InlineSummary slack={slack} m365={m365} google={google} />
  }
  return <PanelSummary slack={slack} m365={m365} google={google} />
}

// ----- inline (employee timeline) --------------------------------------

function InlineSummary({
  slack,
  m365,
  google,
}: {
  slack?: SlackEnrichment
  m365?: M365Enrichment
  google?: GoogleEnrichment
}) {
  const chips: React.ReactNode[] = []

  if (slack?.messages && slack.messages.length > 0) {
    chips.push(
      <Chip
        key="slack"
        icon={<MessageSquare className="w-3 h-3 text-violet-500" />}
        tone="violet"
      >
        {slack.messages.length} Slack msg{slack.messages.length === 1 ? '' : 's'}
      </Chip>
    )
  }

  for (const [key, ext] of [
    ['microsoft-365', m365],
    ['google-workspace', google],
  ] as const) {
    if (!ext) continue
    const calCount = ext.calendar_events?.length ?? 0
    const mailCount = ext.unread_emails?.length ?? 0
    if (calCount > 0) {
      chips.push(
        <Chip
          key={`${key}-cal`}
          icon={<Calendar className="w-3 h-3 text-indigo-500" />}
          tone="indigo"
        >
          {calCount} meeting{calCount === 1 ? '' : 's'} nearby
        </Chip>
      )
    }
    if (mailCount > 0) {
      chips.push(
        <Chip
          key={`${key}-mail`}
          icon={<Mail className="w-3 h-3 text-cyan-500" />}
          tone="cyan"
        >
          {mailCount} unread
        </Chip>
      )
    }
  }

  if (chips.length === 0) return null

  return <div className="mt-1 flex flex-wrap items-center gap-1">{chips}</div>
}

function Chip({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode
  tone: 'violet' | 'indigo' | 'cyan'
  children: React.ReactNode
}) {
  const cls =
    tone === 'violet'
      ? 'bg-violet-50 text-violet-700 border-violet-100'
      : tone === 'indigo'
      ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
      : 'bg-cyan-50 text-cyan-700 border-cyan-100'
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}
    >
      {icon}
      {children}
    </span>
  )
}

// ----- panel (cluster detail drawer) -----------------------------------

function PanelSummary({
  slack,
  m365,
  google,
}: {
  slack?: SlackEnrichment
  m365?: M365Enrichment
  google?: GoogleEnrichment
}) {
  return (
    <div className="space-y-3">
      {slack?.messages && slack.messages.length > 0 && (
        <PanelGroup
          icon={<MessageSquare className="w-3.5 h-3.5 text-violet-300" />}
          title="Slack channel"
          subtitle={
            slack.channel_id ? `Channel ${slack.channel_id}` : 'Last messages'
          }
        >
          {slack.messages.slice(0, 5).map((m, i) => (
            <p
              key={`slack-${i}`}
              className="text-[11px] text-gray-300 leading-relaxed"
            >
              <span className="text-gray-500">
                {m.user ? `@${m.user}` : '—'}:
              </span>{' '}
              {(m.text ?? '').slice(0, 200)}
            </p>
          ))}
        </PanelGroup>
      )}

      {(m365?.calendar_events?.length ?? 0) > 0 && (
        <PanelGroup
          icon={<Calendar className="w-3.5 h-3.5 text-indigo-300" />}
          title={`${
            m365?.surface === 'outlook' ? 'Outlook' : 'Microsoft 365'
          } meetings`}
          subtitle="Within 30 minutes of this capture"
        >
          {(m365?.calendar_events ?? []).slice(0, 5).map((e, i) => (
            <EventLine key={`m365-${i}`} event={e} />
          ))}
        </PanelGroup>
      )}

      {(m365?.unread_emails?.length ?? 0) > 0 && (
        <PanelGroup
          icon={<Mail className="w-3.5 h-3.5 text-cyan-300" />}
          title="Outlook unread"
          subtitle="Top of inbox at capture time"
        >
          {(m365?.unread_emails ?? []).slice(0, 5).map((m, i) => (
            <EmailLine key={`m365e-${i}`} email={m} />
          ))}
        </PanelGroup>
      )}

      {(google?.calendar_events?.length ?? 0) > 0 && (
        <PanelGroup
          icon={<Calendar className="w-3.5 h-3.5 text-indigo-300" />}
          title="Google Calendar"
          subtitle="Within 30 minutes of this capture"
        >
          {(google?.calendar_events ?? []).slice(0, 5).map((e, i) => (
            <EventLine key={`g-${i}`} event={e} />
          ))}
        </PanelGroup>
      )}

      {(google?.unread_emails?.length ?? 0) > 0 && (
        <PanelGroup
          icon={<Mail className="w-3.5 h-3.5 text-cyan-300" />}
          title="Gmail unread"
          subtitle="Top of inbox at capture time"
        >
          {(google?.unread_emails ?? []).slice(0, 5).map((m, i) => (
            <EmailLine key={`ge-${i}`} email={m} />
          ))}
        </PanelGroup>
      )}
    </div>
  )
}

function PanelGroup({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <p className="text-[11px] font-semibold text-white">{title}</p>
      </div>
      {subtitle && (
        <p className="text-[10px] text-gray-500 mb-2">{subtitle}</p>
      )}
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function EventLine({
  event,
}: {
  event: NonNullable<M365Enrichment['calendar_events']>[number]
}) {
  const start = event.start ? new Date(event.start) : null
  const startLabel = start
    ? start.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
  return (
    <p className="text-[11px] text-gray-300 leading-relaxed flex items-baseline justify-between gap-2">
      <span className="truncate">
        {event.subject || 'Untitled meeting'}
        {event.is_online && (
          <MessageSquare className="inline w-2.5 h-2.5 ml-1 text-cyan-400" />
        )}
      </span>
      {startLabel && (
        <span className="text-gray-500 text-[10px] shrink-0">{startLabel}</span>
      )}
    </p>
  )
}

function EmailLine({
  email,
}: {
  email: NonNullable<M365Enrichment['unread_emails']>[number]
}) {
  return (
    <div className="text-[11px] text-gray-300 leading-relaxed">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">
          {email.subject || '(no subject)'}
        </span>
        {email.from && (
          <span className="text-gray-500 text-[10px] shrink-0 truncate">
            {email.from}
          </span>
        )}
      </div>
      {email.preview && (
        <p className="text-gray-500 text-[10px] mt-0.5 line-clamp-2">
          {email.preview}
        </p>
      )}
    </div>
  )
}

// Re-export so we can keep imports tidy elsewhere.
export type { CaptureEnrichments }
