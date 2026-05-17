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

  // Pull the business profile so the agent can prime classify.py with
  // business context. Missing profile is fine — classify.py knows how to
  // handle empty business_context.
  const { data: profile } = await supabase
    .from('business_profiles')
    .select(
      'industry, sub_industry, size_band, operations_vocab, tool_stack, workflows, pain_points, roles, compliance_constraints'
    )
    .eq('business_id', employee.business_id)
    .maybeSingle()

  // Pull this employee's role profile if Role Discovery has built one.
  // Same shape as classify.py _format_role_context expects.
  const { data: roleProfile } = await supabase
    .from('employee_role_profiles')
    .select('observed_role, primary_workflows, activity_clusters')
    .eq('employee_id', employee.id)
    .maybeSingle()

  // Capability taxonomy lives in capability_registry. Send the full list so
  // classify.py can render it in its prompt and validate model output
  // against it. Cached in the agent's config.json — agents refresh on
  // re-activation.
  const { data: capabilities } = await supabase
    .from('capability_registry')
    .select('id, label, automatable')
    .order('sort_order')

  return NextResponse.json({
    employee_id: employee.id,
    business_id: employee.business_id,
    // install_token is echoed back so the agent can persist it in
    // config.json. transmit.py uses it as the auth header for
    // POST /api/captures (the new server-side ingestion path that
    // replaces the open anon-key insert).
    install_token: token,
    anthropic_api_key: anthropicKey,
    supabase_url: supabaseUrl,
    supabase_anon_key: supabaseAnonKey,
    business_context: profile ?? null,
    role_context: roleProfile ?? null,
    capabilities: capabilities ?? [],
  })
}
