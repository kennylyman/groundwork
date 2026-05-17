/**
 * One-shot read for the /settings/integrations page.
 *
 * Returns, for the authenticated owner's business:
 *   - integrations[]: every connected/pending/detected/disconnected row
 *   - detected_tools[]: aggregated software counts from captures in the
 *     last 7 days, normalized to canonical tool ids
 *   - intake_tools[]: tools the owner mentioned during intake (from
 *     business_profiles.tool_stack)
 *
 * The page combines these into a single ordered list:
 *   "tools known to Groundwork for this business, with per-ring status."
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { serverSupabase } from '@/lib/supabase'
import { normalizeToolName, TOOL_BY_ID } from '@/lib/integrations'
import { nativeToolNames } from '@/lib/integrations/adapters'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function GET(request: NextRequest) {
  try {
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
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const supabase = serverSupabase()
    const { data: biz } = await supabase
      .from('businesses')
      .select('id, name')
      .eq('owner_id', user.id)
      .maybeSingle()
    if (!biz) return NextResponse.json({ error: 'No business' }, { status: 404 })

    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString()

    // Pull in parallel — independent reads
    const [intRes, capRes, profileRes] = await Promise.all([
      supabase
        .from('integrations')
        .select(
          'id, tool_name, ring, status, connected_at, last_event_at, event_count, config, external_account_label, token_expires_at'
        )
        .eq('business_id', biz.id),
      supabase
        .from('captures')
        .select('software')
        .eq('business_id', biz.id)
        .gte('captured_at', sevenDaysAgo)
        .not('software', 'is', null),
      supabase
        .from('business_profiles')
        .select('tool_stack')
        .eq('business_id', biz.id)
        .maybeSingle(),
    ])

    const integrations = intRes.data ?? []

    // --- Aggregate captures.software → normalized tool counts ---
    const detectedCounts: Record<string, number> = {}
    for (const row of capRes.data ?? []) {
      const norm = normalizeToolName(row.software)
      if (norm) {
        detectedCounts[norm] = (detectedCounts[norm] || 0) + 1
      }
    }
    const detectedTools = Object.entries(detectedCounts)
      .map(([tool_id, count]) => ({
        tool_id,
        tool_label: TOOL_BY_ID[tool_id]?.label || tool_id,
        capture_count_7d: count,
        category: TOOL_BY_ID[tool_id]?.category || 'other',
      }))
      .sort((a, b) => b.capture_count_7d - a.capture_count_7d)

    // --- Tools from intake profile ---
    type ToolStackEntry = { name: string; used_for?: string[] }
    const intakeStack = (profileRes.data?.tool_stack as ToolStackEntry[] | undefined) ?? []
    const intakeTools = intakeStack.map((t) => {
      const norm = normalizeToolName(t.name) || t.name.toLowerCase()
      return {
        tool_id: norm,
        tool_label: TOOL_BY_ID[norm]?.label || t.name,
        used_for: t.used_for ?? [],
      }
    })

    return NextResponse.json({
      business_id: biz.id,
      business_name: biz.name,
      integrations,
      detected_tools: detectedTools,
      intake_tools: intakeTools,
      native_tools: nativeToolNames(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('integrations/state: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
