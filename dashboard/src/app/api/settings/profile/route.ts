/**
 * Inline editor save endpoint for /settings/profile.
 *
 * PATCH semantics: only the fields present in the body get updated. Anything
 * omitted is left as-is. business name lives on businesses (not the profile)
 * so we update both rows when present.
 *
 * Auth: owner of the business via session cookies.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { serverSupabase } from '@/lib/supabase'

type ToolEntry = { name: string; used_for?: string[] }
type WorkflowEntry = { name: string; description?: string }
type PainPointEntry = { description: string; severity?: 'high' | 'medium' | 'low' }

type EditableProfile = Partial<{
  business_name: string
  industry: string | null
  sub_industry: string | null
  size_band: string | null
  tool_stack: ToolEntry[]
  workflows: WorkflowEntry[]
  pain_points: PainPointEntry[]
  compliance_constraints: string[]
}>

function cleanString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length === 0 ? null : s
}

function cleanToolStack(v: unknown): ToolEntry[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: ToolEntry[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const name = cleanString((item as ToolEntry).name)
    if (!name) continue
    const usedFor = Array.isArray((item as ToolEntry).used_for)
      ? ((item as ToolEntry).used_for as unknown[])
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((s) => s.trim())
      : []
    out.push({ name, used_for: usedFor })
  }
  return out
}

function cleanWorkflows(v: unknown): WorkflowEntry[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: WorkflowEntry[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const name = cleanString((item as WorkflowEntry).name)
    if (!name) continue
    const desc = cleanString((item as WorkflowEntry).description)
    out.push({ name, ...(desc ? { description: desc } : {}) })
  }
  return out
}

function cleanPainPoints(v: unknown): PainPointEntry[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: PainPointEntry[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const desc = cleanString((item as PainPointEntry).description)
    if (!desc) continue
    const sev = (item as PainPointEntry).severity
    const severity =
      sev === 'high' || sev === 'medium' || sev === 'low' ? sev : undefined
    out.push({ description: desc, ...(severity ? { severity } : {}) })
  }
  return out
}

function cleanStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((s) => s.trim())
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as EditableProfile | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    // Auth
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
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const supabase = serverSupabase()

    const { data: biz } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle()
    if (!biz) {
      return NextResponse.json({ error: 'No business' }, { status: 404 })
    }

    // --- 1. Update businesses.name if provided ---
    const newName = cleanString(body.business_name)
    if (newName) {
      const { error } = await supabase
        .from('businesses')
        .update({ name: newName })
        .eq('id', biz.id)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    // --- 2. Build the profile patch from the editable fields ---
    const patch: Record<string, unknown> = {}

    if ('industry' in body) patch.industry = cleanString(body.industry)
    if ('sub_industry' in body) patch.sub_industry = cleanString(body.sub_industry)
    if ('size_band' in body) patch.size_band = cleanString(body.size_band)

    const tools = cleanToolStack(body.tool_stack)
    if (tools !== undefined) patch.tool_stack = tools

    const workflows = cleanWorkflows(body.workflows)
    if (workflows !== undefined) patch.workflows = workflows

    const painPoints = cleanPainPoints(body.pain_points)
    if (painPoints !== undefined) patch.pain_points = painPoints

    const compliance = cleanStringArray(body.compliance_constraints)
    if (compliance !== undefined) patch.compliance_constraints = compliance

    if (Object.keys(patch).length > 0) {
      // Ensure a profile row exists, then update.
      const { data: existing } = await supabase
        .from('business_profiles')
        .select('id')
        .eq('business_id', biz.id)
        .maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from('business_profiles')
          .update(patch)
          .eq('id', existing.id)
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
      } else {
        const { error } = await supabase
          .from('business_profiles')
          .insert({ business_id: biz.id, ...patch })
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('settings/profile PATCH: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
