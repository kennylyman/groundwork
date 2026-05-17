/**
 * Daily heartbeat digest.
 *
 * For every business, find active employees whose agent has been silent
 * for more than 24 hours (no agent_version heartbeat + no captures). If
 * the business has any, email the owner a single roll-up.
 *
 * Trigger: Vercel cron at 13:30 UTC (~ 9:30 AM ET / 6:30 AM PT) — early
 * enough that the owner sees it before the workday starts. Daily cadence
 * matches the Hobby plan ceiling; an at-most-once-a-day notification is
 * the right velocity for "agent dead" anyway.
 *
 * Idempotency: we don't dedupe — if an agent stays silent for 3 days,
 * the owner gets 3 emails. Acceptable because the signal is genuinely
 * still actionable each day.
 */
import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'

export const maxDuration = 60

const SILENT_HOURS = 24
const FROM_EMAIL = 'Groundwork <onboarding@gwork.tech>'

function authorized(req: NextRequest): boolean {
  const cronHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && cronHeader === `Bearer ${cronSecret}`) return true
  if (process.env.VERCEL_ENV !== 'production') return true
  return false
}

type Business = { id: string; name: string; owner_id: string }
type EmployeeRow = {
  id: string
  name: string
  role: string
  business_id: string
  agent_version_updated_at: string | null
}

type AdminUserListResponse = {
  users: Array<{ id: string; email?: string | null }>
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serverSupabase()
  const cutoff = new Date(Date.now() - SILENT_HOURS * 60 * 60 * 1000).toISOString()

  // Pull every business + its owner_id + name in one read.
  const { data: businesses, error: bizErr } = await supabase
    .from('businesses')
    .select('id, name, owner_id')
  if (bizErr) {
    console.error('heartbeat-digest: businesses', bizErr)
    return NextResponse.json({ error: bizErr.message }, { status: 500 })
  }
  if (!businesses || businesses.length === 0) {
    return NextResponse.json({ businesses: 0, emails_sent: 0 })
  }

  // Pull every active employee across the platform — at our scale this
  // is small. If it grows, shard by business.
  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id, name, role, business_id, agent_version_updated_at')
    .eq('is_active', true)
    .eq('is_paused', false)
  if (empErr) {
    console.error('heartbeat-digest: employees', empErr)
    return NextResponse.json({ error: empErr.message }, { status: 500 })
  }

  // Pull the most recent capture per employee within the silent window.
  // If a capture exists in this window, the agent has been alive recently.
  // Captures older than the window are irrelevant — we use only "is there
  // any capture in [now-24h, now]" as the signal.
  const employeeIds = (employees ?? []).map((e: EmployeeRow) => e.id)
  let recentCaptureIds = new Set<string>()
  if (employeeIds.length > 0) {
    const { data: recentCaps } = await supabase
      .from('captures')
      .select('employee_id')
      .in('employee_id', employeeIds)
      .gte('captured_at', cutoff)
    recentCaptureIds = new Set(
      (recentCaps ?? []).map((c: { employee_id: string }) => c.employee_id)
    )
  }

  const silentByBusiness = new Map<string, EmployeeRow[]>()
  for (const emp of (employees ?? []) as EmployeeRow[]) {
    const hasRecentCapture = recentCaptureIds.has(emp.id)
    const heartbeatRecent =
      emp.agent_version_updated_at &&
      emp.agent_version_updated_at >= cutoff
    if (hasRecentCapture || heartbeatRecent) continue
    const list = silentByBusiness.get(emp.business_id) ?? []
    list.push(emp)
    silentByBusiness.set(emp.business_id, list)
  }

  if (silentByBusiness.size === 0) {
    return NextResponse.json({
      businesses: businesses.length,
      employees: employees?.length ?? 0,
      emails_sent: 0,
      message: 'no silent agents — no emails to send',
    })
  }

  // Look up owner emails. Supabase admin API takes a user id and returns
  // the user record including email. We list once (cheaper than N
  // single-user fetches at small scale) — at >1000 businesses we'd
  // switch to per-id getUserById.
  const adminAuth = (supabase as unknown as {
    auth: {
      admin: {
        listUsers: (params: { perPage?: number; page?: number }) => Promise<{
          data: AdminUserListResponse
          error: { message: string } | null
        }>
      }
    }
  }).auth.admin
  const usersById = new Map<string, string>()
  try {
    const usersRes = await adminAuth.listUsers({ perPage: 1000 })
    for (const u of usersRes.data.users) {
      if (u.email) usersById.set(u.id, u.email)
    }
  } catch (e) {
    console.error('heartbeat-digest: list users failed', e)
    return NextResponse.json({ error: 'admin list users failed' }, { status: 500 })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.error('heartbeat-digest: RESEND_API_KEY not set')
    return NextResponse.json({ error: 'email not configured' }, { status: 500 })
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.gwork.tech'

  let sent = 0
  const failures: string[] = []

  for (const [bizId, silentEmps] of silentByBusiness) {
    const biz = businesses.find((b: Business) => b.id === bizId)
    if (!biz) continue
    const email = usersById.get(biz.owner_id)
    if (!email) {
      failures.push(`${bizId}: no owner email`)
      continue
    }

    const rows = silentEmps
      .map((emp) => {
        const lastHb = emp.agent_version_updated_at
          ? new Date(emp.agent_version_updated_at).toLocaleString()
          : 'never'
        return `
          <tr>
            <td style="padding: 8px 12px; font-size: 13px; color: #111827;">
              ${escapeHtml(emp.name)}
              <span style="color: #6b7280; font-size: 12px;"> — ${escapeHtml(emp.role || 'employee')}</span>
            </td>
            <td style="padding: 8px 12px; font-size: 12px; color: #6b7280;">
              Last check-in: ${lastHb}
            </td>
          </tr>
        `
      })
      .join('')

    const subject = `${silentEmps.length} Groundwork agent${
      silentEmps.length === 1 ? '' : 's'
    } silent — ${biz.name}`
    const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:32px auto;padding:0 20px;">
    <div style="background:white;border-radius:16px;border:1px solid #e5e7eb;padding:28px;">
      <h1 style="margin:0 0 6px;font-size:18px;font-weight:600;color:#111827;">Some agents have been silent</h1>
      <p style="margin:0 0 18px;font-size:14px;color:#6b7280;line-height:1.6;">
        The Groundwork agents below haven&rsquo;t checked in for more than 24 hours.
        They may have been uninstalled, the machines may be off, or the agent may
        have crashed and not been restarted.
      </p>
      <table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:8px;overflow:hidden;">
        ${rows}
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
        Open the dashboard to investigate — silent employees are flagged with a red <strong>Agent silent</strong> badge.
      </p>
      <a href="${appUrl}/" style="display:inline-block;margin-top:16px;background:#111827;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:500;">Open dashboard</a>
    </div>
    <p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:20px;">
      Groundwork · gwork.tech
    </p>
  </div>
</body></html>`

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: email,
          subject,
          html,
        }),
      })
      if (!r.ok) {
        const body = await r.text()
        failures.push(`${biz.id}: resend ${r.status} ${body.slice(0, 200)}`)
        continue
      }
      sent += 1
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown'
      failures.push(`${biz.id}: ${message}`)
    }
  }

  return NextResponse.json({
    businesses: businesses.length,
    silent_businesses: silentByBusiness.size,
    emails_sent: sent,
    failures: failures.length ? failures : undefined,
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export const GET = handle
export const POST = handle
