/**
 * Per-role hourly rates configured by the business owner. Overrides the
 * hardcoded defaults used by /api/generate-intelligence and the opportunity
 * detector. Both APIs should read this row and prefer owner-set values
 * when computing annual cost / savings.
 *
 * GET: returns the current rates map.
 * PUT: replaces the entire map with the payload.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { serverSupabase } from '@/lib/supabase'

async function authedBusinessId(request: NextRequest): Promise<string | null> {
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
  if (!user) return null
  const supabase = serverSupabase()
  const { data: biz } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle()
  return biz?.id ?? null
}

export async function GET(request: NextRequest) {
  try {
    const businessId = await authedBusinessId(request)
    if (!businessId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    const supabase = serverSupabase()
    const { data } = await supabase
      .from('business_profiles')
      .select('role_hourly_rates')
      .eq('business_id', businessId)
      .maybeSingle()
    return NextResponse.json({ rates: (data?.role_hourly_rates as Record<string, number>) ?? {} })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const businessId = await authedBusinessId(request)
    if (!businessId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    const rates = body.rates
    if (!rates || typeof rates !== 'object' || Array.isArray(rates)) {
      return NextResponse.json({ error: 'rates must be an object' }, { status: 400 })
    }

    // Normalize: lowercase keys, numeric values only.
    const cleaned: Record<string, number> = {}
    for (const [k, v] of Object.entries(rates)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
      const key = String(k).trim().toLowerCase()
      if (!key) continue
      cleaned[key] = Math.round(v * 100) / 100
    }

    const supabase = serverSupabase()
    // Profile must exist already (intake completion creates it). If not, create
    // a minimal row so the rates have somewhere to live.
    const { data: existing } = await supabase
      .from('business_profiles')
      .select('id')
      .eq('business_id', businessId)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('business_profiles')
        .update({ role_hourly_rates: cleaned })
        .eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { error } = await supabase
        .from('business_profiles')
        .insert({ business_id: businessId, role_hourly_rates: cleaned })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, rates: cleaned })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
