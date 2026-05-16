import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim()

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const supabase = serverSupabase()

  const { data: employee, error } = await supabase
    .from('employees')
    .select('id, business_id, activated_at')
    .eq('install_token', token)
    .single()

  if (error || !employee) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
  }

  if (!employee.activated_at) {
    const { error: updateError } = await supabase
      .from('employees')
      .update({ activated_at: new Date().toISOString() })
      .eq('id', employee.id)

    if (updateError) {
      console.error('activate: failed to set activated_at', updateError)
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (!supabaseUrl || !supabaseAnonKey || !anthropicKey) {
    return NextResponse.json(
      { error: 'Server misconfigured: missing agent credentials' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    employee_id: employee.id,
    business_id: employee.business_id,
    anthropic_api_key: anthropicKey,
    supabase_url: supabaseUrl,
    supabase_anon_key: supabaseAnonKey,
  })
}
