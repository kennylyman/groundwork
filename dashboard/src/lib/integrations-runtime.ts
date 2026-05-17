/**
 * Tool-call runtime.
 *
 * Single public entry point — callTool(businessId, toolName, operation, args).
 * Resolves the integration row, decrypts the stored token, dispatches to
 * the adapter's named operation, and returns the result.
 *
 * Everywhere in the product that wants to read or write to a customer's
 * connected tool goes through this. Phase 5 automation execution is just
 * a series of callTool calls inside an agent loop. Capture enrichment is
 * a callTool wrapper too.
 *
 * Errors are surfaced verbatim — the caller decides whether to retry,
 * log to capture_enrichments with an error key, or escalate.
 */

import { serverSupabase } from './supabase'
import { decryptToken } from './integrations/crypto'
import { getAdapter, type ToolCallContext } from './integrations/adapters'

export type CallToolResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: string; code: 'not_connected' | 'no_adapter' | 'no_operation' | 'token_decrypt_failed' | 'operation_failed' }

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

  let accessToken: string | null
  try {
    accessToken = decryptToken(integration.access_token_encrypted)
  } catch (err) {
    console.error('callTool: token decrypt failed', { businessId, toolName, err })
    return {
      ok: false,
      error: 'failed to decrypt stored token',
      code: 'token_decrypt_failed',
    }
  }
  if (!accessToken) {
    return {
      ok: false,
      error: 'stored token decrypted to empty string',
      code: 'token_decrypt_failed',
    }
  }

  const ctx: ToolCallContext = {
    businessId,
    toolName,
    accessToken,
    externalAccountId: integration.external_account_id,
    externalAccountLabel: integration.external_account_label,
    scopes: integration.token_scopes ?? [],
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
