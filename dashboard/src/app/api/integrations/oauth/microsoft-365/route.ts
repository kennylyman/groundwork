/**
 * GET /api/integrations/oauth/microsoft-365
 *
 * Initiates Microsoft 365 OAuth (Microsoft Identity Platform v2.0).
 * Owner-only. Mints a signed state token carrying (business_id,
 * "microsoft-365") and redirects to login.microsoftonline.com/common.
 *
 * Same shape as the Slack initiator — see comments there for why each
 * native tool gets its own initiate route.
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

  const adapter = getAdapter('microsoft-365')
  if (!adapter) {
    return NextResponse.json(
      { error: 'microsoft-365 adapter not registered' },
      { status: 500 }
    )
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get('host')}`
  const redirectUri = `${appUrl}/api/integrations/oauth/callback`

  let authorizeUrl: string
  try {
    const state = createOAuthState(owner.business.id, 'microsoft-365')
    authorizeUrl = adapter.oauth.authorizeUrl({ state, redirectUri })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('oauth/microsoft-365 initiate:', message)
    const back = new URL('/settings/integrations', appUrl)
    back.searchParams.set('error', `microsoft-365: ${message}`)
    return NextResponse.redirect(back)
  }

  return NextResponse.redirect(authorizeUrl)
}
