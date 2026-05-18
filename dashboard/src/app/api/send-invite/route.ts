import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'
import { resolveEmployeeOwner } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { employeeId } = await request.json()
    if (typeof employeeId !== 'string' || !employeeId) {
      return NextResponse.json({ error: 'employeeId required' }, { status: 400 })
    }

    // Caller must own the business the employee belongs to. This blocks an
    // unauthenticated attacker from triggering invite emails to any employee.
    const ctx = await resolveEmployeeOwner(request, employeeId)
    if (!ctx) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const supabase = serverSupabase()

    const { data: employee, error: empError } = await supabase
      .from('employees')
      .select('*, businesses(*)')
      .eq('id', employeeId)
      .single()

    if (empError || !employee) {
      return NextResponse.json({ error: 'Employee not found', detail: empError?.message }, { status: 404 })
    }

    if (!employee.email) {
      return NextResponse.json({ error: 'No email on file' }, { status: 400 })
    }

    const installUrl = `${process.env.NEXT_PUBLIC_APP_URL}/install/${employee.install_token}`
    const termsUrl = `${process.env.NEXT_PUBLIC_APP_URL}/terms`
    const businessName = employee.businesses?.name || 'your company'

    // Defensive: employees table allows nulls historically; don't blow up
    // the template literal with `.split` on undefined. Falls back to a
    // neutral greeting if name is missing.
    const firstName = (employee.name || '').trim().split(/\s+/)[0] || 'there'

    // Plain-text alternative for clients with HTML disabled / spam-filter
    // signal. Resend accepts `text` alongside `html` and uses HTML when
    // available, falling back to text otherwise.
    const text = [
      `Hi ${firstName},`,
      ``,
      `We're on a mission to find every automation opportunity hiding in how we work — and eliminate the manual, repetitive tasks that eat up your day.`,
      ``,
      `To find them, we need a clear picture of how our team actually operates. That's what Groundwork does. It runs quietly in the background, recognizes the tools and workflows you use, and builds a map of where we can improve. From that map, we identify exactly what to automate and in what order.`,
      ``,
      `What it doesn't do: log keystrokes, read messages, or store screenshots. Ever. Only workflow patterns — which apps, which processes, how often.`,
      ``,
      `Click below to review the full data disclosure, then install in about two minutes.`,
      ``,
      `Review and get set up: ${installUrl}`,
      ``,
      `This link is unique to you and expires once used. Questions? Just reply to this email.`,
      ``,
      `—`,
      `Groundwork · gwork.tech`,
      `Data disclosure: ${termsUrl}`,
    ].join('\n')

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Groundwork <onboarding@gwork.tech>',
        to: employee.email,
        subject: `You've been invited to Groundwork — ${businessName}`,
        text,
        html: `
          <!DOCTYPE html>
          <html>
          <body style="margin: 0; padding: 0; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            <div style="max-width: 520px; margin: 40px auto; padding: 0 20px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <span style="font-size: 18px; font-weight: 600; color: #111827;">⚡ Groundwork</span>
              </div>
              <div style="background: white; border-radius: 16px; border: 1px solid #e5e7eb; padding: 32px;">
                <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #111827;">Hi ${firstName},</h1>
                <p style="margin: 0 0 20px; font-size: 14px; color: #374151; line-height: 1.65;">
                  We&rsquo;re on a mission to find every automation opportunity hiding in how we work &mdash; and eliminate the manual, repetitive tasks that eat up your day.
                </p>
                <p style="margin: 0 0 20px; font-size: 14px; color: #374151; line-height: 1.65;">
                  To find them, we need a clear picture of how our team actually operates. That&rsquo;s what Groundwork does. It runs quietly in the background, recognizes the tools and workflows you use, and builds a map of where we can improve. From that map, we identify exactly what to automate and in what order.
                </p>
                <p style="margin: 0 0 24px; font-size: 14px; color: #374151; line-height: 1.65;">
                  <strong style="color: #111827;">What it doesn&rsquo;t do:</strong> log keystrokes, read messages, or store screenshots. Ever. Only workflow patterns &mdash; which apps, which processes, how often.
                </p>
                <p style="margin: 0 0 24px; font-size: 14px; color: #374151; line-height: 1.65;">
                  Click below to review the full data disclosure, then install in about two minutes.
                </p>
                <a href="${installUrl}" style="display: block; background: #111827; color: white; text-align: center; padding: 14px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; margin-bottom: 20px;">
                  Review and get set up &rarr;
                </a>
                <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center; line-height: 1.6;">
                  This link is unique to you and expires once used.<br/>
                  Questions? Just reply to this email.
                </p>
              </div>
              <p style="text-align: center; font-size: 12px; color: #9ca3af; margin-top: 24px;">
                Groundwork &middot; gwork.tech &middot; <a href="${termsUrl}" style="color: #9ca3af; text-decoration: underline;">Data disclosure</a>
              </p>
            </div>
          </body>
          </html>
        `,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Resend error:', error)
      return NextResponse.json({ error: 'Failed to send email', detail: error }, { status: 500 })
    }

    await supabase
      .from('employees')
      .update({ invite_sent_at: new Date().toISOString() })
      .eq('id', employeeId)

    return NextResponse.json({ success: true })

  } catch (err: any) {
    console.error('Send invite error:', err)
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 })
  }
}
