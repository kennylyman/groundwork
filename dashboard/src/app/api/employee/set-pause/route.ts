import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const employeeId = body?.employeeId
    const paused = body?.paused

    if (typeof employeeId !== 'string' || !employeeId) {
      return NextResponse.json({ error: 'employeeId (string) required' }, { status: 400 })
    }
    if (typeof paused !== 'boolean') {
      return NextResponse.json({ error: 'paused (boolean) required' }, { status: 400 })
    }

    const { error } = await serverSupabase()
      .from('employees')
      .update({ is_paused: paused })
      .eq('id', employeeId)

    if (error) {
      console.error('set-pause: update failed', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, paused })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('set-pause: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
