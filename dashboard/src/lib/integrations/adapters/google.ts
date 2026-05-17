/**
 * Google Workspace adapter — Gmail + Calendar + Drive (+ Docs/Sheets/Slides
 * via Drive) in one OAuth grant. Mirrors Microsoft 365 in shape so the
 * customer experience is "click Connect, OAuth once, done" regardless of
 * which productivity suite they use.
 *
 * OAuth: Google Identity Platform v2. Access tokens last ~1 hour; the
 * refresh token (when we get one) does NOT expire as long as it's used
 * occasionally. Two Google quirks worth knowing about:
 *
 *   1. Refresh tokens are only returned on FIRST consent. If a user has
 *      already authorized the app and reconnects, Google omits
 *      refresh_token from the response unless you set prompt=consent.
 *      We always pass prompt=consent for that reason.
 *
 *   2. access_type=offline is required — without it the response has no
 *      refresh_token regardless of prompt.
 *
 * Operations exposed:
 *   - getRecentEmails(limit?)
 *   - searchEmails(query)
 *   - sendEmail(to, subject, body)
 *   - getCalendarEvents(start?, end?)
 *   - findMeetingAvailability(attendees[], duration_minutes, window_start, window_end)
 *   - searchDrive(query)
 *
 * Enrichment: when a capture lands on Gmail, Calendar, Drive, Docs, etc.,
 * fetches calendar events ±30 min and the 3 most recent unreads. Stored
 * under capture_enrichments["google-workspace"].
 */

import type {
  CaptureForEnrichment,
  ToolAdapter,
  ToolCallContext,
  TokenResponse,
} from './types'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3'
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

// Scopes Groundwork asks for. openid + email + profile cover the
// userinfo lookup that gives us the display label for the integration
// row. The rest are 1:1 with operations we ship.
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
] as const

type GoogleTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
  id_token?: string
  error?: string
  error_description?: string
}

type GoogleErrorBody = {
  error?:
    | string
    | {
        code: number
        message: string
        status?: string
      }
  error_description?: string
}

function getEnv(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured')
  }
  return { clientId, clientSecret }
}

/** Wrap Google API calls. Returns parsed JSON on success; throws an Error
 *  with the Google error code/message preserved on failure. */
async function googleFetch<T>(
  ctx: ToolCallContext,
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (r.status === 204) return undefined as unknown as T
  const body = (await r.json().catch(() => null)) as GoogleErrorBody | T | null
  if (!r.ok) {
    const err = (body as GoogleErrorBody | null)?.error
    let msg: string
    let code: string
    if (typeof err === 'string') {
      msg = err
      code = err
    } else if (err && typeof err === 'object') {
      msg = err.message
      code = err.status ?? String(err.code)
    } else {
      msg = `HTTP ${r.status}`
      code = 'google_error'
    }
    throw new Error(`google(${code}): ${msg}`)
  }
  return body as T
}

// ----- OAuth helpers ----------------------------------------------------

