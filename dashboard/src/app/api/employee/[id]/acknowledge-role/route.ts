/**
 * Owner-driven acknowledgment of a discovered role profile.
 *
 * Two actions:
 *   - accept:   update employees.role to the observed_role AND stamp the
 *               profile as acknowledged (accepted).
 *   - dismiss:  just stamp the profile as acknowledged (dismissed). Keeps
 *               employees.role unchanged.
 *
 * Auth: the request must come from an authed user (the owner). We re-verify
 * via @supabase/ssr cookies even though middleware already gates the
 * dashboard pages that call this.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { serverSupabase } from '@/lib/supabase'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext) {
  try {
    const { id: employeeId } = await ctx.params
    if (!employeeId) {
      return NextResponse.json({ error: 'employee id required' }, { status: 400 })
    }

    const body = await request.json()
    const action = body?.action
    if (action !== 'accept' && action !== 'dismiss') {
      return NextResponse.json(
        { error: 'action must be "accept" or "dismiss"' },
        { status: 400 }
      )
    }

    // Auth check
    const sessionClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll() {
            // no-op
          },
        },
      }
    )
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const supabase = serverSupabase()

    const { data: profile, error: profileErr } = await supabase
      .from('employee_role_profiles')
      .select('id, employee_id, observed_role, acknowledged_at')
      .eq('employee_id', employeeId)
      .maybeSingle()

    if (profileErr) {
      return NextResponse.json({ error: profileErr.message }, { status: 500 })
    }
    if (!profile) {
      return NextResponse.json({ error: 'No role profile for this employee' }, { status: 404 })
    }

    const now = new Date().toISOString()
    const updates = {
      acknowledged_at: now,
      acknowledgment_action: action as 'accepted' | 'dismissed',
    }

    const { error: ackErr } = await supabase
      .from('employee_role_profiles')
      .update(updates)
      .eq('id', profile.id)
    if (ackErr) {
      return NextResponse.json({ error: ackErr.message }, { status: 500 })
    }

    // On accept: write the observed role onto the employee row.
    if (action === 'accept' && profile.observed_role) {
      const { error: empErr } = await supabase
        .from('employees')
        .update({ role: profile.observed_role })
        .eq('id', employeeId)
      if (empErr) {
        // Non-fatal — the ack stuck, owner can manually edit the role too.
        console.error('acknowledge-role: employees.role update failed', empErr)
      }
    }

    return NextResponse.json({ success: true, action, acknowledged_at: now })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('acknowledge-role: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
