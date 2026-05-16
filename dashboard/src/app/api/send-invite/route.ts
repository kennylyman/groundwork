import { NextRequest, NextResponse } from 'next/server'
import { serverSupabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const { employeeId } = await request.json()
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
    const businessName = employee.businesses?.name || 'your company'

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
        html: `
          <!DOCTYPE html>
          <html>
          <body style="margin: 0; padding: 0; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            <div style="max-width: 480px; margin: 40px auto; padding: 0 20px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <span style="font-size: 18px; font-weight: 600; color: #111827;">⚡ Groundwork</span>
              </div>
              <div style="background: white; border-radius: 16px; border: 1px solid #e5e7eb; padding: 32px;">
                <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 600; color: #111827;">Hi ${employee.name.split(' ')[0]},</h1>
                <p style="margin: 0 0 24px; font-size: 14px; color: #6b7280; line-height: 1.6;">
                  ${businessName} is using Groundwork to understand how the team works. You've been added as <strong>${employee.role}</strong>.
                </p>
                <p style="margin: 0 0 24px; font-size: 14px; color: #6b7280; line-height: 1.6;">
                  Groundwork runs quietly in the background and takes a screenshot every 30 seconds to classify what type of work you're doing. No keystrokes or personal data are recorded.
                </p>
                <a href="${installUrl}" style="display: block; background: #111827; color: white; text-align: center; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; margin-bottom: 24px;">
                  Download your installer
                </a>
                <p style="margin: 0; font-size: 12px; color: #9ca3af; text-align: center;">
                  This link is unique to you. Don't share it with others.
                </p>
              </div>
              <p style="text-align: center; font-size: 12px; color: #9ca3af; margin-top: 24px;">Groundwork · gwork.tech</p>
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