function authorizeUrl({
  state,
  redirectUri,
}: {
  state: string
  redirectUri: string
}): string {
  const { clientId } = getEnv()
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
    // offline + consent together are how Google reliably returns a
    // refresh_token on every authorization. Without consent, returning
    // users get only an access_token and JIT refresh has nothing to use.
    access_type: 'offline',
    prompt: 'consent',
    // include_granted_scopes lets users add scopes incrementally without
    // re-granting the existing set.
    include_granted_scopes: 'true',
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

async function exchangeCode({
  code,
  redirectUri,
}: {
  code: string
  redirectUri: string
}): Promise<TokenResponse> {
  const { clientId, clientSecret } = getEnv()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await r.json()) as GoogleTokenResponse
  if (!r.ok || json.error) {
    throw new Error(
      `Google token exchange failed: ${json.error_description ?? json.error ?? 'unknown'}`
    )
  }

  // Pull user identity for the settings-page display label.
  const profileRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${json.access_token}` },
  })
  const profile = profileRes.ok
    ? ((await profileRes.json()) as {
        sub?: string
        email?: string
        name?: string
      })
    : null

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scopes: (json.scope ?? '').split(' ').filter(Boolean),
    externalAccountId: profile?.sub ?? null,
    externalAccountLabel: profile?.email ?? profile?.name ?? null,
  }
}

async function refresh(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getEnv()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await r.json()) as GoogleTokenResponse
  if (!r.ok || json.error) {
    throw new Error(
      `Google refresh failed: ${json.error_description ?? json.error ?? 'unknown'}`
    )
  }
  return {
    accessToken: json.access_token,
    // Google doesn't rotate refresh tokens — the original stays valid.
    // Stick with what we already had so we never blank it out.
    refreshToken,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scopes: (json.scope ?? '').split(' ').filter(Boolean),
    externalAccountId: null,
    externalAccountLabel: null,
  }
}

// ----- Operations -------------------------------------------------------

type GmailHeader = { name: string; value: string }

type GmailMessage = {
  id: string
  threadId?: string
  snippet?: string
  labelIds?: string[]
  internalDate?: string // epoch ms as string
  payload?: { headers?: GmailHeader[] }
}

type GmailListResponse = {
  messages?: Array<{ id: string; threadId?: string }>
  resultSizeEstimate?: number
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  if (!headers) return null
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? null
}

function parseFromHeader(raw: string | null): { address: string | null; name: string | null } {
  if (!raw) return { address: null, name: null }
  // "Sarah Chen <sarah@acme.com>" → { name, address }
  const angleMatch = raw.match(/^\s*(?:"?([^"<]+?)"?\s+)?<([^>]+)>\s*$/)
  if (angleMatch) {
    return { name: angleMatch[1]?.trim() ?? null, address: angleMatch[2].trim() }
  }
  if (raw.includes('@')) return { address: raw.trim(), name: null }
  return { address: null, name: raw.trim() }
}

async function fetchMessageMetadata(
  ctx: ToolCallContext,
  id: string
): Promise<GmailMessage> {
  return googleFetch<GmailMessage>(
    ctx,
    `${GMAIL_BASE}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`
  )
}

async function getRecentEmails(ctx: ToolCallContext, args: Record<string, unknown>) {
  const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10)))
  const list = await googleFetch<GmailListResponse>(
    ctx,
    `${GMAIL_BASE}/messages?maxResults=${limit}&labelIds=INBOX`
  )
  const ids = (list.messages ?? []).map((m) => m.id)
  if (ids.length === 0) return { emails: [] }
  // Gmail doesn't return headers from messages.list — we fetch each by
  // id. Sequential rather than batched: 10 round-trips is fine at our
  // scale and keeps the code simple.
  const messages = await Promise.all(ids.map((id) => fetchMessageMetadata(ctx, id)))
  return {
    emails: messages.map((m) => {
      const from = parseFromHeader(headerValue(m.payload?.headers, 'From'))
      return {
        id: m.id,
        subject: headerValue(m.payload?.headers, 'Subject') ?? '',
        from: from.address,
        from_name: from.name,
        received_at: m.internalDate
          ? new Date(Number(m.internalDate)).toISOString()
          : null,
        preview: (m.snippet ?? '').slice(0, 200),
        is_read: !(m.labelIds ?? []).includes('UNREAD'),
      }
    }),
  }
}

async function searchEmails(ctx: ToolCallContext, args: Record<string, unknown>) {
  const q = String(args.query ?? '').trim()
  if (!q) throw new Error('searchEmails: query required')
  const list = await googleFetch<GmailListResponse>(
    ctx,
    `${GMAIL_BASE}/messages?maxResults=10&q=${encodeURIComponent(q)}`
  )
  const ids = (list.messages ?? []).map((m) => m.id)
  if (ids.length === 0) return { results: [] }
  const messages = await Promise.all(ids.map((id) => fetchMessageMetadata(ctx, id)))
  return {
    results: messages.map((m) => {
      const from = parseFromHeader(headerValue(m.payload?.headers, 'From'))
      return {
        id: m.id,
        subject: headerValue(m.payload?.headers, 'Subject') ?? '',
        from: from.address,
        received_at: m.internalDate
          ? new Date(Number(m.internalDate)).toISOString()
          : null,
        preview: (m.snippet ?? '').slice(0, 200),
      }
    }),
  }
}

/** Gmail sendMail expects an RFC 822 message base64url-encoded. */
function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function sendEmail(ctx: ToolCallContext, args: Record<string, unknown>) {
  const to = String(args.to ?? '').trim()
  const subject = String(args.subject ?? '').trim()
  const body = String(args.body ?? '').trim()
  if (!to || !subject || !body) {
    throw new Error('sendEmail: to, subject, body all required')
  }
  const rfc822 =
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n` +
    `MIME-Version: 1.0\r\n` +
    `\r\n` +
    body
  const raw = base64UrlEncode(rfc822)
  const res = await googleFetch<{ id: string; threadId: string }>(
    ctx,
    `${GMAIL_BASE}/messages/send`,
    {
      method: 'POST',
      body: JSON.stringify({ raw }),
    }
  )
  return { id: res.id, thread_id: res.threadId }
}

