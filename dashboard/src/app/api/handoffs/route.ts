/**
 * GET /api/handoffs
 *
 * Returns cross-employee handoffs for the authenticated owner's business,
 * sorted by bottleneck severity first (critical → standard → none) then
 * by occurrence_count descending. Joins employee names + roles so the
 * dashboard renders "Maria → John" without an extra round-trip.
 *
 * Response also includes the from/to employee_role on each row so the
 * critical-bottleneck cost estimate (gap_minutes × hourly_rate ×
 * annual_occurrences) can be computed client-side using the same
 * resolveRate() helper the rest of the dashboard uses.
 *
 * Auth: cookie session (owner). RLS on workflow_handoffs is owner-chain
 * so a service-role read with an explicit business_id filter is
 * equivalent — we use the service-role client for the joins and look
 * up business_id via the cookie session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { serverSupabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  // Resolve the owner's business id from the cookie session.
  const sessionClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll() {
          // No-op — route handlers can't write cookies here.
        },
      },
    }
  )
  const {
    data: { user },
  } = await sessionClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serverSupabase()
  const { data: biz } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle()
  if (!biz) {
    return NextResponse.json({ error: 'no business' }, { status: 404 })
  }

  // Pull handoffs ordered by bottleneck severity first, then occurrences.
  // Postgres sorts booleans true > false when descending, so
  // is_bottleneck DESC puts bottlenecks at the top.
  const { data: handoffs, error: hoErr } = await supabase
    .from('workflow_handoffs')
    .select(
      'id, business_id, from_employee_id, to_employee_id, handoff_at, gap_minutes, avg_gap_minutes, from_sequence_id, to_sequence_id, from_tool, to_tool, from_category, to_category, task_context, occurrence_count, last_seen_at, confidence_score, is_bottleneck, created_at, updated_at'
    )
    .eq('business_id', biz.id)
    .order('is_bottleneck', { ascending: false })
    .order('avg_gap_minutes', { ascending: false })
    .order('occurrence_count', { ascending: false })
    .limit(100)
  if (hoErr) {
    console.error('GET /api/handoffs: read failed', hoErr)
    return NextResponse.json({ error: hoErr.message }, { status: 500 })
  }
  const rows = handoffs ?? []
  if (rows.length === 0) {
    return NextResponse.json({ handoffs: [] })
  }

  // Bulk-fetch employee names + roles so the response is self-contained
  // for the dashboard.
  const empIds = Array.from(
    new Set(rows.flatMap((r) => [r.from_employee_id, r.to_employee_id]))
  )
  const { data: empRows } = await supabase
    .from('employees')
    .select('id, name, role')
    .in('id', empIds)
  const employeesById = new Map<
    string,
    { id: string; name: string; role: string | null }
  >()
  for (const e of empRows ?? []) {
    employeesById.set(e.id, e)
  }

  // Enrich each row with the from/to employee objects.
  const enriched = rows.map((r) => ({
    ...r,
    from_employee: employeesById.get(r.from_employee_id) ?? null,
    to_employee: employeesById.get(r.to_employee_id) ?? null,
  }))

  return NextResponse.json({ handoffs: enriched })
}
