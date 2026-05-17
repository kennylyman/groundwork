/**
 * GET /api/integrations/oauth/slack
 *
 * Initiates Slack OAuth. Owner-only. Mints a signed state token carrying
 * (business_id, "slack") and redirects to Slack's authorize URL. The
 * generic /api/integrations/oauth/callback handles the round trip.
 *
 * Each native tool gets one of these tiny initiator routes. The pattern
 * is identical — the only thing that changes per tool is the adapter
 * name in createOAuthState(...) and the adapter lookup. We keep them as
 * separate files (rather than a [tool] dynamic route) so each one can
 * have tool-specific telemetry, logging, or guardrails as we scale.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveOwner } from '@/lib/auth'
import { getAdapter } from '@/lib/integrations/adapters'
import { createOAuthState } from '@/lib/integrations/oauth-state'

export async function GET(request: NextRequest) {
  const owner = await resolveOwner(request)
  if (!owner) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const adapter = getAdapter('slack')
  if (!adapter) {
    return NextResponse.json({ error: 'slack adapter not registered' }, { status: 500 })
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get('host')}`
  const redirectUri = `${appUrl}/api/integrations/oauth/callback`

  let authorizeUrl: string
  try {
    const state = createOAuthState(owner.business.id, 'slack')
    authorizeUrl = adapter.oauth.authorizeUrl({ state, redirectUri })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('oauth/slack initiate:', message)
    // Bounce to settings with a visible error rather than failing silently.
    const back = new URL('/settings/integrations', appUrl)
    back.searchParams.set('error', `slack: ${message}`)
    return NextResponse.redirect(back)
  }

  return NextResponse.redirect(authorizeUrl)
}
