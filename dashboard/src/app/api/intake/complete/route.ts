/**
 * Finalize the intake conversation.
 *
 * Creates:
 *   1. businesses row (replaces the old CreateBusinessView insert)
 *   2. business_profiles row (with the full structured profile + transcript)
 *   3. employees row for the owner (first employee, role "Owner")
 *
 * The caller is responsible for being authenticated as the owner.
 * We pull user_id from the auth cookie via @supabase/ssr.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { serverSupabase } from '@/lib/supabase'
import type { BusinessProfileDraft, ChatMessage } from '@/lib/intake-types'
import crypto from 'node:crypto'

type IntakeCompleteBody = {
  profile: BusinessProfileDraft
  transcript: ChatMessage[]
  skipped?: boolean // owner clicked "skip" rather than completing the chat
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as IntakeCompleteBody
    const profile = body?.profile && typeof body.profile === 'object' ? body.profile : {}
    const transcript = Array.isArray(body?.transcript) ? body.transcript : []
    const skipped = !!body?.skipped

    // --- Auth: get the current user from cookies ---
    // We mirror middleware's @supabase/ssr setup. This route is invoked from
    // a client component on /team-onboarding, which is auth-gated by
    // middleware — but we re-verify here so a malicious caller can't bypass.
    const cookieStore = request.cookies
    const sessionClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll() {
            // no-op; we don't need to mutate cookies in this route
          },
        },
      }
    )
    const {
      data: { user },
      error: userErr,
    } = await sessionClient.auth.getUser()
    if (userErr || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // --- Validate the minimum required fields ---
    const businessName = (profile.business_name || '').trim()
    if (!businessName) {
      return NextResponse.json(
        {
          error:
            'Business name is required. The intake agent should have collected this, or the owner should type it manually.',
        },
        { status: 400 }
      )
    }

    const ownerName =
      (profile.owner_name || '').trim() ||
      (user.user_metadata?.full_name as string | undefined)?.trim() ||
      user.email ||
      'Owner'

    const supabase = serverSupabase()

    // --- 1. Create the business row ---
    const { data: business, error: bizErr } = await supabase
      .from('businesses')
      .insert({
        name: businessName,
        industry: profile.industry ?? 'Other',
        owner_id: user.id,
      })
      .select('id')
      .single()

    if (bizErr || !business) {
      console.error('intake/complete: business insert failed', bizErr)
      return NextResponse.json(
        { error: 'Failed to create business', detail: bizErr?.message },
        { status: 500 }
      )
    }

    // --- 2. Create the business_profile row ---
    const profileRow = {
      business_id: business.id,
      intake_transcript: transcript,
      [skipped ? 'intake_skipped_at' : 'intake_completed_at']: new Date().toISOString(),
      industry: profile.industry ?? null,
      sub_industry: profile.sub_industry ?? null,
      size_band: profile.size_band ?? null,
      operations_vocab: profile.operations_vocab ?? {},
      tool_stack: profile.tool_stack ?? [],
      workflows: profile.workflows ?? [],
      pain_points: profile.pain_points ?? [],
      roles: profile.roles ?? [],
      compliance_constraints: profile.compliance_constraints ?? [],
      field_confidence: profile.field_confidence ?? {},
    }

    const { error: profileErr } = await supabase
      .from('business_profiles')
      .insert(profileRow)

    // Non-fatal: business is usable even if profile insert hiccups. Owner
    // can re-run intake from settings later. Log and continue.
    if (profileErr) {
      console.error('intake/complete: profile insert failed (non-fatal)', profileErr)
    }

    // --- 3. Add the owner as first employee ---
    const { error: empErr } = await supabase.from('employees').insert({
      business_id: business.id,
      name: ownerName,
      role: 'Owner',
      email: user.email,
      is_active: true,
      install_token: crypto.randomUUID(),
    })

    if (empErr) {
      // Also non-fatal — they can add themselves from the team view.
      console.error('intake/complete: owner employee insert failed (non-fatal)', empErr)
    }

    return NextResponse.json({
      business_id: business.id,
      business_name: businessName,
      profile_saved: !profileErr,
      owner_employee_saved: !empErr,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('intake/complete: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
