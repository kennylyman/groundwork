/**
 * GET    /api/settings/capture
 *   Auth: cookie session (owner) OR X-Groundwork-Install-Token (agent).
 *   Returns the saved capture_hours for the caller's business, or the
 *   default Mon-Fri 08:00-18:00 if nothing's saved yet.
 *
 * PATCH  /api/settings/capture
 *   Auth: cookie session only. Owner updates their business's hours.
 *   Body: { days, start_time, end_time } per lib/capture-hours validation.
 *
 * The dual auth on GET lets the agent fetch its own business's config
 * with the install_token it already has (same credential used by
 * /api/captures), without needing a separate agent-bootstrap path.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveOwner } from '@/lib/auth'
import { serverSupabase } from '@/lib/supabase'
import {
  DEFAULT_CAPTURE_HOURS,
  parseCaptureHours,
  validateCaptureHoursPayload,
} from '@/lib/capture-hours'

async function resolveBusinessId(request: NextRequest): Promise<string | null> {
  // Path 1: install_token header (agent).
  const token = request.headers.get('x-groundwork-install-token')?.trim()
  if (token) {
    const supabase = serverSupabase()
    const { data: employee } = await supabase
      .from('employees')
      .select('business_id, is_active')
      .eq('install_token', token)
      .maybeSingle()
    if (employee && employee.is_active) {
      return employee.business_id
    }
    return null
  }
  // Path 2: cookie session (owner).
  const owner = await resolveOwner(request)
  return owner?.business.id ?? null
}

export async function GET(request: NextRequest) {
  const businessId = await resolveBusinessId(request)
  if (!businessId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serverSupabase()
  const { data: profile, error } = await supabase
    .from('business_profiles')
    .select('capture_hours')
    .eq('business_id', businessId)
    .maybeSingle()
  if (error) {
    console.error('settings/capture GET: read failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const raw = profile?.capture_hours ?? null
  const hours = parseCaptureHours(raw)
  const isDefault = raw === null
  return NextResponse.json({
    ...hours,
    default: isDefault,
  }, {
    headers: {
      // Short cache — the agent re-fetches once an hour anyway; a 60s
      // edge cache cuts noise without delaying meaningful changes.
      // Owner-side dashboards reload on demand so this affects only
      // back-to-back probes.
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
  })
}

export async function PATCH(request: NextRequest) {
  // PATCH is owner-only. Refuse if the call came with an install_token.
  const owner = await resolveOwner(request)
  if (!owner) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const validated = validateCaptureHoursPayload(body)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const supabase = serverSupabase()

  // The business_profiles row may or may not exist yet (created during
  // intake). Upsert covers both paths.
  const { data: existing } = await supabase
    .from('business_profiles')
    .select('id')
    .eq('business_id', owner.business.id)
    .maybeSingle()

  let err
  if (existing) {
    const { error } = await supabase
      .from('business_profiles')
      .update({ capture_hours: validated.value })
      .eq('id', existing.id)
    err = error
  } else {
    const { error } = await supabase
      .from('business_profiles')
      .insert({
        business_id: owner.business.id,
        capture_hours: validated.value,
      })
    err = error
  }

  if (err) {
    console.error('settings/capture PATCH: write failed', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  return NextResponse.json({ ...validated.value, default: false })
}

// Re-export so the settings page can render defaults during load.
export const __defaults__ = DEFAULT_CAPTURE_HOURS
