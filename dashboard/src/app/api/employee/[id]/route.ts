/**
 * DELETE /api/employee/[id]
 *
 * Remove an employee from the team. Owner-only, scoped to the caller's
 * business (resolveEmployeeOwner). The Owner role can never be deleted —
 * that's the row created during intake/complete and removing it would
 * orphan the business. The UI hides the button for Owner rows; the
 * server-side check is defense-in-depth.
 *
 * Cascade behavior (defined in earlier migrations):
 *   - opportunities                  → cascade delete
 *   - employee_role_profiles         → cascade delete
 *   - integration_events.employee_id → set null (events kept for the business)
 *   - captures                       → FK created pre-0001; assumed cascade
 *
 * Hard delete (not soft). The owner accepts data loss when they confirm.
 * If they want history retained, they should toggle is_active=false instead
 * (no UI for that today, but the column exists).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveEmployeeOwner } from '@/lib/auth'
import { serverSupabase } from '@/lib/supabase'

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const { id: employeeId } = await ctx.params
  if (!employeeId) {
    return NextResponse.json({ error: 'employee id required' }, { status: 400 })
  }

  const owner = await resolveEmployeeOwner(request, employeeId)
  if (!owner) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  }

  const supabase = serverSupabase()

  // Refuse to delete the Owner row. The intake flow stamps role='Owner'
  // on the business creator; that row is the anchor for the owner's own
  // dashboard, role discovery, etc. Removing it would create an orphan
  // business that can never be re-associated to a user.
  const { data: employee, error: fetchErr } = await supabase
    .from('employees')
    .select('id, role')
    .eq('id', employeeId)
    .maybeSingle()
  if (fetchErr) {
    console.error('employee DELETE: fetch failed', fetchErr)
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }
  if (!employee) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  }
  if ((employee.role ?? '').trim().toLowerCase() === 'owner') {
    return NextResponse.json(
      { error: 'Cannot delete the Owner role' },
      { status: 403 }
    )
  }

  const { error: delErr } = await supabase
    .from('employees')
    .delete()
    .eq('id', employeeId)
  if (delErr) {
    // If a FK without cascade blocks the delete, the message will
    // identify which table — useful for support.
    console.error('employee DELETE: delete failed', delErr)
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
