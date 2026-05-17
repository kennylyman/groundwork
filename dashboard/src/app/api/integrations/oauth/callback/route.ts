/**
 * GET /api/integrations/oauth/callback
 *
 * Generic OAuth callback. Every native tool initiator sends the user to
 * its provider's authorize URL with a state token; the provider redirects
 * back here with ?code=...&state=... (or ?error=...). We:
 *
 *   1. Verify the signed state (rejects tampering + > 10 min old).
 *   2. Look up the adapter by tool name embedded in state.
 *   3. Exchange the auth code for tokens.
 *   4. Encrypt + upsert the integrations row.
 *   5. Redirect back to /settings/integrations with a status param.
 *
 * Failures redirect with ?error=... — never leak raw provider errors to
 * the user, but log the details server-side for support.
 */
import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'
import { getAdapter } from '@/lib/integrations/adapters'
import { encryptToken } from '@/lib/integrations/crypto'
import { verifyOAuthState } from '@/lib/integrations/oauth-state'

function appUrl(request: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    `https://${request.headers.get('host') ?? 'localhost'}`
  )
}

function redirectBack(
  request: NextRequest,
  params: Record<string, string>
): NextResponse {
  const url = new URL('/settings/integrations', appUrl(request))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const u = request.nextUrl

  // Provider-side error (user clicked "Cancel" on the consent screen, etc.)
  const providerError = u.searchParams.get('error')
  if (providerError) {
    console.warn('oauth/callback: provider returned error', providerError)
    return redirectBack(request, { error: `auth cancelled: ${providerError}` })
  }

  const code = u.searchParams.get('code')
  const state = u.searchParams.get('state')
  if (!code || !state) {
    return redirectBack(request, { error: 'missing code or state' })
  }

  const verified = verifyOAuthState(state)
  if (!verified) {
    console.warn('oauth/callback: state verification failed')
    return redirectBack(request, { error: 'invalid or expired auth state' })
  }
  const { businessId, tool } = verified

  const adapter = getAdapter(tool)
  if (!adapter) {
    console.error('oauth/callback: no adapter for tool', tool)
    return redirectBack(request, { error: `no adapter for ${tool}` })
  }

  const redirectUri = `${appUrl(request)}/api/integrations/oauth/callback`

  let tokens
  try {
    tokens = await adapter.oauth.exchangeCode({ code, redirectUri })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('oauth/callback: token exchange failed', { tool, err: message })
    return redirectBack(request, { error: `token exchange failed: ${message}` })
  }

  const supabase = serverSupabase()

  // Look up an existing row for (business, tool, ring=3). Multiple OAuth
  // flows into the same business overwrite — last write wins, with the
  // new external_account_id/label so the settings page reflects whichever
  // workspace the owner most recently linked.
  const { data: existing } = await supabase
    .from('integrations')
    .select('id, config, event_count')
    .eq('business_id', businessId)
    .eq('tool_name', tool)
    .eq('ring', 3)
    .maybeSingle()

  const row = {
    business_id: businessId,
    tool_name: tool,
    ring: 3 as const,
    status: 'connected' as const,
    connected_at: new Date().toISOString(),
    access_token_encrypted: encryptToken(tokens.accessToken),
    refresh_token_encrypted: tokens.refreshToken
      ? encryptToken(tokens.refreshToken)
      : null,
    token_scopes: tokens.scopes,
    token_expires_at: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
    external_account_id: tokens.externalAccountId,
    external_account_label: tokens.externalAccountLabel,
    config: {
      ...(existing?.config ?? {}),
      display_name: tokens.externalAccountLabel ?? tool,
    },
  }

  let upsertErr
  if (existing) {
    const { error } = await supabase
      .from('integrations')
      .update(row)
      .eq('id', existing.id)
    upsertErr = error
  } else {
    const { error } = await supabase.from('integrations').insert(row)
    upsertErr = error
  }

  if (upsertErr) {
    console.error('oauth/callback: integration upsert failed', upsertErr)
    return redirectBack(request, { error: 'could not store tokens' })
  }

  // Land back on settings with a success banner showing which workspace
  // was linked, so the owner can confirm at a glance.
  return redirectBack(request, {
    connected: tool,
    account: tokens.externalAccountLabel ?? '',
  })
}
