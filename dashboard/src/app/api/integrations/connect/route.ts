/**
 * Mark a tool as connected (or disconnected) at a specific ring.
 *
 * Owner self-attests Ring 2 (Zapier) connections on the settings page —
 * "I've set up my Zap, mark this connected." Real connectivity gets
 * confirmed when the webhook receives its first event from that tool;
 * settings page shows event_count + last_event_at so the owner knows
 * whether the Zap is actually firing.
 *
 * POST { tool_name, ring, action: 'connect' | 'disconnect' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { serverSupabase } from '@/lib/supabase'
import { normalizeToolName, TOOL_BY_ID } from '@/lib/integrations'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const rawTool = typeof body.tool_name === 'string' ? body.tool_name : ''
    const ring = Number(body.ring)
    const action = body.action

    if (!rawTool) return NextResponse.json({ error: 'tool_name required' }, { status: 400 })
    if (![1, 2, 3].includes(ring)) {
      return NextResponse.json({ error: 'ring must be 1, 2, or 3' }, { status: 400 })
    }
    if (action !== 'connect' && action !== 'disconnect') {
      return NextResponse.json({ error: 'action must be "connect" or "disconnect"' }, { status: 400 })
    }

    const toolName = normalizeToolName(rawTool) || rawTool.trim().toLowerCase()

    // Auth check
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

    // Find caller's business
    const { data: biz } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle()
    if (!biz) return NextResponse.json({ error: 'No business' }, { status: 404 })

    if (action === 'disconnect') {
      // For ring 3 (native OAuth) we also blank out the stored tokens.
      // callTool gates on access_token_encrypted being non-null, so this
      // is what actually stops the tool from being callable. Leaving the
      // row in place preserves event history and lets a future re-OAuth
      // upsert into the same row.
      const patch: Record<string, unknown> = { status: 'disconnected' }
      if (ring === 3) {
        patch.access_token_encrypted = null
        patch.refresh_token_encrypted = null
        patch.token_expires_at = null
        patch.token_scopes = null
      }
      const { error } = await supabase
        .from('integrations')
        .update(patch)
        .eq('business_id', biz.id)
        .eq('tool_name', toolName)
        .eq('ring', ring)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, status: 'disconnected' })
    }

    // Connect path — upsert with status pending until first webhook event
    // confirms it. Ring 1 connects immediately (no external dependency).
    const displayName = TOOL_BY_ID[toolName]?.label || rawTool
    const isRing1 = ring === 1
    const upsertRow = {
      business_id: biz.id,
      tool_name: toolName,
      ring,
      status: isRing1 ? 'connected' : 'pending',
      connected_at: isRing1 ? new Date().toISOString() : null,
      config: { display_name: displayName },
    }

    const { data: existing } = await supabase
      .from('integrations')
      .select('id, status, event_count')
      .eq('business_id', biz.id)
      .eq('tool_name', toolName)
      .eq('ring', ring)
      .maybeSingle()

    if (existing) {
      // Don't downgrade a 'connected' integration with events back to 'pending'
      const nextStatus =
        existing.status === 'connected' && (existing.event_count ?? 0) > 0
          ? 'connected'
          : upsertRow.status
      const { error } = await supabase
        .from('integrations')
        .update({ status: nextStatus, config: upsertRow.config })
        .eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, status: nextStatus })
    }

    const { error } = await supabase.from('integrations').insert(upsertRow)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, status: upsertRow.status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('integrations/connect: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
