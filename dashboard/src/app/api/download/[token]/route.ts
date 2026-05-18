/**
 * GET /api/download/[token]
 *
 * Serves the Groundwork.exe binary by 302-redirecting to the GitHub
 * release URL — but ONLY if the per-employee install_token has not yet
 * been redeemed. Atomically claims redemption via a conditional update
 * (set install_token_redeemed_at = now() WHERE install_token_redeemed_at
 * IS NULL), so concurrent clicks race cleanly: exactly one wins.
 *
 * Why a server endpoint instead of a direct <a href="github.com/...">:
 * we need to observe the click to set the redemption timestamp. Direct
 * links to GitHub releases would bypass that gate entirely.
 *
 * Auth: the install_token in the URL is itself the auth credential.
 * No additional cookie / session required — this is the same posture as
 * /install/[token], which the invite email links to. The token is a
 * 32-byte hex string seeded via gen_random_bytes; brute force isn't
 * feasible at any rate we'd care about.
 *
 * Redemption is recorded the moment we redirect, not when the download
 * completes (which we can't observe). The spec is "when the binary is
 * actually served" — once we 302, the user's browser is fetching the
 * binary, and we've handed off the chain of custody.
 *
 * Failure modes:
 *   - Invalid token → 302 back to /install/[token], which 404s.
 *   - Already redeemed → 302 back to /install/[token], which renders
 *     the LinkUsedNotice. Lets the user see a meaningful page instead
 *     of a bare 410.
 *   - DB error → 500.
 */

import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'

const RELEASE_URL =
  'https://github.com/kennylyman/groundwork/releases/latest/download/Groundwork.exe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  const supabase = serverSupabase()

  // Atomic claim: only succeeds if install_token_redeemed_at is still
  // null. The .is() filter on the predicate column makes this a single
  // SQL UPDATE that postgres serializes; no read-then-write race.
  // RETURNING tells us whether a row was actually claimed.
  const { data: claimed, error } = await supabase
    .from('employees')
    .update({ install_token_redeemed_at: new Date().toISOString() })
    .eq('install_token', token)
    .is('install_token_redeemed_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('download: redemption update failed', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }

  if (!claimed) {
    // Either no employee has this token, or it was already redeemed.
    // Either way, bounce back to /install/[token] — that page handles
    // both cases (404 for unknown token, LinkUsedNotice for redeemed).
    return NextResponse.redirect(
      new URL(`/install/${encodeURIComponent(token)}`, request.url),
      302
    )
  }

  // We hold the claim. Hand the user off to the binary.
  return NextResponse.redirect(RELEASE_URL, 302)
}
