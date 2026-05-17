/**
 * GET    /api/settings/releases
 * PATCH  /api/settings/releases   { action: "set_min_supported", version: "0.4.0" | null }
 *
 * Owner-only view + management of the agent_releases table.
 *
 * GET returns each released version plus a count of how many of the
 * caller's employees are currently running it (joined via the
 * employees.agent_version heartbeat). Employees on no recorded version
 * yet (never heartbeated) are bucketed as "unknown".
 *
 * PATCH today supports one action: setting / clearing the min_supported
 * floor. Promoting a release to "latest" is driven by GitHub Actions on
 * each merge — the UI shouldn't fork that path. If you ever need a manual
 * promote, add an action here that calls promote_agent_release.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveOwner } from '@/lib/auth'
import { serverSupabase } from '@/lib/supabase'

type ReleaseRow = {
  version: string
  download_url: string
  sha256: string
  release_notes: string | null
  is_latest: boolean
  is_min_supported: boolean
  released_at: string
}

export async function GET(request: NextRequest) {
  const owner = await resolveOwner(request)
  if (!owner) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serverSupabase()

  // Releases (global, not per-business) + this business's employee
  // versions in parallel.
  const [releasesRes, employeesRes] = await Promise.all([
    supabase
      .from('agent_releases')
      .select(
        'version, download_url, sha256, release_notes, is_latest, is_min_supported, released_at'
      )
      .order('released_at', { ascending: false }),
    supabase
      .from('employees')
      .select('id, agent_version, agent_version_updated_at, is_active')
      .eq('business_id', owner.business.id),
  ])

  if (releasesRes.error) {
    console.error('settings/releases: read releases failed', releasesRes.error)
    return NextResponse.json({ error: 'read failed' }, { status: 500 })
  }
  if (employeesRes.error) {
    console.error('settings/releases: read employees failed', employeesRes.error)
    return NextResponse.json({ error: 'read failed' }, { status: 500 })
  }

  // Bucket employee counts by agent_version.
  const counts: Record<string, number> = {}
  let unknownCount = 0
  let totalActive = 0
  for (const e of employeesRes.data ?? []) {
    if (!e.is_active) continue
    totalActive += 1
    const v = (e.agent_version as string | null) ?? null
    if (!v) {
      unknownCount += 1
      continue
    }
    counts[v] = (counts[v] ?? 0) + 1
  }

  const releases = (releasesRes.data as ReleaseRow[]).map((r) => ({
    ...r,
    employee_count: counts[r.version] ?? 0,
  }))

  // Versions employees are reporting that AREN'T in agent_releases (drift /
  // very old builds). Surface them as orphan rows so the owner sees that
  // someone is on an unrecognized version.
  const knownVersions = new Set(releases.map((r) => r.version))
  const orphans = Object.entries(counts)
    .filter(([v]) => !knownVersions.has(v))
    .map(([version, employee_count]) => ({
      version,
      orphan: true as const,
      employee_count,
    }))

  return NextResponse.json({
    releases,
    orphans,
    unknown_employee_count: unknownCount,
    total_active_employees: totalActive,
  })
}

export async function PATCH(request: NextRequest) {
  const owner = await resolveOwner(request)
  if (!owner) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: {
    action?: string
    version?: string | null
    employee_ids?: string[] | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const supabase = serverSupabase()

  if (body.action === 'set_min_supported') {
    const version = body.version ? String(body.version).trim() : null
    const { error } = await supabase.rpc('set_agent_min_supported', {
      p_version: version,
    })
    if (error) {
      console.error('settings/releases: set_agent_min_supported failed', error)
      const status = /unknown version/.test(error.message) ? 400 : 500
      return NextResponse.json({ error: error.message }, { status })
    }
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_canary') {
    const version = body.version ? String(body.version).trim() : null
    if (!version) {
      return NextResponse.json({ error: 'version required' }, { status: 400 })
    }
    // employee_ids === null / [] => clear canary (revert to non-canary).
    const ids =
      Array.isArray(body.employee_ids) && body.employee_ids.length > 0
        ? body.employee_ids.filter((s): s is string => typeof s === 'string')
        : null

    // Sanity check: every employee_id must belong to the caller's
    // business. Without this, an owner could canary-target employees
    // from another tenant.
    if (ids && ids.length > 0) {
      const { data: scopedEmps } = await supabase
        .from('employees')
        .select('id')
        .eq('business_id', owner.business.id)
        .in('id', ids)
      const allowed = new Set((scopedEmps ?? []).map((e) => e.id))
      const foreign = ids.filter((id) => !allowed.has(id))
      if (foreign.length > 0) {
        return NextResponse.json(
          { error: `employees not in your business: ${foreign.join(', ')}` },
          { status: 403 }
        )
      }
    }

    const { error } = await supabase.rpc('set_agent_release_canary', {
      p_version: version,
      p_employee_ids: ids,
    })
    if (error) {
      console.error('settings/releases: set_agent_release_canary failed', error)
      const status = /unknown version/.test(error.message) ? 400 : 500
      return NextResponse.json({ error: error.message }, { status })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
