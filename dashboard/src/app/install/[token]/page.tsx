import { notFound } from 'next/navigation'
import { serverSupabase } from '@/lib/supabase'
import { CopyButton } from './CopyButton'

export default async function InstallPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data: employee } = await serverSupabase()
    .from('employees')
    .select('*, businesses(*)')
    .eq('install_token', token)
    .single()

  if (!employee) return notFound()

  const businessName = employee.businesses?.name || 'your company'
  const runCommand = `.\\Groundwork.exe ${token}`

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

        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          <h1 className="text-xl font-semibold text-gray-900 mb-1">
            Hi {employee.name.split(' ')[0]}
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            {businessName} uses Groundwork to understand how the team works.
            Your installer is ready to download.
          </p>

          {/* What it does */}
          <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-3">
            <p className="text-xs font-medium text-gray-700">What Groundwork does</p>
            {[
              '📸 Takes a screenshot every 30 seconds',
              '🏷️ Classifies what type of work you\'re doing',
              '📊 Sends category data to your manager\'s dashboard',
              '🔒 No keystrokes, passwords, or personal data recorded',
            ].map(item => (
              <p key={item} className="text-xs text-gray-600">{item}</p>
            ))}
          </div>

          {/* Download button */}
          <a
            href="https://github.com/kennylyman/groundwork/releases/latest/download/Groundwork.exe"
            className="block w-full bg-gray-900 text-white text-sm font-medium py-3 rounded-xl text-center hover:bg-gray-700 transition-colors mb-6"
          >
            ⬇️ Download Groundwork for Windows
          </a>

          {/* Install token */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-700">Your install token</p>
              <CopyButton value={token} />
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 font-mono text-xs text-gray-900 break-all select-all">
              {token}
            </div>
          </div>

          {/* First-run command */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-700">First-run command</p>
              <CopyButton value={runCommand} label="Copy command" />
            </div>
            <div className="bg-gray-900 text-gray-100 rounded-lg px-3 py-2.5 font-mono text-xs break-all select-all">
              {runCommand}
            </div>
            <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
              You only need this command the first time. After that, Groundwork
              saves your settings and you can just double-click the exe.
            </p>
          </div>

          {/* Setup instructions */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-gray-700">Setup steps</p>
            {[
              { step: '1', text: 'Download Groundwork.exe (button above) — it lands in your Downloads folder.' },
              { step: '2', text: 'Press Win + X and choose "Terminal" (or "Windows PowerShell").' },
              { step: '3', text: 'Type cd Downloads and press Enter.' },
              { step: '4', text: 'Paste the first-run command above and press Enter.' },
              { step: '5', text: 'If Windows SmartScreen blocks it: click "More info" → "Run anyway".' },
              { step: '6', text: 'Done — Groundwork runs silently. Future launches don\'t need the token.' },
            ].map(item => (
              <div key={item.step} className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-medium shrink-0">
                  {item.step}
                </div>
                <p className="text-xs text-gray-600 pt-0.5 leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>

          {/* Your details */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center">
              Installer configured for <strong className="text-gray-600">{employee.name}</strong> · {employee.role}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