type CalendarEvent = {
  id: string
  summary?: string
  description?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: Array<{
    email: string
    displayName?: string
    responseStatus?: string
    organizer?: boolean
  }>
  hangoutLink?: string
  conferenceData?: unknown
}

async function getCalendarEvents(
  ctx: ToolCallContext,
  args: Record<string, unknown>
) {
  const timeMin = args.start
    ? new Date(String(args.start)).toISOString()
    : new Date().toISOString()
  const timeMax = args.end
    ? new Date(String(args.end)).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '25',
  })
  const res = await googleFetch<{ items?: CalendarEvent[] }>(
    ctx,
    `${CALENDAR_BASE}/calendars/primary/events?${params.toString()}`
  )
  return {
    events: (res.items ?? []).map((e) => ({
      id: e.id,
      subject: e.summary ?? '',
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      attendee_count: (e.attendees ?? []).length,
      is_online_meeting: !!e.hangoutLink || !!e.conferenceData,
      preview: (e.description ?? '').slice(0, 200),
    })),
  }
}

type FreeBusyResponse = {
  calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>
}

async function findMeetingAvailability(
  ctx: ToolCallContext,
  args: Record<string, unknown>
) {
  const attendees = Array.isArray(args.attendees)
    ? args.attendees.filter((a): a is string => typeof a === 'string')
    : []
  if (attendees.length === 0) {
    throw new Error('findMeetingAvailability: attendees[] required')
  }
  const durationMinutes = Math.max(
    15,
    Math.min(240, Number(args.duration_minutes ?? 30))
  )
  const windowStart = args.window_start
    ? new Date(String(args.window_start)).toISOString()
    : new Date().toISOString()
  const windowEnd = args.window_end
    ? new Date(String(args.window_end)).toISOString()
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // FreeBusy returns busy blocks; the caller (or a follow-up call) walks
  // them to find open windows. Returning raw busy blocks is more useful
  // than trying to compute slots server-side because business hours +
  // preferred meeting times vary per customer.
  const res = await googleFetch<FreeBusyResponse>(
    ctx,
    `${CALENDAR_BASE}/freeBusy`,
    {
      method: 'POST',
      body: JSON.stringify({
        timeMin: windowStart,
        timeMax: windowEnd,
        items: attendees.map((email) => ({ id: email })),
      }),
    }
  )
  return {
    duration_minutes: durationMinutes,
    window_start: windowStart,
    window_end: windowEnd,
    busy_by_attendee: Object.fromEntries(
      Object.entries(res.calendars ?? {}).map(([id, cal]) => [
        id,
        (cal.busy ?? []).map((b) => ({ start: b.start, end: b.end })),
      ])
    ),
  }
}

type DriveFile = {
  id: string
  name: string
  mimeType?: string
  webViewLink?: string
  modifiedTime?: string
  owners?: Array<{ displayName?: string; emailAddress?: string }>
}

async function searchDrive(ctx: ToolCallContext, args: Record<string, unknown>) {
  const q = String(args.query ?? '').trim()
  if (!q) throw new Error('searchDrive: query required')
  // Wrap the user's query in name contains '...' for a forgiving search.
  // Power users can pass full Drive query syntax if they want — Drive
  // accepts either.
  const isStructured = q.includes('contains') || q.includes('=') || q.includes("'")
  const driveQ = isStructured ? q : `name contains '${q.replace(/'/g, "\\'")}'`
  const params = new URLSearchParams({
    q: driveQ,
    pageSize: '10',
    fields: 'files(id,name,mimeType,webViewLink,modifiedTime,owners(displayName,emailAddress))',
    orderBy: 'modifiedTime desc',
  })
  const res = await googleFetch<{ files?: DriveFile[] }>(
    ctx,
    `${DRIVE_BASE}/files?${params.toString()}`
  )
  return {
    files: (res.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mime_type: f.mimeType ?? null,
      url: f.webViewLink ?? null,
      modified_at: f.modifiedTime ?? null,
      owner_email: f.owners?.[0]?.emailAddress ?? null,
    })),
  }
}

// ----- Capture matching + enrichment -----------------------------------

