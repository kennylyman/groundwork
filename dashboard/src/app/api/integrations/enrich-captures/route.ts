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
import { getAdapter, listAdapters } from '@/lib/integrations/adapters'
import { buildContextWithRefresh } from '@/lib/integrations-runtime'
import type { CaptureForEnrichment } from '@/lib/integrations/adapters/types'

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
  refresh_token_encrypted: string | null
  token_scopes: string[] | null
  token_expires_at: string | null
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
      'id, business_id, tool_name, access_token_encrypted, refresh_token_encrypted, token_scopes, token_expires_at, external_account_id, external_account_label'
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

    // Build the context with JIT refresh — if the stored access token is
    // stale (within 5 min of expiry), this swaps in a refreshed one and
    // persists it. Critical for Microsoft 365 / HubSpot where the access
    // token only lives ~1 hour and the daily refresh cron is too slow.
    let ctx
    try {
      const built = await buildContextWithRefresh(
        {
          ...chosenAdapterRow,
          ring: 3,
          status: 'connected',
        },
        chosenAdapter
      )
      ctx = { ...built, businessId: cap.business_id }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      errors.push(`${cap.id}: ${msg}`)
      await supabase
        .from('captures')
        .update({
          capture_enrichments: {
            [chosenAdapter.toolName]: { error: `auth: ${msg}` },
          },
        })
        .eq('id', cap.id)
      console.error('enrich-captures: auth', msg)
      continue
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

    // Synthesize integration_events rows from this enrichment so the
    // opportunity detector's verified-via-events confidence boost fires
    // for native OAuth integrations the same way it does for Zapier.
    // Closes gaps 2 + 3: emits one event per "useful signal" the adapter
    // returned, keyed by the matched surface so capability key_params
    // can join (e.g., a Teams capture writes tool_name='teams' not
    // 'microsoft-365' so the detector matches the same vocabulary as
    // existing per-product detections).
    if (payload && !payload.error) {
      const events = synthesizeEvents(
        cap,
        chosenAdapter.toolName,
        chosenAdapterRow.id,
        payload
      )
      if (events.length > 0) {
        const { error: evErr } = await supabase
          .from('integration_events')
          .insert(events)
        if (evErr) {
          // Non-fatal — the enrichment landed, the events are extra.
          console.error('enrich-captures: events insert failed', evErr)
        }
      }
    }
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

/** Build integration_events rows for the opportunity detector's
 *  verified-via-events boost. One event per useful signal in the
 *  adapter's payload, keyed by the matched surface so per-product
 *  detections (outlook / teams / gmail / etc) join correctly with
 *  capability key_params.
 *
 *  event_type uses a "native.<source>" namespace so future code can
 *  distinguish synthesized events from real Zapier events. */
function synthesizeEvents(
  capture: CaptureForEnrichment,
  toolName: string,
  integrationId: string,
  payload: Record<string, unknown>
): Array<{
  business_id: string
  integration_id: string
  employee_id: string
  capture_id: string
  tool_name: string
  event_type: string
  event_data: Record<string, unknown>
  occurred_at: string
}> {
  type Row = ReturnType<typeof synthesizeEvents>[number]
  const out: Row[] = []
  const surface =
    (payload.surface as string | undefined) ?? toolName

  // Per-adapter mapping from payload shape -> event rows. We bound
  // event_data to ~1KB so a 200-msg Slack channel history doesn't bloat
  // the table — the boost only cares whether events exist + their
  // count, not the full content.

  if (toolName === 'slack') {
    const messages = (payload.messages as Array<unknown> | undefined) ?? []
    if (messages.length > 0) {
      out.push({
        business_id: capture.business_id,
        integration_id: integrationId,
        employee_id: capture.employee_id,
        capture_id: capture.id,
        tool_name: 'slack',
        event_type: 'native.slack.channel_active',
        event_data: { message_count: messages.length },
        occurred_at: capture.captured_at,
      })
    }
  } else if (toolName === 'microsoft-365' || toolName === 'google-workspace') {
    const cal = (payload.calendar_events as Array<unknown> | undefined) ?? []
    const mail = (payload.unread_emails as Array<unknown> | undefined) ?? []
    // Map M365/Google to the per-product tool_name vocabulary the
    // detector uses elsewhere. captures.software for an Outlook capture
    // normalizes to 'outlook'; a capture in Teams to 'teams'; Gmail
    // captures to 'gmail'. We mirror that here.
    let perProduct: string
    if (toolName === 'microsoft-365') {
      perProduct =
        surface === 'teams' ? 'teams' : surface === 'outlook' ? 'outlook' : 'outlook'
    } else {
      perProduct =
        surface === 'calendar' ? 'google-calendar' :
        surface === 'drive' ? 'google-drive' :
        surface === 'docs' || surface === 'sheets' || surface === 'slides' ? 'google-drive' :
        'gmail'
    }
    if (cal.length > 0) {
      out.push({
        business_id: capture.business_id,
        integration_id: integrationId,
        employee_id: capture.employee_id,
        capture_id: capture.id,
        tool_name: perProduct,
        event_type: `native.${toolName}.calendar`,
        event_data: { event_count: cal.length },
        occurred_at: capture.captured_at,
      })
    }
    if (mail.length > 0) {
      out.push({
        business_id: capture.business_id,
        integration_id: integrationId,
        employee_id: capture.employee_id,
        capture_id: capture.id,
        tool_name: perProduct,
        event_type: `native.${toolName}.unread`,
        event_data: { message_count: mail.length },
        occurred_at: capture.captured_at,
      })
    }
  }

  return out
}

export const GET = handle
export const POST = handle
