/**
 * Common types every tool adapter implements.
 *
 * An adapter is a self-contained module that knows:
 *   1. How to start an OAuth flow for the tool (authorizeUrl)
 *   2. How to exchange an authorization code for tokens (exchangeCode)
 *   3. Optional: how to refresh an expiring access token (refresh)
 *   4. The named operations callers can invoke (operations: { sendMessage,
 *      getChannelHistory, ... })
 *   5. Optional: how to enrich a capture with live tool data
 *      (enrichCapture — called by the enrichment cron when a capture's
 *      software matches this adapter)
 *
 * Adding a new tool = adding a new adapter file + registering it in
 * adapters/index.ts. The runtime, the OAuth callback handler, the refresh
 * cron, and the enrichment cron all stay generic.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** What an OAuth `exchangeCode` or `refresh` call returns to the adapter
 *  layer. Adapter normalizes provider-specific shape into this. */
export type TokenResponse = {
  accessToken: string
  /** Optional — only set when the provider issues a separate long-lived
   *  refresh token (Google, Microsoft, HubSpot). For non-expiring tokens
   *  (Slack bot, Stripe), leave both refreshToken and expiresAt null. */
  refreshToken?: string | null
  /** When the access token stops working. null = never expires. */
  expiresAt?: Date | null
  /** Scopes the user actually granted (may be a subset of what we asked). */
  scopes: string[]
  /** Provider's account id — Slack team id, HubSpot portal id, etc. */
  externalAccountId: string | null
  /** Human-readable label shown on the settings page. */
  externalAccountLabel: string | null
}

/** Context passed into every operation/enrichment call. Adapters get the
 *  decrypted token plus enough metadata to talk to the provider on the
 *  caller's behalf. */
export type ToolCallContext = {
  businessId: string
  toolName: string
  accessToken: string
  externalAccountId: string | null
  externalAccountLabel: string | null
  scopes: string[]
}

/** A subset of the captures row that adapters need for enrichment. The
 *  enrichment cron passes this in; adapters return a jsonb-shaped object
 *  that gets merged into capture_enrichments. */
export type CaptureForEnrichment = {
  id: string
  business_id: string
  employee_id: string
  software: string | null
  active_window: string | null
  active_url: string | null
  task: string | null
  category: string | null
  captured_at: string
}

export type OperationFn = (
  ctx: ToolCallContext,
  args: Record<string, unknown>
) => Promise<unknown>

export type ToolAdapter = {
  /** Canonical tool id matching captures.software and integrations.tool_name
   *  after normalizeToolName. Must match what's in lib/integrations.ts
   *  TOOL_REGISTRY. */
  toolName: string

  oauth: {
    authorizeUrl: (params: {
      state: string
      redirectUri: string
    }) => string
    exchangeCode: (params: {
      code: string
      redirectUri: string
    }) => Promise<TokenResponse>
    /** Optional. Adapter omits this for tokens that don't expire. */
    refresh?: (refreshToken: string) => Promise<TokenResponse>
  }

  operations: Record<string, OperationFn>

  /**
   * Decide whether this adapter can enrich a given capture. The enrichment
   * cron calls this before fetching anything — return false fast for
   * captures the adapter has nothing to add to.
   */
  matchesCapture?: (capture: CaptureForEnrichment) => boolean

  /**
   * Fetch live context from the tool and return a jsonb-shaped object
   * that becomes capture_enrichments[toolName]. Return null to skip.
   */
  enrichCapture?: (
    capture: CaptureForEnrichment,
    ctx: ToolCallContext,
    supabase: SupabaseClient
  ) => Promise<Record<string, unknown> | null>
}
