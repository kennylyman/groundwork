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

/** Parse "0.5.0" into [0, 5, 0]. Returns [] if input is unparseable so
 *  comparisons against it cleanly say "stable wins". */
function parseVersionTuple(v: string | null): number[] {
  if (!v) return []
  const raw = v.split('-')[0]
  const parts = raw.split('.').map((p) => Number(p))
  if (parts.some((n) => !Number.isFinite(n))) return []
  return parts
}

function compareVersionTuples(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai !== bi) return ai - bi
  }
  return 0
}

export async function GET(request: NextRequest) {
  const supabase = serverSupabase()
  const employeeId = request.nextUrl.searchParams.get('employee_id')?.trim()

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

  let latest = latestRes.data as ReleaseRow | null
  const minSupportedVersion = (minSupportedRes.data?.version as string | undefined) ?? null

  // Canary check: when the request identifies the employee, look for a
  // canary release whose canary_employee_ids array includes this id. If
  // found AND it's a newer version than the current stable latest,
  // override the response so this specific agent gets the canary.
  // Without a valid employee_id (settings-page polling, generic probe),
  // the canary lookup is skipped and we return the stable latest.
  if (employeeId) {
    const { data: canaryRow } = await supabase
      .from('agent_releases')
      .select('version, download_url, sha256, release_notes')
      .eq('is_canary', true)
      .contains('canary_employee_ids', [employeeId])
      .order('released_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (canaryRow) {
      // Only return the canary if it's a strictly newer version than the
      // current stable latest. Otherwise serving an older canary would
      // downgrade the agent — never what we want.
      const stableV = parseVersionTuple(latest?.version ?? null)
      const canaryV = parseVersionTuple((canaryRow.version as string) ?? null)
      if (canaryV.length > 0 && compareVersionTuples(canaryV, stableV) > 0) {
        latest = canaryRow as ReleaseRow
      }
    }
  }

  // Heartbeat write — fire-and-forget from the caller's perspective.
  // We await it so the function doesn't return before the write commits,
  // but failures don't propagate. employeeId was already pulled above for
  // the canary lookup.
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
