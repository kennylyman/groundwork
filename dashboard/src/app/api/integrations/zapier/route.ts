/**
 * Inbound webhook from Zapier (Ring 2 integrations).
 *
 * Setup flow:
 *   1. Owner generates a per-business webhook secret on /settings/integrations
 *      (lazy-created on first connect attempt).
 *   2. Owner creates a Zap whose action POSTs JSON to this endpoint with the
 *      header `X-Groundwork-Token: <secret>` and a body like:
 *        {
 *          "tool_name": "wellsky",
 *          "event_type": "shift.created",
 *          "data": { ... whatever Zapier passes ... },
 *          "occurred_at": "2026-05-16T18:00:00Z",   // optional
 *          "employee_email": "gary@acme.com"        // optional, for linking
 *        }
 *   3. We validate the token, upsert the integrations row to "connected"
 *      (status), and insert an integration_events row.
 *
 * The endpoint is intentionally permissive about event shape — different
 * tools emit wildly different payloads. We store the full body in
 * event_data jsonb so we can pattern-match later.
 */

import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'
import { normalizeToolName } from '@/lib/integrations'

export const maxDuration = 15

function readToken(req: NextRequest): string | null {
  // Primary: dedicated header. Secondary: Authorization Bearer.
  const h = req.headers.get('x-groundwork-token')
  if (h) return h.trim()
  const auth = req.headers.get('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return null
}

export async function POST(request: NextRequest) {
  try {
    const token = readToken(request)
    if (!token) {
      return NextResponse.json(
        { error: 'Missing X-Groundwork-Token header' },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const supabase = serverSupabase()

    // --- Resolve business by webhook_secret ---
    const { data: biz, error: bizErr } = await supabase
      .from('businesses')
      .select('id')
      .eq('webhook_secret', token)
      .maybeSingle()

    if (bizErr) {
      console.error('zapier webhook: business lookup failed', bizErr)
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
    if (!biz) {
      // Don't echo whether the token format is valid — same 401 either way.
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // --- Extract event fields ---
    const rawToolName = typeof body.tool_name === 'string' ? body.tool_name : ''
    const toolName = normalizeToolName(rawToolName) || rawToolName.trim().toLowerCase()
    const eventType =
      typeof body.event_type === 'string' ? body.event_type.trim() : 'event'
    const eventData = body.data && typeof body.data === 'object' ? body.data : {}
    const occurredAt =
      typeof body.occurred_at === 'string' ? body.occurred_at : new Date().toISOString()
    const employeeEmail =
      typeof body.employee_email === 'string' ? body.employee_email.trim().toLowerCase() : null

    if (!toolName) {
      return NextResponse.json(
        { error: 'tool_name is required' },
        { status: 400 }
      )
    }

    // --- UPSERT the integrations row to mark "connected" on first event ---
    const { data: existingInt } = await supabase
      .from('integrations')
      .select('id, event_count, status')
      .eq('business_id', biz.id)
      .eq('tool_name', toolName)
      .eq('ring', 2)
      .maybeSingle()

    let integrationId: string
    if (existingInt) {
      const { data: updated, error: updErr } = await supabase
        .from('integrations')
        .update({
          status: 'connected',
          last_event_at: occurredAt,
          event_count: (existingInt.event_count ?? 0) + 1,
          // Stamp connected_at on first event if it wasn't already set
          ...(existingInt.status !== 'connected'
            ? { connected_at: new Date().toISOString() }
            : {}),
        })
        .eq('id', existingInt.id)
        .select('id')
        .single()
      if (updErr || !updated) {
        console.error('zapier webhook: integration update failed', updErr)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
      }
      integrationId = updated.id
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('integrations')
        .insert({
          business_id: biz.id,
          tool_name: toolName,
          ring: 2,
          status: 'connected',
          connected_at: new Date().toISOString(),
          last_event_at: occurredAt,
          event_count: 1,
          config: { display_name: rawToolName },
        })
        .select('id')
        .single()
      if (insErr || !inserted) {
        console.error('zapier webhook: integration insert failed', insErr)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
      }
      integrationId = inserted.id
    }

    // --- Best-effort employee linking ---
    let employeeId: string | null = null
    if (employeeEmail) {
      const { data: emp } = await supabase
        .from('employees')
        .select('id')
        .eq('business_id', biz.id)
        .eq('email', employeeEmail)
        .maybeSingle()
      if (emp) employeeId = emp.id
    }

    // --- Insert the event row ---
    const { error: evErr } = await supabase.from('integration_events').insert({
      business_id: biz.id,
      integration_id: integrationId,
      employee_id: employeeId,
      tool_name: toolName,
      event_type: eventType,
      event_data: eventData,
      occurred_at: occurredAt,
    })

    if (evErr) {
      console.error('zapier webhook: event insert failed', evErr)
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('zapier webhook: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Allow GET for a simple "is this URL alive?" check in Zapier.
export async function GET() {
  return NextResponse.json({
    service: 'Groundwork webhook receiver',
    instructions:
      'Send a POST with header `X-Groundwork-Token: <your-business-secret>` and JSON body { tool_name, event_type, data, occurred_at?, employee_email? }.',
  })
}
