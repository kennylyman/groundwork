/**
 * Background token-refresh worker. Vercel cron hits this hourly.
 *
 * Selects integrations rows where:
 *   - access_token_encrypted is set (we have something to refresh)
 *   - token_expires_at is non-null AND within REFRESH_WINDOW_MINUTES of now
 *   - refresh_token_encrypted is non-null (no refresh token = nothing to do)
 *   - the adapter has a `refresh` method
 *
 * For each match: decrypt the refresh token, ask the adapter to refresh,
 * re-encrypt and store. A failure marks the integration as `error` so the
 * settings UI can prompt a re-auth.
 *
 * Auth: CRON_SECRET header from Vercel. In non-prod, allow through so devs
 * can poke at it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'
import { decryptToken, encryptToken } from '@/lib/integrations/crypto'
import { getAdapter } from '@/lib/integrations/adapters'

export const maxDuration = 60

const REFRESH_WINDOW_MINUTES = 65 // refresh tokens expiring in the next 65 min

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
  refresh_token_encrypted: string | null
  token_expires_at: string | null
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serverSupabase()
  const windowEnd = new Date(
    Date.now() + REFRESH_WINDOW_MINUTES * 60 * 1000
  ).toISOString()

  const { data, error } = await supabase
    .from('integrations')
    .select('id, business_id, tool_name, refresh_token_encrypted, token_expires_at')
    .not('access_token_encrypted', 'is', null)
    .not('refresh_token_encrypted', 'is', null)
    .not('token_expires_at', 'is', null)
    .lte('token_expires_at', windowEnd)

  if (error) {
    console.error('refresh-tokens: select failed', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as IntegrationRow[]
  let refreshed = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  for (const row of rows) {
    const adapter = getAdapter(row.tool_name)
    if (!adapter || !adapter.oauth.refresh) {
      skipped += 1
      continue
    }
    let refreshToken: string | null
    try {
      refreshToken = decryptToken(row.refresh_token_encrypted)
    } catch (err) {
      failed += 1
      errors.push(`${row.id}: decrypt failed`)
      // The encrypted refresh token is corrupt — mark error so the owner
      // can re-auth from the settings page.
      await supabase
        .from('integrations')
        .update({ status: 'error' })
        .eq('id', row.id)
      continue
    }
    if (!refreshToken) {
      skipped += 1
      continue
    }
    try {
      const next = await adapter.oauth.refresh(refreshToken)
      await supabase
        .from('integrations')
        .update({
          access_token_encrypted: encryptToken(next.accessToken),
          refresh_token_encrypted: next.refreshToken
            ? encryptToken(next.refreshToken)
            : row.refresh_token_encrypted,
          token_expires_at: next.expiresAt
            ? next.expiresAt.toISOString()
            : null,
          token_scopes: next.scopes,
          // If we previously marked this row 'error' from a transient
          // failure, a successful refresh restores 'connected'.
          status: 'connected',
        })
        .eq('id', row.id)
      refreshed += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      console.error('refresh-tokens: refresh failed', { id: row.id, tool: row.tool_name, err: message })
      errors.push(`${row.id}: ${message}`)
      failed += 1
      // Mark as error so the settings UI shows a re-auth prompt. The
      // access token may still work for a while — don't blank it out.
      await supabase
        .from('integrations')
        .update({ status: 'error' })
        .eq('id', row.id)
    }
  }

  return NextResponse.json({
    selected: rows.length,
    refreshed,
    skipped,
    failed,
    errors: errors.length ? errors : undefined,
  })
}

export const GET = handle
export const POST = handle
