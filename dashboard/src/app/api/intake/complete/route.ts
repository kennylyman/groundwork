/**
 * Finalize the intake conversation.
 *
 * Idempotent — works whether or not the owner already has a business row.
 * The dashboard's old signup flow (before this change) created the
 * business at signup time; this endpoint detects an existing business
 * for the auth user and UPDATEs it instead of inserting a new one.
 *
 * On every successful call:
 *   1. businesses row exists for the owner (UPDATE if found, INSERT if not)
 *   2. business_profiles row UPSERTed (one per business; intake_* timestamps
 *      stamped depending on completed vs skipped)
 *   3. owner appears as an active employee row with role 'Owner'
 *      (only INSERTed if no Owner employee already exists for this business)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { serverSupabase } from '@/lib/supabase'
import type { BusinessProfileDraft, ChatMessage } from '@/lib/intake-types'
import crypto from 'node:crypto'

type IntakeCompleteBody = {
  profile: BusinessProfileDraft
  transcript: ChatMessage[]
  skipped?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as IntakeCompleteBody
    const profile = body?.profile && typeof body.profile === 'object' ? body.profile : {}
    const transcript = Array.isArray(body?.transcript) ? body.transcript : []
    const skipped = !!body?.skipped

    // --- Auth ---
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
            // no-op
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

    // --- Required fields ---
    const businessName = (profile.business_name || '').trim()
    if (!businessName) {
      return NextResponse.json(
        {
          error:
            'Business name is required. The intake agent should have collected this — or the owner can type it manually before continuing.',
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
    const industry = profile.industry ?? 'Other'

    // --- 1. Find or create the business ---
    const { data: existingBiz, error: bizLookupErr } = await supabase
      .from('businesses')
      .select('id, name, industry')
      .eq('owner_id', user.id)
      .maybeSingle()

    if (bizLookupErr) {
      console.error('intake/complete: business lookup failed', bizLookupErr)
      return NextResponse.json(
        { error: 'Failed to look up business', detail: bizLookupErr.message },
        { status: 500 }
      )
    }

    let businessId: string
    if (existingBiz) {
      // UPDATE name/industry if the intake collected different values —
      // owner's latest answer wins.
      const patch: Record<string, string> = {}
      if (existingBiz.name !== businessName) patch.name = businessName
      if (industry && existingBiz.industry !== industry) patch.industry = industry
      if (Object.keys(patch).length > 0) {
        const { error: updateErr } = await supabase
          .from('businesses')
          .update(patch)
          .eq('id', existingBiz.id)
        if (updateErr) {
          console.error('intake/complete: business update failed (non-fatal)', updateErr)
        }
      }
      businessId = existingBiz.id
    } else {
      const { data: created, error: bizErr } = await supabase
        .from('businesses')
        .insert({
          name: businessName,
          industry,
          owner_id: user.id,
        })
        .select('id')
        .single()
      if (bizErr || !created) {
        console.error('intake/complete: business insert failed', bizErr)
        return NextResponse.json(
          { error: 'Failed to create business', detail: bizErr?.message },
          { status: 500 }
        )
      }
      businessId = created.id
    }

    // --- 2. UPSERT business_profiles ---
    const profileRow = {
      business_id: businessId,
      intake_transcript: transcript,
      intake_completed_at: skipped ? null : new Date().toISOString(),
      intake_skipped_at: skipped ? new Date().toISOString() : null,
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
      .upsert(profileRow, { onConflict: 'business_id', ignoreDuplicates: false })

    // Non-fatal — business is usable either way. Owner can re-run intake later.
    if (profileErr) {
      console.error('intake/complete: profile upsert failed (non-fatal)', profileErr)
    }

    // --- 3. Ensure owner appears as an employee (one Owner per business) ---
    const { data: existingOwner } = await supabase
      .from('employees')
      .select('id, name, email')
      .eq('business_id', businessId)
      .eq('role', 'Owner')
      .maybeSingle()

    let ownerEmployeeSaved = true
    if (!existingOwner) {
      const { error: empErr } = await supabase.from('employees').insert({
        business_id: businessId,
        name: ownerName,
        role: 'Owner',
        email: user.email,
        is_active: true,
        install_token: crypto.randomUUID(),
      })
      if (empErr) {
        console.error('intake/complete: owner employee insert failed (non-fatal)', empErr)
        ownerEmployeeSaved = false
      }
    } else if (existingOwner.name !== ownerName || existingOwner.email !== user.email) {
      // Patch name/email if they were collected freshly by intake.
      const patch: Record<string, string | null | undefined> = {}
      if (existingOwner.name !== ownerName) patch.name = ownerName
      if (existingOwner.email !== user.email) patch.email = user.email
      if (Object.keys(patch).length > 0) {
        await supabase.from('employees').update(patch).eq('id', existingOwner.id)
      }
    }

    return NextResponse.json({
      business_id: businessId,
      business_name: businessName,
      profile_saved: !profileErr,
      owner_employee_saved: ownerEmployeeSaved,
      reused_existing_business: !!existingBiz,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('intake/complete: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
