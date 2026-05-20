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

/** Allowed platform values — matches the CHECK on agent_releases.platform. */
const PLATFORMS = ['windows', 'mac', 'linux'] as const
type Platform = (typeof PLATFORMS)[number]

function resolvePlatform(request: NextRequest): Platform {
  // Header is authoritative when set (agents from v0.5.9+ send it).
  // Older agents (≤v0.5.8) never sent the header — they're all Windows.
  // Default 'windows' preserves their behavior with no protocol break.
  const header = request.headers.get('x-groundwork-platform')?.trim().toLowerCase()
  if (header && (PLATFORMS as readonly string[]).includes(header)) {
    return header as Platform
  }
  return 'windows'
}

export async function GET(request: NextRequest) {
  const supabase = serverSupabase()
  const employeeId = request.nextUrl.searchParams.get('employee_id')?.trim()
  const platform = resolvePlatform(request)

  // Pull latest + min_supported FILTERED BY PLATFORM — each platform has
  // its own invariant of exactly-one-is_latest and exactly-one-is_min_supported
  // row. A Mac agent asking for the floor must not see the Windows .exe.
  const [latestRes, minSupportedRes] = await Promise.all([
    supabase
      .from('agent_releases')
      .select('version, download_url, sha256, release_notes')
      .eq('is_latest', true)
      .eq('platform', platform)
      .maybeSingle(),
    supabase
      .from('agent_releases')
      .select('version')
      .eq('is_min_supported', true)
      .eq('platform', platform)
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
      .eq('platform', platform)
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
        // Persist last-reported platform — used by /api/download/[token]
        // to serve the right binary when the user re-downloads after
        // re-invite. Stored on every heartbeat to track machine changes
        // (employee gets a new MacBook, etc.).
        platform,
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
  //
  // Vary: when the response IS cacheable, partition the edge cache by
  // X-Groundwork-Platform so a Mac probe and a Windows probe don't share
  // a single cache entry. Without this, the first uncached request after
  // a deploy wins for 60s — observed in the v0.5.9 promotion: a Mac probe
  // returned the Windows download_url because a Windows probe had warmed
  // the edge cache 30s earlier. Real agent calls always set employee_id
  // (→ no-store) so they were never affected, but settings-page / manual
  // probes saw the wrong response.
  const cacheControl = employeeId
    ? 'no-store'
    : 'public, max-age=60, s-maxage=60'

  const headers: Record<string, string> = { 'Cache-Control': cacheControl }
  if (!employeeId) {
    headers['Vary'] = 'X-Groundwork-Platform'
  }

  return NextResponse.json(
    {
      latest_version: latest?.version ?? null,
      min_supported_version: minSupportedVersion,
      download_url: latest?.download_url ?? null,
      sha256: latest?.sha256 ?? null,
      release_notes: latest?.release_notes ?? null,
    },
    { headers }
  )
}
