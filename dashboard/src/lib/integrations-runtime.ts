/**
 * Tool-call runtime.
 *
 * Single public entry point — callTool(businessId, toolName, operation, args).
 * Resolves the integration row, decrypts the stored token, refreshes it
 * if expired, dispatches to the adapter's named operation, and returns
 * the result.
 *
 * Everywhere in the product that wants to read or write to a customer's
 * connected tool goes through this. Phase 5 automation execution is just
 * a series of callTool calls inside an agent loop. Capture enrichment is
 * a callTool wrapper too.
 *
 * Just-in-time token refresh:
 *   Microsoft 365 access tokens expire in ~1 hour. HubSpot is similar.
 *   The daily refresh cron is too slow to keep these usable — by hour 2
 *   the access token is dead. So every callTool checks token_expires_at
 *   before invoking the operation; if it's within REFRESH_SAFETY_MS of
 *   expiry, we refresh inline first.
 *
 *   This also means the daily refresh cron isn't strictly necessary for
 *   correctness — JIT covers any operation that's actually called.
 *   The cron still has value as a safety net for tokens that are about
 *   to lose their refresh-token validity (e.g., Microsoft's refresh
 *   token rotates every refresh, so we want to keep it fresh even when
 *   nobody's calling the integration).
 */

import { serverSupabase } from './supabase'
import { decryptToken, encryptToken } from './integrations/crypto'
import {
  getAdapter,
  type ToolAdapter,
  type ToolCallContext,
} from './integrations/adapters'

export type CallToolResult<T = unknown> =
  | { ok: true; result: T }
  | {
      ok: false
      error: string
      code:
        | 'not_connected'
        | 'no_adapter'
        | 'no_operation'
        | 'token_decrypt_failed'
        | 'token_refresh_failed'
        | 'operation_failed'
    }

type IntegrationRow = {
  id: string
  tool_name: string
  ring: number
  status: string
  access_token_encrypted: string | null
  refresh_token_encrypted: string | null
  token_scopes: string[] | null
  token_expires_at: string | null
  external_account_id: string | null
  external_account_label: string | null
}

/** If token expires within this window, refresh before using. 5 minutes
 *  gives us enough margin to survive clock skew + the operation's own
 *  duration without the access token dying mid-call. */
const REFRESH_SAFETY_MS = 5 * 60 * 1000

