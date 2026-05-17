/**
 * POST /api/captures
 *
 * Server-side capture ingestion. Validates the agent's install_token,
 * verifies the (employee_id, business_id) belong together, then writes
 * the capture row via service role. This closes the open anon-insert
 * vulnerability where any anon-key holder could insert rows pretending
 * to be any business.
 *
 * Auth: X-Groundwork-Install-Token header. The token is the
 * employees.install_token value the agent received from /api/activate.
 *
 * Rollout: the captures_anon_insert RLS policy stays open for now so old
 * agents (still posting direct to /rest/v1/captures) keep working. Once
 * the fleet has rolled to the new agent version, a follow-up migration
 * will tighten the policy and old agents will need to be re-installed
 * or hit the min_supported_version force-update path.
 */
import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'
import { checkCapturesRateLimit } from '@/lib/rate-limit'
import { getCapabilitiesById } from '@/lib/capabilities-server'

export const maxDuration = 15

type CapturePayload = {
  employee_id?: string
  business_id?: string
  session_id?: string | null
  captured_at?: string
  task?: string | null
  category?: string | null
  software?: string | null
  activity_level?: string | null
  confidence?: number | null
  automation_potential?: string | null
  workflow_step?: string | null
  trigger?: string | null
  reasoning?: string | null
  capabilities?: unknown
  active_window?: string | null
  active_url?: string | null
  keystrokes?: number | null
  mouse_clicks?: number | null
  copy_paste_events?: number | null
  idle_seconds?: number | null
  is_idle?: boolean | null
}

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-groundwork-install-token')?.trim()
  if (!token) {
    return NextResponse.json(
      { error: 'X-Groundwork-Install-Token header required' },
      { status: 401 }
    )
  }

  // Rate limit BEFORE parsing the body. Cheap reject for stolen-token
  // spam. Token is hashed inside checkCapturesRateLimit so the bare
  // credential never reaches Upstash's logs.
  const rl = await checkCapturesRateLimit(token)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'rate limit exceeded', retry_after_ms: rl.reset },
      { status: 429 }
    )
  }

  let body: CapturePayload
  try {
    body = (await request.json()) as CapturePayload
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const supabase = serverSupabase()

  const { data: employee, error: empErr } = await supabase
    .from('employees')
    .select('id, business_id, is_active, is_paused')
    .eq('install_token', token)
    .maybeSingle()

  if (empErr) {
    console.error('captures: employee lookup failed', empErr)
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
  }
  if (!employee) {
    // Don't echo whether the token format is plausible — same 401 either way.
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }
  if (!employee.is_active) {
    return NextResponse.json({ error: 'employee inactive' }, { status: 403 })
  }
  if (employee.is_paused) {
    // Agent polls is_paused every 5 captures; there's a ~2.5-min window
    // where it might still post while the dashboard says paused. Reject
    // server-side so the pause toggle is authoritative. 423 = Locked so
    // the agent can distinguish this from auth failures.
    return NextResponse.json({ error: 'employee paused' }, { status: 423 })
  }

  // Cross-check: payload's employee_id + business_id must match the
  // employee the token belongs to. This stops a compromised token from
  // being used to spam captures into a DIFFERENT business by lying in the
  // body — the foreign key on captures.business_id wouldn't catch this on
  // its own.
  if (body.employee_id && body.employee_id !== employee.id) {
    return NextResponse.json(
      { error: 'employee_id does not match token' },
      { status: 403 }
    )
  }
  if (body.business_id && body.business_id !== employee.business_id) {
    return NextResponse.json(
      { error: 'business_id does not match token' },
      { status: 403 }
    )
  }

  // Validate capabilities[] against the registry — drop anything that
  // isn't a known capability id. classify.py sanitizes its own output,
  // but the agent could be tampered or replaced with something that
  // sends arbitrary jsonb; the server is the final defense against
  // capability-id pollution that would corrupt the workflow map and
  // opportunity detector downstream.
  const capabilitiesById = await getCapabilitiesById()
  const validCapabilities = Array.isArray(body.capabilities)
    ? body.capabilities
        .filter(
          (c): c is { id: string; params?: unknown; confidence?: unknown } =>
            !!c &&
            typeof c === 'object' &&
            typeof (c as { id?: unknown }).id === 'string' &&
            !!capabilitiesById[(c as { id: string }).id]
        )
        .map((c) => ({
          id: c.id,
          params: c.params && typeof c.params === 'object' ? c.params : {},
          confidence:
            typeof c.confidence === 'number' ? c.confidence : 0,
        }))
    : []

  // Build the insert row from the validated identity (don't trust body
  // for these two) plus pass-through fields.
  const row = {
    employee_id: employee.id,
    business_id: employee.business_id,
    session_id: body.session_id ?? null,
    captured_at: body.captured_at ?? new Date().toISOString(),
    task: body.task ?? null,
    category: body.category ?? null,
    software: body.software ?? null,
    activity_level: body.activity_level ?? null,
    confidence: body.confidence ?? null,
    automation_potential: body.automation_potential ?? null,
    workflow_step: body.workflow_step ?? null,
    trigger: body.trigger ?? null,
    reasoning: body.reasoning ?? null,
    capabilities: validCapabilities,
    active_window: body.active_window ?? null,
    active_url: body.active_url ?? null,
    keystrokes: body.keystrokes ?? 0,
    mouse_clicks: body.mouse_clicks ?? 0,
    copy_paste_events: body.copy_paste_events ?? 0,
    idle_seconds: body.idle_seconds ?? 0,
    is_idle: body.is_idle ?? false,
  }

  const { data: inserted, error: insErr } = await supabase
    .from('captures')
    .insert(row)
    .select('id')
    .single()

  if (insErr || !inserted) {
    console.error('captures: insert failed', insErr)
    return NextResponse.json(
      { error: insErr?.message ?? 'insert failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({ id: inserted.id }, { status: 201 })
}
