/**
 * GET    /api/settings/capture
 *   Auth: cookie session (owner) OR X-Groundwork-Install-Token (agent).
 *
 *   When called by the agent (install_token header): returns the employee's
 *   own capture_hours when set, otherwise falls back to the business-level
 *   schedule. The `source` field on the response tells you which won
 *   ("employee" | "business").
 *
 *   When called by an owner via cookie: returns the business-level
 *   schedule, or DEFAULT_CAPTURE_HOURS if nothing's saved yet.
 *
 *   The dual auth lets the agent fetch its own resolved schedule with the
 *   install_token it already has — same credential used by /api/captures.
 *
 * PATCH  /api/settings/capture
 *   Auth: cookie session only. Body shapes:
 *
 *     { days, start_time, end_time, timezone }
 *       Writes business-level (business_profiles.capture_hours).
 *
 *     { employee_id, days, start_time, end_time, timezone }
 *       Writes per-employee override (employees.capture_hours).
 *       Ownership is enforced: employee must belong to the owner's business.
 *
 *     { employee_id, clear: true }
 *       Clears the employee override back to NULL (= inherit business).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveOwner } from '@/lib/auth'
import { serverSupabase } from '@/lib/supabase'
import {
  DEFAULT_CAPTURE_HOURS,
  parseCaptureHours,
  validateCaptureHoursPayload,
} from '@/lib/capture-hours'

type Caller = {
  businessId: string
  /** Only set when the caller is the agent (install_token path). The raw
   *  jsonb from employees.capture_hours — NULL means "use business default". */
  employeeHoursRaw?: unknown
}

async function resolveCaller(request: NextRequest): Promise<Caller | null> {
  // Path 1: install_token header (agent). Also pulls employees.capture_hours
  // so the GET handler can prefer it over the business-level schedule
  // without a second round-trip.
  const token = request.headers.get('x-groundwork-install-token')?.trim()
  if (token) {
    const supabase = serverSupabase()
    const { data: employee } = await supabase
      .from('employees')
      .select('business_id, is_active, capture_hours')
      .eq('install_token', token)
      .maybeSingle()
    if (employee && employee.is_active) {
      return {
        businessId: employee.business_id,
        employeeHoursRaw: employee.capture_hours,
      }
    }
    return null
  }
  // Path 2: cookie session (owner). No per-employee context — owners use
  // PATCH with an explicit employee_id when they want that.
  const owner = await resolveOwner(request)
  return owner?.business.id ? { businessId: owner.business.id } : null
}

export async function GET(request: NextRequest) {
  const caller = await resolveCaller(request)
  if (!caller) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const cacheHeaders = {
    // Short cache — the agent re-fetches once an hour anyway; a 60s edge
    // cache cuts noise without delaying meaningful changes. The schedule
    // here might be per-employee, so we can't share across employees;
    // the install_token is in the request signature so edge caches will
    // partition correctly.
    'Cache-Control': 'private, max-age=60',
  }

  // Agent path with a per-employee override → return it directly. This is
  // the new behavior added in migration 0022. Pre-migration employees
  // (and any business that hasn't set per-employee overrides) have
  // capture_hours = NULL and fall through to the business-level path
  // below — identical to the old behavior.
  if (caller.employeeHoursRaw != null) {
    const hours = parseCaptureHours(caller.employeeHoursRaw)
    return NextResponse.json(
      { ...hours, default: false, source: 'employee' },
      { headers: cacheHeaders }
    )
  }

  // Business-level (or owner cookie path).
  const supabase = serverSupabase()
  const { data: profile, error } = await supabase
    .from('business_profiles')
    .select('capture_hours')
    .eq('business_id', caller.businessId)
    .maybeSingle()
  if (error) {
    console.error('settings/capture GET: read failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const raw = profile?.capture_hours ?? null
  const hours = parseCaptureHours(raw)
  return NextResponse.json(
    { ...hours, default: raw === null, source: 'business' },
    { headers: cacheHeaders }
  )
}

export async function PATCH(request: NextRequest) {
  // PATCH is owner-only. Agent install_tokens are deliberately rejected
  // here — agents are read-only consumers of this config.
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
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const bodyObj = body as Record<string, unknown>
  const supabase = serverSupabase()

  // -------- Per-employee override path --------
  const employeeId =
    typeof bodyObj.employee_id === 'string' && bodyObj.employee_id.length > 0
      ? bodyObj.employee_id
      : null

  if (employeeId) {
    // Ownership: the employee must belong to the caller's business.
    // Note: even if RLS would block a cross-business update, we check
    // explicitly so we can return a clean 404 instead of a silent no-op.
    const { data: employee, error: lookupErr } = await supabase
      .from('employees')
      .select('id, business_id')
      .eq('id', employeeId)
      .maybeSingle()
    if (lookupErr) {
      console.error('settings/capture PATCH: employee lookup failed', lookupErr)
      return NextResponse.json({ error: lookupErr.message }, { status: 500 })
    }
    if (!employee || employee.business_id !== owner.business.id) {
      return NextResponse.json({ error: 'employee not found' }, { status: 404 })
    }

    // Clear override → null. Employee inherits business schedule.
    if (bodyObj.clear === true) {
      const { error } = await supabase
        .from('employees')
        .update({ capture_hours: null })
        .eq('id', employeeId)
      if (error) {
        console.error('settings/capture PATCH: clear failed', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({
        employee_id: employeeId,
        source: 'business',
        cleared: true,
      })
    }

    // Set or update the override.
    const validated = validateCaptureHoursPayload(body)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    const { error } = await supabase
      .from('employees')
      .update({ capture_hours: validated.value })
      .eq('id', employeeId)
    if (error) {
      console.error('settings/capture PATCH: employee write failed', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({
      ...validated.value,
      employee_id: employeeId,
      source: 'employee',
      default: false,
    })
  }

  // -------- Business-level path (unchanged behavior) --------
  const validated = validateCaptureHoursPayload(body)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

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
    console.error('settings/capture PATCH: business write failed', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  return NextResponse.json({ ...validated.value, source: 'business', default: false })
}

// Re-export so the settings page can render defaults during load.
export const __defaults__ = DEFAULT_CAPTURE_HOURS
