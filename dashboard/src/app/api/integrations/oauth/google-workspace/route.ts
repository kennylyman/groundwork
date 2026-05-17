/**
 * GET /api/integrations/oauth/google-workspace
 *
 * Initiates Google OAuth (Google Identity Platform v2). Owner-only.
 * Mints a signed state token carrying (business_id, "google-workspace")
 * and redirects to accounts.google.com.
 *
 * Same shape as the Slack / Microsoft 365 initiators — see the Slack
 * initiator for why each native tool gets its own route file.
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

  const adapter = getAdapter('google-workspace')
  if (!adapter) {
    return NextResponse.json(
      { error: 'google-workspace adapter not registered' },
      { status: 500 }
    )
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get('host')}`
  const redirectUri = `${appUrl}/api/integrations/oauth/callback`

  let authorizeUrl: string
  try {
    const state = createOAuthState(owner.business.id, 'google-workspace')
    authorizeUrl = adapter.oauth.authorizeUrl({ state, redirectUri })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('oauth/google-workspace initiate:', message)
    const back = new URL('/settings/integrations', appUrl)
    back.searchParams.set('error', `google-workspace: ${message}`)
    return NextResponse.redirect(back)
  }

  return NextResponse.redirect(authorizeUrl)
}
