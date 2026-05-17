/**
 * GET /api/agent-version
 *
 * Public endpoint the Windows agent calls on startup (and at the start of
 * each capture loop iteration) to learn:
 *   - latest_version       — newest release; agent soft-updates at next idle
 *   - min_supported_version — floor; agent hard-updates immediately on startup
 *   - download_url         — GitHub release URL the agent fetches
 *   - sha256               — agent verifies before swapping the exe
 *   - release_notes        — informational, shown in settings UI
 *
 * The agent also passes ?employee_id= and ?current_version= so we can
 * record a heartbeat on employees.agent_version. The heartbeat is
 * best-effort: a failed update never affects the response.
 *
 * No auth gate. Anyone can read release metadata — it's already public on
 * GitHub Releases. The heartbeat write uses service-role to bypass RLS on
 * the employees table.
 */
import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'

type ReleaseRow = {
  version: string
  download_url: string
  sha256: string
  release_notes: string | null
}

export async function GET(request: NextRequest) {
  const supabase = serverSupabase()

  // Pull latest + min_supported in parallel. Both can legitimately be
  // missing (fresh deploy, no releases yet) — the agent treats null
  // versions as "no update available".
  const [latestRes, minSupportedRes] = await Promise.all([
    supabase
      .from('agent_releases')
      .select('version, download_url, sha256, release_notes')
      .eq('is_latest', true)
      .maybeSingle(),
    supabase
      .from('agent_releases')
      .select('version')
      .eq('is_min_supported', true)
      .maybeSingle(),
  ])

  const latest = latestRes.data as ReleaseRow | null
  const minSupportedVersion = (minSupportedRes.data?.version as string | undefined) ?? null

  // Heartbeat write — fire-and-forget from the caller's perspective.
  // We await it so the function doesn't return before the write commits,
  // but failures don't propagate.
  const employeeId = request.nextUrl.searchParams.get('employee_id')?.trim()
  const currentVersion = request.nextUrl.searchParams.get('current_version')?.trim()
  if (employeeId && currentVersion) {
    const { error: hbErr } = await supabase
      .from('employees')
      .update({
        agent_version: currentVersion,
        agent_version_updated_at: new Date().toISOString(),
      })
      .eq('id', employeeId)
    if (hbErr) {
      console.error('agent-version: heartbeat failed', hbErr)
    }
  }

  // Cache policy: with employee_id present, the agent is checking in for
  // a heartbeat — we MUST hit the server every time so employees.agent_version
  // gets recorded. Without employee_id (a polling client like the settings
  // page), 60s edge cache is fine.
  const cacheControl = employeeId
    ? 'no-store'
    : 'public, max-age=60, s-maxage=60'

  return NextResponse.json(
    {
      latest_version: latest?.version ?? null,
      min_supported_version: minSupportedVersion,
      download_url: latest?.download_url ?? null,
      sha256: latest?.sha256 ?? null,
      release_notes: latest?.release_notes ?? null,
    },
    {
      headers: {
        'Cache-Control': cacheControl,
      },
    }
  )
}
