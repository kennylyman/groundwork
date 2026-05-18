import { notFound } from 'next/navigation'
import { serverSupabase } from '@/lib/supabase'
import { InstallView } from './InstallView'

export default async function InstallPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const { data: employee } = await serverSupabase()
    .from('employees')
    .select(
      'id, name, role, terms_accepted_at, install_token_redeemed_at, businesses(name)'
    )
    .eq('install_token', token)
    .single()

  if (!employee) return notFound()

  const businessName =
    (employee.businesses as { name?: string } | { name?: string }[] | null)
      ? Array.isArray(employee.businesses)
        ? employee.businesses[0]?.name ?? 'your company'
        : (employee.businesses as { name?: string }).name ?? 'your company'
      : 'your company'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center text-white text-sm">
            ⚡
          </div>
          <span className="text-lg font-semibold text-gray-900">Groundwork</span>
        </div>

        {employee.install_token_redeemed_at ? (
          // One-shot enforcement: the binary download endpoint atomically
          // sets install_token_redeemed_at on first claim. Subsequent
          // page loads (or shared/forwarded links) land here. The owner
          // can re-issue via /api/send-invite, which rotates the token.
          <LinkUsedNotice
            employeeName={employee.name}
            redeemedAt={employee.install_token_redeemed_at}
          />
        ) : (
          <InstallView
            token={token}
            employeeName={employee.name}
            employeeRole={employee.role}
            businessName={businessName}
            initialAccepted={!!employee.terms_accepted_at}
          />
        )}
      </div>
    </div>
  )
}

function LinkUsedNotice({
  employeeName,
  redeemedAt,
}: {
  employeeName: string
  redeemedAt: string
}) {
  const firstName = (employeeName || '').trim().split(/\s+/)[0] || 'there'
  const when = new Date(redeemedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8">
      <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 font-semibold mb-2">
        Install link used
      </p>
      <h1 className="text-xl font-semibold text-gray-900 mb-2">
        Hi {firstName} — this link has already been used
      </h1>
      <p className="text-sm text-gray-500 leading-relaxed mb-4">
        The Groundwork installer was downloaded from this link on {when}.
        Each install link is one-shot, so this URL no longer works.
      </p>
      <p className="text-sm text-gray-500 leading-relaxed mb-6">
        If you need to reinstall — say, you got a new computer or wiped
        your machine — ask your administrator to send you a fresh invite.
        They&rsquo;ll be able to re-issue with one click.
      </p>
      <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
        <p className="text-xs text-gray-500 leading-relaxed">
          <strong className="text-gray-700">Already installed Groundwork?</strong>
          {' '}You don&rsquo;t need to do anything. The agent is running on the
          machine where you originally installed it.
        </p>
      </div>
    </div>
  )
}
