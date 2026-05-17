/**
 * Slack adapter.
 *
 * OAuth: Slack v2 (https://api.slack.com/authentication/oauth-v2). We ask
 * for bot-scoped tokens (xoxb-*), which don't expire by default. If a
 * workspace has enabled token rotation we'll get a refresh token too; the
 * adapter handles either case.
 *
 * Scopes (bot):
 *   - channels:read   list public channels + their metadata
 *   - chat:write      send messages as the Groundwork bot
 *   - users:read      look up users for routing/mentioning
 *   - channels:history (for enrichment) — needs to be added to the Slack
 *     app manifest before we ship this in prod. For now the adapter
 *     gracefully no-ops on `channels.history` if Slack returns a scope
 *     error.
 *
 * Operations:
 *   - sendMessage(channel, text)
 *   - getChannelHistory(channel, limit?)
 *   - findUser(email)
 *
 * Enrichment:
 *   When a capture lands with a Slack URL like
 *     https://app.slack.com/client/T01XXX/C02YYY/...
 *   the adapter extracts the channel id and fetches the last 5 messages,
 *   storing them under capture_enrichments.slack.
 */

import type {
  CaptureForEnrichment,
  ToolAdapter,
  ToolCallContext,
  TokenResponse,
} from './types'

const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize'
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access'
const SLACK_API_BASE = 'https://slack.com/api'

// Bot scopes Groundwork requests. If you change this list, also update
// the Slack app manifest at api.slack.com/apps and consider whether
// existing connected workspaces need to re-authorize.
const SLACK_BOT_SCOPES = [
  'channels:read',
  'chat:write',
  'users:read',
  'channels:history',
] as const

type SlackOAuthResponse = {
  ok: boolean
  error?: string
  access_token: string
  token_type?: string
  scope: string
  bot_user_id?: string
  app_id?: string
  team?: { id: string; name: string }
  enterprise?: { id: string; name: string } | null
  refresh_token?: string
  expires_in?: number
}

type SlackApiResponse<T> = { ok: boolean; error?: string } & T

