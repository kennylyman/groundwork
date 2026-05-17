/**
 * POST /api/intake/restart
 *
 * Clears intake_completed_at + intake_skipped_at on the caller's business
 * profile so /team-onboarding renders the IntakeChat again. Used by the
 * "Re-run intake" button on /settings/profile when an owner wants to
 * update their captured business context.
 *
 * The existing fields (tool_stack, workflows, pain_points, etc.) are
 * preserved — the rerun augments rather than wipes. Owner can still
 * inline-edit individual fields without touching this endpoint.
 *
 * Auth: resolveOwner. Same business-id chain as every other settings
 * route.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveOwner } from '@/lib/auth'
import { serverSupabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const owner = await resolveOwner(request)
  if (!owner) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serverSupabase()
  const { error } = await supabase
    .from('business_profiles')
    .update({
      intake_completed_at: null,
      intake_skipped_at: null,
    })
    .eq('business_id', owner.business.id)

  if (error) {
    console.error('intake/restart: update failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