async function loadIntegration(
  businessId: string,
  toolName: string
): Promise<IntegrationRow | null> {
  const supabase = serverSupabase()
  // Prefer Ring 3 (native) if present; fall back to Ring 2 only if it
  // somehow has a token (it shouldn't, but stay forgiving).
  const { data } = await supabase
    .from('integrations')
    .select(
      'id, tool_name, ring, status, access_token_encrypted, refresh_token_encrypted, token_scopes, token_expires_at, external_account_id, external_account_label'
    )
    .eq('business_id', businessId)
    .eq('tool_name', toolName)
    .not('access_token_encrypted', 'is', null)
    .order('ring', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as IntegrationRow | null
}

function tokenIsStale(row: IntegrationRow): boolean {
  if (!row.token_expires_at) return false // null = never expires
  const expiresAt = new Date(row.token_expires_at).getTime()
  return expiresAt - Date.now() <= REFRESH_SAFETY_MS
}

/** Refresh the stored token via the adapter and persist the new values.
 *  Returns the freshly-decrypted access token + scopes on success.
 *  Throws on any failure — caller decides whether to swallow or surface. */
async function refreshTokenInline(
  row: IntegrationRow,
  adapter: ToolAdapter
): Promise<{
  accessToken: string
  scopes: string[]
  externalAccountId: string | null
  externalAccountLabel: string | null
}> {
  if (!adapter.oauth.refresh) {
    throw new Error('adapter has no refresh method')
  }
  if (!row.refresh_token_encrypted) {
    throw new Error('integration has no refresh token stored')
  }
  const refreshToken = decryptToken(row.refresh_token_encrypted)
  if (!refreshToken) {
    throw new Error('refresh token decrypted to empty')
  }

  const next = await adapter.oauth.refresh(refreshToken)

  const supabase = serverSupabase()
  const { error } = await supabase
    .from('integrations')
    .update({
      access_token_encrypted: encryptToken(next.accessToken),
      refresh_token_encrypted: next.refreshToken
        ? encryptToken(next.refreshToken)
        : row.refresh_token_encrypted,
      token_scopes: next.scopes.length ? next.scopes : row.token_scopes,
      token_expires_at: next.expiresAt ? next.expiresAt.toISOString() : null,
      // A successful refresh restores 'connected' if a prior failure
      // marked us 'error'.
      status: 'connected',
    })
    .eq('id', row.id)
  if (error) {
    // The refresh succeeded but we couldn't persist — the new tokens are
    // already valid at the provider, so use them for this request and
    // accept that the next call will refresh again.
    console.error('refreshTokenInline: persist failed', error)
  }

  return {
    accessToken: next.accessToken,
    scopes: next.scopes.length ? next.scopes : row.token_scopes ?? [],
    externalAccountId: next.externalAccountId ?? row.external_account_id,
    externalAccountLabel: next.externalAccountLabel ?? row.external_account_label,
  }
}

/** Build a ToolCallContext from an integration row, refreshing the token
 *  inline if it's stale. Shared between callTool and the enrich-captures
 *  cron so both get the same refresh behavior.
 *
 *  Exported so the enrichment cron can use it without going through the
 *  callTool dispatch layer (it has its own loop over captures). */
export async function buildContextWithRefresh(
  row: IntegrationRow,
  adapter: ToolAdapter
): Promise<ToolCallContext> {
  let accessToken: string | null
  let scopes = row.token_scopes ?? []
  let externalAccountId = row.external_account_id
  let externalAccountLabel = row.external_account_label

  if (tokenIsStale(row) && adapter.oauth.refresh && row.refresh_token_encrypted) {
    const refreshed = await refreshTokenInline(row, adapter)
    accessToken = refreshed.accessToken
    scopes = refreshed.scopes
    externalAccountId = refreshed.externalAccountId
    externalAccountLabel = refreshed.externalAccountLabel
  } else {
    accessToken = decryptToken(row.access_token_encrypted)
  }

  if (!accessToken) {
    throw new Error('no usable access token')
  }

  return {
    businessId: row.id, // overwritten below if caller wants the real business id
    toolName: row.tool_name,
    accessToken,
    externalAccountId,
    externalAccountLabel,
    scopes,
  }
}

export async function callTool<T = unknown>(
  businessId: string,
  toolName: string,
  operation: string,
  args: Record<string, unknown> = {}
): Promise<CallToolResult<T>> {
  const adapter = getAdapter(toolName)
  if (!adapter) {
    return { ok: false, error: `no adapter for tool ${toolName}`, code: 'no_adapter' }
  }
  const op = adapter.operations[operation]
  if (!op) {
    return {
      ok: false,
      error: `adapter ${toolName} has no operation ${operation}`,
      code: 'no_operation',
    }
  }

  const integration = await loadIntegration(businessId, toolName)
  if (!integration || !integration.access_token_encrypted) {
    return {
      ok: false,
      error: `${toolName} not connected for business ${businessId}`,
      code: 'not_connected',
    }
  }

  // Build the context, refreshing inline if the access token is stale.
  let ctx: ToolCallContext
  try {
    const built = await buildContextWithRefresh(integration, adapter)
    ctx = { ...built, businessId }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    if (/refresh/i.test(message) || /no refresh token/i.test(message)) {
      console.error('callTool: refresh failed', { businessId, toolName, err: message })
      // Mark the row 'error' so the UI knows to prompt a re-auth, but
      // don't blank the access token — it may still work for a bit.
      const supabase = serverSupabase()
      await supabase
        .from('integrations')
        .update({ status: 'error' })
        .eq('id', integration.id)
      return {
        ok: false,
        error: `token refresh failed: ${message}`,
        code: 'token_refresh_failed',
      }
    }
    console.error('callTool: context build failed', { businessId, toolName, err: message })
    return {
      ok: false,
      error: message,
      code: 'token_decrypt_failed',
    }
  }

  const startedAt = Date.now()
  try {
    const result = await op(ctx, args)
    const ms = Date.now() - startedAt
    // Light call log so we can spot regressions / unusual latencies in
    // Vercel function logs without committing to a separate DB table yet.
    console.log(
      `callTool ok tool=${toolName} op=${operation} business=${businessId} ms=${ms}`
    )
    return { ok: true, result: result as T }
  } catch (err) {
    const ms = Date.now() - startedAt
    const message = err instanceof Error ? err.message : 'unknown'
    console.error(
      `callTool fail tool=${toolName} op=${operation} business=${businessId} ms=${ms} err=${message}`
    )
    return { ok: false, error: message, code: 'operation_failed' }
  }
}

/** True iff the business has any active native integration for this tool. */
export async function hasActiveIntegration(
  businessId: string,
  toolName: string
): Promise<boolean> {
  const row = await loadIntegration(businessId, toolName)
  return !!row && !!row.access_token_encrypted && row.status !== 'disconnected'
}
