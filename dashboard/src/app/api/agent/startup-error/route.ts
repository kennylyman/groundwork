/**
 * POST /api/agent/startup-error
 *
 * Telemetry sink for agent crashes that happen BEFORE the first
 * successful /api/agent-version call. Without this endpoint, those
 * failures were invisible to the server — we saw "token redeemed,
 * agent_version null" and had to guess the cause. The agent now
 * wraps its startup sequence in a try/except that POSTs here before
 * exiting.
 *
 * Auth:
 *   install_token is OPTIONAL. Pre-activation crashes happen before
 *   the user types their token into the activation dialog, so we
 *   can't require it for auth. When present, we validate + resolve
 *   employee_id/business_id; when absent, we accept the report with
 *   employee_id/business_id null. Rate limit defends against abuse.
 *
 * Body:
 *   {
 *     install_token?: string,
 *     error_type:    string,   // exception class name, e.g. "ImportError"
 *     error_message: string,
 *     windows_version: string,
 *     agent_version: string,
 *     timestamp:     string    // ISO 8601, when the crash was observed
 *   }
 *
 * Response: 201 { id } on success, 4xx on validation, 429 on rate limit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { serverSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = {
  install_token?: unknown
  error_type?: unknown
  error_message?: unknown
  windows_version?: unknown
  agent_version?: unknown
  timestamp?: unknown
}

// Caps on field length so a misbehaving / malicious client can't flood
// the table with multi-megabyte error_message strings. Truncated values
// are still useful for triage; we'd rather lose detail than have a row
// the DB refuses.
const MAX_TYPE_LEN = 200
const MAX_MESSAGE_LEN = 4000
const MAX_VERSION_LEN = 100

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

export async function POST(request: NextRequest) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  // Required fields.
  const errorType = clip(body.error_type, MAX_TYPE_LEN)
  if (!errorType) {
    return NextResponse.json({ error: 'error_type required' }, { status: 400 })
  }
  const errorMessage = clip(body.error_message, MAX_MESSAGE_LEN)
  const windowsVersion = clip(body.windows_version, MAX_VERSION_LEN)
  const agentVersion = clip(body.agent_version, MAX_VERSION_LEN)

  // Timestamp: accept any ISO string the agent emits; fall back to now
  // on parse failure rather than rejecting the report.
  let occurredAt: string
  if (typeof body.timestamp === 'string' && body.timestamp) {
    const parsed = new Date(body.timestamp)
    occurredAt = Number.isNaN(parsed.getTime())
      ? new Date().toISOString()
      : parsed.toISOString()
  } else {
    occurredAt = new Date().toISOString()
  }

  // Token (optional). Resolve to employee + business when present;
  // store hint hash either way so we can spot a repeated machine.
  let employeeId: string | null = null
  let businessId: string | null = null
  let tokenHint: string | null = null
  if (typeof body.install_token === 'string' && body.install_token.trim()) {
    const rawToken = body.install_token.trim()
    tokenHint = createHash('sha256').update(rawToken).digest('hex').slice(0, 8)
    // Resolve to employee. We DON'T reject if the token doesn't match
    // a row — a malformed token from a confused agent should still
    // produce a report (with null IDs) so we can see the error class.
    const supabase = serverSupabase()
    const { data: emp } = await supabase
      .from('employees')
      .select('id, business_id')
      .eq('install_token', rawToken)
      .maybeSingle()
    if (emp) {
      employeeId = emp.id
      businessId = emp.business_id
    }
  }

  // Request fingerprints for anonymous abuse triage.
  // Vercel sets x-forwarded-for; in dev there may be no value.
  const requestIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = request.headers.get('user-agent')

  const supabase = serverSupabase()
  const { data: inserted, error } = await supabase
    .from('agent_startup_errors')
    .insert({
      employee_id: employeeId,
      business_id: businessId,
      error_type: errorType,
      error_message: errorMessage,
      windows_version: windowsVersion,
      agent_version: agentVersion,
      occurred_at: occurredAt,
      install_token_hint: tokenHint,
      request_ip: requestIp,
      user_agent: userAgent ? userAgent.slice(0, 500) : null,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('startup-error: insert failed', error)
    return NextResponse.json(
      { error: error?.message ?? 'insert failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({ id: inserted.id }, { status: 201 })
}
