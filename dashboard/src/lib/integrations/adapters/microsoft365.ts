/**
 * Microsoft 365 adapter — Outlook + Teams + SharePoint + OneDrive +
 * Calendar in one OAuth grant.
 *
 * OAuth flow: Microsoft Identity Platform v2.0 against the `common`
 * endpoint, which accepts both work/school (Entra ID) and personal MSAs.
 * Access tokens are short-lived (~1 hour); offline_access scope gets us a
 * refresh token that lives for up to 90 days under typical policies.
 *
 * Because of the 1-hour access-token lifetime, the daily refresh cron
 * isn't enough — by 04:31 UTC the token's expired and operations would
 * fail for the rest of the day. lib/integrations-runtime.ts handles this
 * with a just-in-time refresh inside callTool().
 *
 * Operations exposed:
 *   - getRecentEmails(limit?)
 *   - searchEmails(query)
 *   - getCalendarEvents(start?, end?)
 *   - findMeetingAvailability(attendees[], duration_minutes, window_start, window_end)
 *   - findUser(email)
 *   - sendEmail(to, subject, body)
 *
 * Enrichment: when a capture lands on any M365 surface (Outlook Web,
 * Teams Web, SharePoint, OneDrive, Outlook native), we fetch a snapshot
 * of the user's current context:
 *   - calendar events within ±30 minutes of the capture timestamp
 *   - 3 most recent unread emails
 * Stored under capture_enrichments.microsoft-365.
 */

import type {
  CaptureForEnrichment,
  ToolAdapter,
  ToolCallContext,
  TokenResponse,
} from './types'

const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

// Scopes Groundwork asks for. offline_access is required for a refresh
// token; the rest map directly to the operations + enrichment we ship.
// Owners see this list in the consent screen so we keep it minimal —
// every scope here unlocks a specific operation we actually call.
const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'User.ReadBasic.All',
  'Mail.Read',
  'Mail.Send',
  'Calendars.Read',
  'Calendars.Read.Shared',
] as const

type MsTokenResponse = {
  token_type: string
  scope?: string
  expires_in: number
  ext_expires_in?: number
  access_token: string
  refresh_token?: string
  id_token?: string
  error?: string
  error_description?: string
}

type GraphError = {
  error?: { code: string; message: string }
}

async function getEnv(): Promise<{ clientId: string; clientSecret: string }> {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET not configured')
  }
  return { clientId, clientSecret }
}

/** Wrap Graph API calls so error responses become real exceptions with
 *  the Graph error code / message preserved. Returns parsed JSON on success. */
async function graphFetch<T>(
  ctx: ToolCallContext,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const r = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (r.status === 204) return undefined as unknown as T
  const body = await r.json().catch(() => null)
  if (!r.ok) {
    const e = body as GraphError | null
    const msg = e?.error?.message ?? `HTTP ${r.status}`
    const code = e?.error?.code ?? 'graph_error'
    throw new Error(`graph(${code}): ${msg}`)
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
  const clientId = process.env.MICROSOFT_CLIENT_ID
  if (!clientId) {
    throw new Error('MICROSOFT_CLIENT_ID is not set')
  }
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state,
    // select_account forces the chooser so users with multiple cached
    // Microsoft accounts can pick the right one rather than silently
    // linking whichever happened to be active.
    prompt: 'select_account',
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
  const { clientId, clientSecret } = await getEnv()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: SCOPES.join(' '),
  })
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await r.json()) as MsTokenResponse
  if (!r.ok || json.error) {
    throw new Error(
      `MS token exchange failed: ${json.error_description ?? json.error ?? 'unknown'}`
    )
  }

  // Fetch user identity for the display label. The integrations row
  // shows "Connected — sarah@acme.com" so the owner can see at a glance
  // which account was linked.
  const profileRes = await fetch(`${GRAPH_BASE}/me`, {
    headers: { Authorization: `Bearer ${json.access_token}` },
  })
  const profile = profileRes.ok
    ? ((await profileRes.json()) as {
        id?: string
        userPrincipalName?: string
        mail?: string
        displayName?: string
      })
    : null

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scopes: (json.scope ?? '').split(' ').filter(Boolean),
    externalAccountId: profile?.id ?? null,
    externalAccountLabel:
      profile?.userPrincipalName ?? profile?.mail ?? profile?.displayName ?? null,
  }
}

async function refresh(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = await getEnv()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPES.join(' '),
  })
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await r.json()) as MsTokenResponse
  if (!r.ok || json.error) {
    throw new Error(
      `MS refresh failed: ${json.error_description ?? json.error ?? 'unknown'}`
    )
  }
  return {
    accessToken: json.access_token,
    // Microsoft sometimes returns a rotated refresh_token, sometimes not.
    // Default to the one we already have so we never blank it out.
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
    scopes: (json.scope ?? '').split(' ').filter(Boolean),
    externalAccountId: null,
    externalAccountLabel: null,
  }
}

// ----- Operations -------------------------------------------------------

type GraphMessage = {
  id: string
  subject?: string
  bodyPreview?: string
  isRead?: boolean
  receivedDateTime?: string
  from?: { emailAddress?: { address?: string; name?: string } }
}