async function slackPost<T = Record<string, unknown>>(
  ctx: ToolCallContext,
  endpoint: string,
  body: Record<string, unknown>
): Promise<SlackApiResponse<T>> {
  const r = await fetch(`${SLACK_API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })
  return (await r.json()) as SlackApiResponse<T>
}

async function slackGet<T = Record<string, unknown>>(
  ctx: ToolCallContext,
  endpoint: string,
  params: Record<string, string>
): Promise<SlackApiResponse<T>> {
  const qs = new URLSearchParams(params).toString()
  const r = await fetch(`${SLACK_API_BASE}/${endpoint}?${qs}`, {
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
  })
  return (await r.json()) as SlackApiResponse<T>
}

/** Extract a Slack channel id from a Slack web URL.
 *  Pattern: https://app.slack.com/client/T0XXXXX/C0XXXXX/(thread/...)?
 *  The channel id is the second segment after /client/. */
export function extractSlackChannelId(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/slack\.com\/client\/[A-Z0-9]+\/([A-Z][A-Z0-9]+)/i)
  return m ? m[1] : null
}

export const slackAdapter: ToolAdapter = {
  toolName: 'slack',

  oauth: {
    authorizeUrl: ({ state, redirectUri }) => {
      const clientId = process.env.SLACK_CLIENT_ID
      if (!clientId) {
        throw new Error('SLACK_CLIENT_ID is not set')
      }
      const params = new URLSearchParams({
        client_id: clientId,
        scope: SLACK_BOT_SCOPES.join(','),
        redirect_uri: redirectUri,
        state,
      })
      return `${SLACK_AUTHORIZE_URL}?${params.toString()}`
    },

    exchangeCode: async ({ code, redirectUri }) => {
      const clientId = process.env.SLACK_CLIENT_ID
      const clientSecret = process.env.SLACK_CLIENT_SECRET
      if (!clientId || !clientSecret) {
        throw new Error('SLACK_CLIENT_ID/SECRET not configured')
      }

      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      })
      const r = await fetch(SLACK_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      const json = (await r.json()) as SlackOAuthResponse
      if (!json.ok) {
        throw new Error(`Slack token exchange failed: ${json.error ?? 'unknown'}`)
      }

      const expiresAt =
        typeof json.expires_in === 'number'
          ? new Date(Date.now() + json.expires_in * 1000)
          : null

      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? null,
        expiresAt,
        scopes: (json.scope ?? '').split(',').filter(Boolean),
        externalAccountId: json.team?.id ?? null,
        externalAccountLabel: json.team?.name ?? null,
      } satisfies TokenResponse
    },

    refresh: async (refreshToken) => {
      const clientId = process.env.SLACK_CLIENT_ID
      const clientSecret = process.env.SLACK_CLIENT_SECRET
      if (!clientId || !clientSecret) {
        throw new Error('SLACK_CLIENT_ID/SECRET not configured')
      }
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
      const r = await fetch(SLACK_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      const json = (await r.json()) as SlackOAuthResponse
      if (!json.ok) {
        throw new Error(`Slack refresh failed: ${json.error ?? 'unknown'}`)
      }
      const expiresAt =
        typeof json.expires_in === 'number'
          ? new Date(Date.now() + json.expires_in * 1000)
          : null
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? refreshToken,
        expiresAt,
        scopes: (json.scope ?? '').split(',').filter(Boolean),
        externalAccountId: json.team?.id ?? null,
        externalAccountLabel: json.team?.name ?? null,
      } satisfies TokenResponse
    },
  },

  operations: {
    /** sendMessage(channel, text) — channel can be id (C0...) or name (#general). */
    sendMessage: async (ctx, args) => {
      const channel = String(args.channel ?? '').trim()
      const text = String(args.text ?? '').trim()
      if (!channel) throw new Error('sendMessage: channel required')
      if (!text) throw new Error('sendMessage: text required')
      const json = await slackPost<{ ts: string; channel: string }>(
        ctx,
        'chat.postMessage',
        { channel, text }
      )
      if (!json.ok) throw new Error(`slack.chat.postMessage: ${json.error}`)
      return { ts: json.ts, channel: json.channel }
    },

    /** getChannelHistory(channel, limit?) — returns recent messages. */
    getChannelHistory: async (ctx, args) => {
      const channel = String(args.channel ?? '').trim()
      const limit = Math.min(
        Math.max(1, Number(args.limit ?? 5) || 5),
        50
      )
      if (!channel) throw new Error('getChannelHistory: channel required')
      const json = await slackGet<{
        messages: Array<{
          ts: string
          user?: string
          text?: string
          subtype?: string
        }>
      }>(ctx, 'conversations.history', {
        channel,
        limit: String(limit),
      })
      if (!json.ok) throw new Error(`slack.conversations.history: ${json.error}`)
      return {
        messages: (json.messages ?? []).map((m) => ({
          ts: m.ts,
          user: m.user ?? null,
          text: m.text ?? '',
          subtype: m.subtype ?? null,
        })),
      }
    },

    /** findUser(email) — used for routing automations to a real person. */
    findUser: async (ctx, args) => {
      const email = String(args.email ?? '').trim().toLowerCase()
      if (!email) throw new Error('findUser: email required')
      const json = await slackGet<{
        user?: { id: string; name: string; real_name?: string }
      }>(ctx, 'users.lookupByEmail', { email })
      if (!json.ok) {
        if (json.error === 'users_not_found') return null
        throw new Error(`slack.users.lookupByEmail: ${json.error}`)
      }
      return json.user
        ? {
            id: json.user.id,
            name: json.user.name,
            real_name: json.user.real_name ?? null,
          }
        : null
    },
  },

  matchesCapture: (capture) => {
    if (extractSlackChannelId(capture.active_url)) return true
    const sw = (capture.software ?? '').toLowerCase()
    if (sw === 'slack') return true
    const win = (capture.active_window ?? '').toLowerCase()
    return win.includes('slack')
  },

  enrichCapture: async (capture, ctx) => {
    const channelId = extractSlackChannelId(capture.active_url)
    if (!channelId) {
      // No channel id parseable — we know it's Slack but can't fetch
      // context. Stamp a marker so the cron doesn't re-evaluate.
      return { matched: true, reason: 'no_channel_id_in_url' }
    }

    const json = await slackGet<{
      messages: Array<{
        ts: string
        user?: string
        text?: string
        subtype?: string
      }>
    }>(ctx, 'conversations.history', {
      channel: channelId,
      limit: '5',
    })

    if (!json.ok) {
      // The most likely failures: missing_scope (channels:history not
      // granted), channel_not_found (private channel the bot isn't in),
      // not_in_channel (public channel the bot needs to join). Surface
      // the reason so the settings UI can prompt a re-auth if needed.
      return { matched: true, error: json.error ?? 'unknown' }
    }

    return {
      matched: true,
      channel_id: channelId,
      messages: (json.messages ?? []).map((m) => ({
        ts: m.ts,
        user: m.user ?? null,
        // Truncate to keep the row bounded.
        text: (m.text ?? '').slice(0, 500),
        subtype: m.subtype ?? null,
      })),
    }
  },
}

export function _testHooks() {
  // For unit tests — exposes the channel-id extractor without the heavy
  // adapter wiring. Used by classification fixtures.
  return { extractSlackChannelId }
}
