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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Resolve which binary URL to serve based on platform. Falls back to
 *  the GitHub `latest` tag for backward compatibility — agents from
 *  before v0.5.9 don't have platform-specific assets, and the existing
 *  `Groundwork.exe` URL still points at the freshest Windows build. */
async function resolveDownloadUrl(
  supabase: ReturnType<typeof serverSupabase>,
  platform: 'windows' | 'mac'
): Promise<string> {
  const { data: row } = await supabase
    .from('agent_releases')
    .select('download_url')
    .eq('is_latest', true)
    .eq('platform', platform)
    .maybeSingle()
  if (row?.download_url) return row.download_url
  // Fallback: the GitHub `latest` tag. Always serves the most recent
  // Windows binary published by build.yml. Used when no platform-
  // specific row exists yet (e.g. the very first Mac build is still
  // in CI).
  return platform === 'mac'
    ? 'https://github.com/kennylyman/groundwork/releases/latest/download/Groundwork-mac'
    : 'https://github.com/kennylyman/groundwork/releases/latest/download/Groundwork.exe'
}

function detectPlatformFromUA(ua: string | null): 'windows' | 'mac' | null {
  if (!ua) return null
  const lc = ua.toLowerCase()
  if (lc.includes('mac os x') || lc.includes('macintosh')) return 'mac'
  if (lc.includes('windows')) return 'windows'
  return null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  // Platform resolution order:
  //   1. Explicit ?platform=... query param (set by the install page's
  //      "Need Mac?" toggle so users can override OS detection)
  //   2. The employee's most-recently-reported platform on their row
  //      (when they're re-downloading after a re-invite)
  //   3. The visitor's User-Agent header
  //   4. Default to 'windows' (Comfort Keepers' default platform)
  const queryPlatform = request.nextUrl.searchParams.get('platform')
  const supabase = serverSupabase()

  // Look up the employee row (with their platform) BEFORE atomic claim,
  // so we know which binary to serve even if the claim fails (we don't
  // actually need claim success to know the platform).
  const { data: empRow } = await supabase
    .from('employees')
    .select('id, platform')
    .eq('install_token', token)
    .maybeSingle()
  const employeePlatform = empRow?.platform as 'windows' | 'mac' | 'linux' | null

  let platform: 'windows' | 'mac' = 'windows'
  if (queryPlatform === 'mac' || queryPlatform === 'windows') {
    platform = queryPlatform
  } else if (employeePlatform === 'mac' || employeePlatform === 'windows') {
    platform = employeePlatform
  } else {
    const fromUA = detectPlatformFromUA(request.headers.get('user-agent'))
    if (fromUA) platform = fromUA
  }

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

  // We hold the claim. Resolve the appropriate binary for this platform
  // and hand the user off.
  const releaseUrl = await resolveDownloadUrl(supabase, platform)
  return NextResponse.redirect(releaseUrl, 302)
}