type GraphEvent = {
  id: string
  subject?: string
  start?: { dateTime: string; timeZone?: string }
  end?: { dateTime: string; timeZone?: string }
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string }
    status?: { response?: string }
  }>
  onlineMeeting?: { joinUrl?: string } | null
  bodyPreview?: string
}

type GraphUser = {
  id: string
  displayName?: string
  userPrincipalName?: string
  mail?: string
  jobTitle?: string
}

function getRecentEmails(ctx: ToolCallContext, args: Record<string, unknown>) {
  const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10)))
  return graphFetch<{ value?: GraphMessage[] }>(
    ctx,
    `/me/messages?$top=${limit}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview,isRead`
  ).then((res) => ({
    emails: (res.value ?? []).map((m) => ({
      id: m.id,
      subject: m.subject ?? '',
      from: m.from?.emailAddress?.address ?? null,
      from_name: m.from?.emailAddress?.name ?? null,
      received_at: m.receivedDateTime ?? null,
      preview: (m.bodyPreview ?? '').slice(0, 200),
      is_read: !!m.isRead,
    })),
  }))
}

function searchEmails(ctx: ToolCallContext, args: Record<string, unknown>) {
  const q = String(args.query ?? '').trim()
  if (!q) throw new Error('searchEmails: query required')
  // Graph $search requires ConsistencyLevel: eventual.
  return graphFetch<{ value?: GraphMessage[] }>(
    ctx,
    `/me/messages?$search=${encodeURIComponent(`"${q}"`)}&$top=10&$select=id,subject,from,receivedDateTime,bodyPreview`,
    { headers: { ConsistencyLevel: 'eventual' } }
  ).then((res) => ({
    results: (res.value ?? []).map((m) => ({
      id: m.id,
      subject: m.subject ?? '',
      from: m.from?.emailAddress?.address ?? null,
      received_at: m.receivedDateTime ?? null,
      preview: (m.bodyPreview ?? '').slice(0, 200),
    })),
  }))
}

function getCalendarEvents(ctx: ToolCallContext, args: Record<string, unknown>) {
  const start = args.start
    ? new Date(String(args.start)).toISOString()
    : new Date().toISOString()
  const end = args.end
    ? new Date(String(args.end)).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  return graphFetch<{ value?: GraphEvent[] }>(
    ctx,
    `/me/calendarview?startDateTime=${start}&endDateTime=${end}&$select=id,subject,start,end,attendees,onlineMeeting,bodyPreview&$top=20`
  ).then((res) => ({
    events: (res.value ?? []).map((e) => ({
      id: e.id,
      subject: e.subject ?? '',
      start: e.start?.dateTime ?? null,
      end: e.end?.dateTime ?? null,
      attendee_count: (e.attendees ?? []).length,
      is_online_meeting: !!e.onlineMeeting?.joinUrl,
      preview: (e.bodyPreview ?? '').slice(0, 200),
    })),
  }))
}

async function findMeetingAvailability(
  ctx: ToolCallContext,
  args: Record<string, unknown>
) {
  const attendeesRaw = Array.isArray(args.attendees) ? args.attendees : []
  const attendees = attendeesRaw
    .filter((a): a is string => typeof a === 'string')
    .map((address) => ({
      type: 'required' as const,
      emailAddress: { address },
    }))
  const durationMinutes = Math.max(15, Math.min(240, Number(args.duration_minutes ?? 30)))
  const windowStart = args.window_start
    ? new Date(String(args.window_start)).toISOString()
    : new Date().toISOString()
  const windowEnd = args.window_end
    ? new Date(String(args.window_end)).toISOString()
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  type FindMeetingTimesResponse = {
    meetingTimeSuggestions?: Array<{
      confidence: number
      meetingTimeSlot?: {
        start?: { dateTime: string }
        end?: { dateTime: string }
      }
    }>
  }

  const res = await graphFetch<FindMeetingTimesResponse>(
    ctx,
    '/me/findMeetingTimes',
    {
      method: 'POST',
      body: JSON.stringify({
        attendees,
        timeConstraint: {
          activityDomain: 'work',
          timeSlots: [
            {
              start: { dateTime: windowStart, timeZone: 'UTC' },
              end: { dateTime: windowEnd, timeZone: 'UTC' },
            },
          ],
        },
        meetingDuration: `PT${durationMinutes}M`,
        maxCandidates: 8,
      }),
    }
  )

  return {
    suggestions: (res.meetingTimeSuggestions ?? []).map((s) => ({
      start: s.meetingTimeSlot?.start?.dateTime ?? null,
      end: s.meetingTimeSlot?.end?.dateTime ?? null,
      confidence: s.confidence,
    })),
  }
}

