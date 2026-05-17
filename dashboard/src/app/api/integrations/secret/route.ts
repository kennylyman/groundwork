/**
 * Per-business webhook secret — used to authenticate inbound Zapier events.
 *
 * GET: returns the existing secret, lazy-generating one if missing.
 * Auth: caller must be authenticated and own the business via owner_id.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { serverSupabase } from '@/lib/supabase'
import crypto from 'node:crypto'

async function getOwnedBusiness(request: NextRequest) {
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
  if (!user) return { user: null, business: null as null | { id: string; webhook_secret: string | null } }

  const supabase = serverSupabase()
  const { data: biz } = await supabase
    .from('businesses')
    .select('id, webhook_secret')
    .eq('owner_id', user.id)
    .maybeSingle()

  return { user, business: biz ?? null }
}

export async function GET(request: NextRequest) {
  try {
    const { user, business } = await getOwnedBusiness(request)
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (!business) return NextResponse.json({ error: 'No business for this owner' }, { status: 404 })

    if (business.webhook_secret) {
      return NextResponse.json({
        secret: business.webhook_secret,
        webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.gwork.tech'}/api/integrations/zapier`,
      })
    }

    // Lazy-generate
    const secret = `gw_${crypto.randomBytes(24).toString('hex')}`
    const supabase = serverSupabase()
    const { error } = await supabase
      .from('businesses')
      .update({ webhook_secret: secret })
      .eq('id', business.id)
    if (error) {
      console.error('integrations/secret: update failed', error)
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }

    return NextResponse.json({
      secret,
      webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.gwork.tech'}/api/integrations/zapier`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('integrations/secret: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
