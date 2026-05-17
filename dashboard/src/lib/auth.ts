/**
 * Server-side auth helpers for API routes. Wraps the @supabase/ssr cookie
 * pattern that's repeated across every authed route, plus business / employee
 * ownership checks.
 *
 * All routes that mutate per-business data (not /api/activate's token-based
 * flow, not the Zapier webhook) should call requireBusinessOwner or
 * requireEmployeeOwner at the top.
 */

import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { serverSupabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

export type OwnerContext = {
  user: User
  business: { id: string; name: string }
}

/**
 * Resolve just the caller's user from auth cookies — for routes that should
 * require login but don't require an existing business (e.g., intake chat,
 * which runs DURING onboarding before businesses exists).
 */
export async function resolveUser(request: NextRequest): Promise<User | null> {
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
  const {
    data: { user },
  } = await sessionClient.auth.getUser()
  return user ?? null
}

/**
 * Resolve the caller (via auth cookies) and confirm they own a business.
 * Returns null if unauthenticated or no business — the caller should respond
 * 401 / 404 accordingly. Use authError() to render the conventional
 * NextResponse.
 */
export async function resolveOwner(request: NextRequest): Promise<OwnerContext | null> {
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
  const {
    data: { user },
  } = await sessionClient.auth.getUser()
  if (!user) return null

  const supabase = serverSupabase()
  const { data: biz } = await supabase
    .from('businesses')
    .select('id, name')
    .eq('owner_id', user.id)
    .maybeSingle()
  if (!biz) return null

  return { user, business: biz }
}

/**
 * Confirm the caller owns the business that owns the given employee.
 * Returns the business + employee on success, null otherwise.
 */
export async function resolveEmployeeOwner(
  request: NextRequest,
  employeeId: string
): Promise<(OwnerContext & { employee: { id: string; business_id: string } }) | null> {
  const owner = await resolveOwner(request)
  if (!owner) return null

  const supabase = serverSupabase()
  const { data: emp } = await supabase
    .from('employees')
    .select('id, business_id')
    .eq('id', employeeId)
    .maybeSingle()
  if (!emp || emp.business_id !== owner.business.id) return null

  return { ...owner, employee: emp }
}
