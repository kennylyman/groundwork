/**
 * Capture enrichment cron.
 *
 * For each business that has a native OAuth integration connected, find
 * captures from the last 15 minutes whose software matches the adapter,
 * fetch live context from the tool, and write it back to
 * captures.capture_enrichments.
 *
 * Today this runs every ~5 minutes. The window is 15 minutes so transient
 * cron skips don't drop captures permanently. Bounded at MAX_PER_RUN
 * captures per invocation so a backlog can't blow the Vercel function
 * timeout.
 *
 * Enrichment is best-effort:
 *   - Adapter returns null  → we still stamp `capture_enrichments.{tool}` so
 *     the cron doesn't re-evaluate this row forever.
 *   - Adapter throws        → we stamp { error: "..." } for the same reason
 *     and log server-side.
 */
import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'
import { decryptToken } from '@/lib/integrations/crypto'
import { getAdapter, listAdapters } from '@/lib/integrations/adapters'
import type {
  CaptureForEnrichment,
  ToolCallContext,
} from '@/lib/integrations/adapters/types'

export const maxDuration = 60

const WINDOW_MINUTES = 15
const MAX_PER_RUN = 200

function authorized(req: NextRequest): boolean {
  const cronHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && cronHeader === `Bearer ${cronSecret}`) return true
  if (process.env.VERCEL_ENV !== 'production') return true
  return false
}

type IntegrationRow = {
  id: string
  business_id: string
  tool_name: string
  access_token_encrypted: string | null
  token_scopes: string[] | null
  external_account_id: string | null
  external_account_label: string | null
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serverSupabase()
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()

  // Pull every active native integration for the whole platform. At our
  // scale this is small (one row per business per tool). If it ever grows,
  // we can shard by business or move to a per-business cron.
  const { data: integrations, error: intErr } = await supabase
    .from('integrations')
    .select(
      'id, business_id, tool_name, access_token_encrypted, token_scopes, external_account_id, external_account_label'
    )
    .eq('ring', 3)
    .eq('status', 'connected')
    .not('access_token_encrypted', 'is', null)
  if (intErr) {
    console.error('enrich-captures: integrations select', intErr)
    return NextResponse.json({ error: intErr.message }, { status: 500 })
  }

  const byBusiness = new Map<string, IntegrationRow[]>()
  for (const row of (integrations ?? []) as IntegrationRow[]) {
    const list = byBusiness.get(row.business_id) ?? []
    list.push(row)
    byBusiness.set(row.business_id, list)
  }
  if (byBusiness.size === 0) {
    return NextResponse.json({ businesses: 0, enriched: 0 })
  }

  // Pull candidate captures across all businesses with at least one
  // active integration, in a single read.
  const businessIds = Array.from(byBusiness.keys())
  const { data: captures, error: capErr } = await supabase
    .from('captures')
    .select(
      'id, business_id, employee_id, software, active_window, active_url, task, category, captured_at'
    )
    .in('business_id', businessIds)
    .gte('captured_at', since)
    .is('capture_enrichments', null)
    .not('software', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(MAX_PER_RUN)
  if (capErr) {
    console.error('enrich-captures: captures select', capErr)
    return NextResponse.json({ error: capErr.message }, { status: 500 })
  }

  let enriched = 0
  let skipped = 0
  const errors: string[] = []

  for (const cap of (captures ?? []) as CaptureForEnrichment[]) {
    const intsForBiz = byBusiness.get(cap.business_id) ?? []
    // Pick whichever adapter wants this capture. First adapter wins —
    // captures rarely span multiple tools in one row.
    let chosenAdapterRow: IntegrationRow | null = null
    let chosenAdapter: ReturnType<typeof getAdapter> = null
    for (const intRow of intsForBiz) {
      const adapter = getAdapter(intRow.tool_name)
      if (!adapter || !adapter.matchesCapture || !adapter.enrichCapture) continue
      if (adapter.matchesCapture(cap)) {
        chosenAdapterRow = intRow
        chosenAdapter = adapter
        break
      }
    }

    if (!chosenAdapter || !chosenAdapterRow) {
      // No adapter wants this capture — stamp an empty enrichment so we
      // don't keep re-evaluating it on future cron runs.
      await supabase
        .from('captures')
        .update({ capture_enrichments: {} })
        .eq('id', cap.id)
      skipped += 1
      continue
    }

    let accessToken: string | null
    try {
      accessToken = decryptToken(chosenAdapterRow.access_token_encrypted)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      errors.push(`${cap.id}: decrypt failed`)
      await supabase
        .from('captures')
        .update({
          capture_enrichments: {
            [chosenAdapter.toolName]: { error: 'decrypt_failed' },
          },
        })
        .eq('id', cap.id)
      console.error('enrich-captures: decrypt', msg)
      continue
    }
    if (!accessToken) {
      skipped += 1
      continue
    }

    const ctx: ToolCallContext = {
      businessId: cap.business_id,
      toolName: chosenAdapter.toolName,
      accessToken,
      externalAccountId: chosenAdapterRow.external_account_id,
      externalAccountLabel: chosenAdapterRow.external_account_label,
      scopes: chosenAdapterRow.token_scopes ?? [],
    }

    // We checked chosenAdapter.enrichCapture exists in the selection loop
    // above; TS narrowing doesn't survive the let-binding, so we assert.
    const enrichFn = chosenAdapter.enrichCapture
    let payload: Record<string, unknown> | null = null
    if (enrichFn) {
      try {
        payload = await enrichFn(cap, ctx, supabase)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown'
        errors.push(`${cap.id}: ${message}`)
        payload = { error: message }
      }
    }

    const merged = {
      [chosenAdapter.toolName]: payload ?? { matched: false },
    }
    const { error: updErr } = await supabase
      .from('captures')
      .update({ capture_enrichments: merged })
      .eq('id', cap.id)
    if (updErr) {
      errors.push(`${cap.id}: update failed: ${updErr.message}`)
      continue
    }
    enriched += 1
  }

  return NextResponse.json({
    window_minutes: WINDOW_MINUTES,
    candidates: captures?.length ?? 0,
    enriched,
    skipped,
    adapters: listAdapters().map((a) => a.toolName),
    errors: errors.length ? errors : undefined,
  })
}

export const GET = handle
export const POST = handle