async function findUser(ctx: ToolCallContext, args: Record<string, unknown>) {
  const email = String(args.email ?? '').trim()
  if (!email) throw new Error('findUser: email required')
  try {
    const u = await graphFetch<GraphUser>(
      ctx,
      `/users/${encodeURIComponent(email)}?$select=id,displayName,userPrincipalName,mail,jobTitle`
    )
    return {
      id: u.id,
      name: u.displayName ?? null,
      email: u.mail ?? u.userPrincipalName ?? null,
      title: u.jobTitle ?? null,
    }
  } catch (err) {
    if (err instanceof Error && /not found|Resource.*does not exist/i.test(err.message)) {
      return null
    }
    throw err
  }
}

async function sendEmail(ctx: ToolCallContext, args: Record<string, unknown>) {
  const to = String(args.to ?? '').trim()
  const subject = String(args.subject ?? '').trim()
  const body = String(args.body ?? '').trim()
  if (!to || !subject || !body) {
    throw new Error('sendEmail: to, subject, body all required')
  }
  await graphFetch<void>(ctx, '/me/sendMail', {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'Text', content: body },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  })
  return { ok: true }
}

// ----- Capture matching + enrichment -----------------------------------

function matchesCapture(capture: CaptureForEnrichment): boolean {
  const win = (capture.active_window ?? '').toLowerCase()
  const url = (capture.active_url ?? '').toLowerCase()
  const sw = (capture.software ?? '').toLowerCase()

  // Direct software match (the captures.software field after normalize).
  if (sw === 'outlook' || sw === 'teams' || sw === 'microsoft-365') return true

  // Outlook web + native
  if (win.includes('outlook')) return true
  if (
    url.includes('outlook.office.com') ||
    url.includes('outlook.live.com') ||
    url.includes('outlook.office365.com')
  ) {
    return true
  }

  // Teams web + native (be specific: "teams" alone matches too many things)
  if (win.includes('microsoft teams')) return true
  if (url.includes('teams.microsoft.com')) return true

  // SharePoint + OneDrive
  if (
    url.includes('.sharepoint.com') ||
    url.includes('onedrive.live.com') ||
    url.includes('-my.sharepoint.com')
  ) {
    return true
  }

  return false
}

async function enrichCapture(
  capture: CaptureForEnrichment,
  ctx: ToolCallContext
): Promise<Record<string, unknown> | null> {
  const captureTime = new Date(capture.captured_at)
  const windowStart = new Date(captureTime.getTime() - 30 * 60 * 1000).toISOString()
  const windowEnd = new Date(captureTime.getTime() + 30 * 60 * 1000).toISOString()

  // Fire both Graph queries in parallel — they're independent.
  const [calRes, mailRes] = await Promise.allSettled([
    graphFetch<{ value?: GraphEvent[] }>(
      ctx,
      `/me/calendarview?startDateTime=${windowStart}&endDateTime=${windowEnd}&$select=id,subject,start,end,attendees,onlineMeeting,bodyPreview&$top=5`
    ),
    graphFetch<{ value?: GraphMessage[] }>(
      ctx,
      `/me/messages?$filter=isRead eq false&$top=3&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview`
    ),
  ])

  const events =
    calRes.status === 'fulfilled'
      ? (calRes.value.value ?? []).map((e) => ({
          subject: e.subject ?? '',
          start: e.start?.dateTime ?? null,
          end: e.end?.dateTime ?? null,
          attendees: (e.attendees ?? []).length,
          is_online: !!e.onlineMeeting?.joinUrl,
        }))
      : null

  const unreadEmails =
    mailRes.status === 'fulfilled'
      ? (mailRes.value.value ?? []).map((m) => ({
          subject: m.subject ?? '',
          from: m.from?.emailAddress?.address ?? null,
          received_at: m.receivedDateTime ?? null,
          preview: (m.bodyPreview ?? '').slice(0, 200),
        }))
      : null

  // If both failed, stamp the error reason so we don't re-evaluate.
  if (events === null && unreadEmails === null) {
    const calErr = calRes.status === 'rejected' ? String(calRes.reason).slice(0, 200) : ''
    const mailErr =
      mailRes.status === 'rejected' ? String(mailRes.reason).slice(0, 200) : ''
    return { matched: true, error: `calendar=${calErr} mail=${mailErr}` }
  }

  return {
    matched: true,
    surface: matchedSurface(capture),
    calendar_events: events ?? [],
    unread_emails: unreadEmails ?? [],
  }
}

function matchedSurface(capture: CaptureForEnrichment): string {
  const url = (capture.active_url ?? '').toLowerCase()
  const win = (capture.active_window ?? '').toLowerCase()
  if (url.includes('outlook.') || win.includes('outlook')) return 'outlook'
  if (url.includes('teams.microsoft.com') || win.includes('microsoft teams')) return 'teams'
  if (url.includes('sharepoint.com')) return 'sharepoint'
  if (url.includes('onedrive')) return 'onedrive'
  return 'unknown'
}

// ----- Adapter export --------------------------------------------------

export const microsoft365Adapter: ToolAdapter = {
  toolName: 'microsoft-365',
  oauth: { authorizeUrl, exchangeCode, refresh },
  operations: {
    getRecentEmails,
    searchEmails,
    getCalendarEvents,
    findMeetingAvailability,
    findUser,
    sendEmail,
  },
  matchesCapture,
  enrichCapture,
}