function matchesCapture(capture: CaptureForEnrichment): boolean {
  const win = (capture.active_window ?? '').toLowerCase()
  const url = (capture.active_url ?? '').toLowerCase()
  const sw = (capture.software ?? '').toLowerCase()

  // Direct software match (post-normalize)
  if (
    sw === 'gmail' ||
    sw === 'google-drive' ||
    sw === 'google-calendar' ||
    sw === 'google-workspace'
  ) {
    return true
  }

  // URL-based — these are the strong signals.
  if (
    url.includes('mail.google.com') ||
    url.includes('calendar.google.com') ||
    url.includes('drive.google.com') ||
    url.includes('docs.google.com') ||
    url.includes('sheets.google.com') ||
    url.includes('slides.google.com') ||
    url.includes('meet.google.com')
  ) {
    return true
  }

  // Window-title match — be more cautious. "Gmail" alone is fine.
  // "Inbox" matches Outlook too, so don't use it here.
  if (win.includes('gmail') || win.includes('google docs') || win.includes('google sheets')) {
    return true
  }

  return false
}

function matchedSurface(capture: CaptureForEnrichment): string {
  const url = (capture.active_url ?? '').toLowerCase()
  const win = (capture.active_window ?? '').toLowerCase()
  if (url.includes('mail.google.com') || win.includes('gmail')) return 'gmail'
  if (url.includes('calendar.google.com')) return 'calendar'
  if (url.includes('meet.google.com')) return 'meet'
  if (url.includes('docs.google.com')) return 'docs'
  if (url.includes('sheets.google.com')) return 'sheets'
  if (url.includes('slides.google.com')) return 'slides'
  if (url.includes('drive.google.com')) return 'drive'
  return 'unknown'
}

async function enrichCapture(
  capture: CaptureForEnrichment,
  ctx: ToolCallContext
): Promise<Record<string, unknown> | null> {
  const captureTime = new Date(capture.captured_at)
  const windowStart = new Date(captureTime.getTime() - 30 * 60 * 1000).toISOString()
  const windowEnd = new Date(captureTime.getTime() + 30 * 60 * 1000).toISOString()

  const calParams = new URLSearchParams({
    timeMin: windowStart,
    timeMax: windowEnd,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '5',
  })

  const [calRes, mailListRes] = await Promise.allSettled([
    googleFetch<{ items?: CalendarEvent[] }>(
      ctx,
      `${CALENDAR_BASE}/calendars/primary/events?${calParams.toString()}`
    ),
    googleFetch<GmailListResponse>(
      ctx,
      `${GMAIL_BASE}/messages?maxResults=3&q=is:unread`
    ),
  ])

  const events =
    calRes.status === 'fulfilled'
      ? (calRes.value.items ?? []).map((e) => ({
          subject: e.summary ?? '',
          start: e.start?.dateTime ?? e.start?.date ?? null,
          end: e.end?.dateTime ?? e.end?.date ?? null,
          attendees: (e.attendees ?? []).length,
          is_online: !!e.hangoutLink || !!e.conferenceData,
        }))
      : null

  // Gmail needs a second pass to get headers — only if there are messages.
  let unreadEmails: Array<{
    subject: string
    from: string | null
    received_at: string | null
    preview: string
  }> | null = null
  if (mailListRes.status === 'fulfilled') {
    const ids = (mailListRes.value.messages ?? []).map((m) => m.id)
    if (ids.length === 0) {
      unreadEmails = []
    } else {
      try {
        const messages = await Promise.all(
          ids.map((id) => fetchMessageMetadata(ctx, id))
        )
        unreadEmails = messages.map((m) => {
          const from = parseFromHeader(headerValue(m.payload?.headers, 'From'))
          return {
            subject: headerValue(m.payload?.headers, 'Subject') ?? '',
            from: from.address,
            received_at: m.internalDate
              ? new Date(Number(m.internalDate)).toISOString()
              : null,
            preview: (m.snippet ?? '').slice(0, 200),
          }
        })
      } catch {
        // If the second pass fails (rare), just leave unread null —
        // calendar might still be useful on its own.
        unreadEmails = null
      }
    }
  }

  if (events === null && unreadEmails === null) {
    const calErr = calRes.status === 'rejected' ? String(calRes.reason).slice(0, 200) : ''
    const mailErr =
      mailListRes.status === 'rejected'
        ? String(mailListRes.reason).slice(0, 200)
        : ''
    return { matched: true, error: `calendar=${calErr} mail=${mailErr}` }
  }

  return {
    matched: true,
    surface: matchedSurface(capture),
    calendar_events: events ?? [],
    unread_emails: unreadEmails ?? [],
  }
}

// ----- Adapter export --------------------------------------------------

export const googleAdapter: ToolAdapter = {
  toolName: 'google-workspace',
  oauth: { authorizeUrl, exchangeCode, refresh },
  operations: {
    getRecentEmails,
    searchEmails,
    sendEmail,
    getCalendarEvents,
    findMeetingAvailability,
    searchDrive,
  },
  matchesCapture,
  enrichCapture,
}
