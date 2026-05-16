import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const token = typeof body?.token === 'string' ? body.token.trim() : ''

    if (!token) {
      return NextResponse.json({ error: 'token (string) required' }, { status: 400 })
    }

    const supabase = serverSupabase()

    // Look up the employee first so an invalid token returns 404 rather than
    // a silent no-op on update.
    const { data: existing, error: lookupErr } = await supabase
      .from('employees')
      .select('id, terms_accepted_at')
      .eq('install_token', token)
      .single()

    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
    }

    // Set once; preserve original acceptance timestamp on re-acks.
    if (!existing.terms_accepted_at) {
      const acceptedAt = new Date().toISOString()
      const { error: updateErr } = await supabase
        .from('employees')
        .update({ terms_accepted_at: acceptedAt })
        .eq('id', existing.id)

      if (updateErr) {
        console.error('accept-terms: update failed', updateErr)
        return NextResponse.json({ error: updateErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, terms_accepted_at: acceptedAt })
    }

    return NextResponse.json({
      success: true,
      terms_accepted_at: existing.terms_accepted_at,
      already_accepted: true,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('accept-terms: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
