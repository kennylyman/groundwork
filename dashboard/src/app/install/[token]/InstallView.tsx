'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Eye,
  Activity,
  Globe,
  Send,
  Lock,
  MessageCircle,
  ExternalLink,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { CopyButton } from './CopyButton'

type Props = {
  token: string
  employeeName: string
  employeeRole: string | null
  businessName: string
  initialAccepted: boolean
  /** OS detected from the visitor's User-Agent. 'unknown' renders both
   *  download options side-by-side. */
  detectedPlatform: 'windows' | 'mac' | 'unknown'
}

const DISCLOSURE_POINTS: { icon: React.ComponentType<{ className?: string }>; text: string }[] = [
  { icon: Eye, text: 'We take a screenshot of your screen every 30 seconds.' },
  {
    icon: Activity,
    text: 'We count your keystrokes and mouse clicks — but we do NOT record what you type or click.',
  },
  {
    icon: Globe,
    text: 'We record the title of your active window and the URL of your active browser tab.',
  },
  {
    icon: Send,
    text: 'This data is sent to your employer’s private Groundwork dashboard.',
  },
  {
    icon: Lock,
    text: 'We do NOT record passwords, personal messages, emails, or any typed content.',
  },
  {
    icon: MessageCircle,
    text: 'You can ask your manager to pause or stop data collection at any time.',
  },
]

export function InstallView({
  token,
  employeeName,
  employeeRole,
  businessName,
  initialAccepted,
  detectedPlatform,
}: Props) {
  const [accepted, setAccepted] = useState(initialAccepted)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch('/api/employee/accept-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setAccepted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record acknowledgment')
    } finally {
      setSubmitting(false)
    }
  }

  if (!accepted) {
    return (
      <DisclosureGate
        employeeName={employeeName}
        businessName={businessName}
        onAccept={handleAccept}
        submitting={submitting}
        error={error}
      />
    )
  }

  return (
    <Installer
      token={token}
      employeeName={employeeName}
      employeeRole={employeeRole}
      detectedPlatform={detectedPlatform}
    />
  )
}

// ---------- Disclosure (pre-acceptance) ----------

function DisclosureGate({
  employeeName,
  businessName,
  onAccept,
  submitting,
  error,
}: {
  employeeName: string
  businessName: string
  onAccept: () => void
  submitting: boolean
  error: string | null
}) {
  const firstName = employeeName.split(' ')[0]
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8">
      <p className="text-[11px] uppercase tracking-[0.18em] text-amber-600 font-semibold mb-2">
        Before you install
      </p>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">
        Hi {firstName} — please review this first
      </h1>
      <p className="text-sm text-gray-500 mb-6 leading-relaxed">
        {businessName} uses Groundwork to understand how the team works. Here&rsquo;s
        exactly what Groundwork captures, and what it doesn&rsquo;t.
      </p>

      <ul className="space-y-3 mb-6">
        {DISCLOSURE_POINTS.map(({ icon: Icon, text }, i) => (
          <li key={i} className="flex gap-3 items-start">
            <div className="shrink-0 w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center mt-0.5">
              <Icon className="w-3.5 h-3.5" />
            </div>
            <p className="text-sm text-gray-700 leading-relaxed pt-1">{text}</p>
          </li>
        ))}
      </ul>

      <Link
        href="/terms"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 mb-6"
      >
        Read the full disclosure
        <ExternalLink className="w-3 h-3" />
      </Link>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 mb-4 bg-red-50 border border-red-100 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onAccept}
        disabled={submitting}
        className="block w-full bg-gray-900 text-white text-sm font-medium py-3 rounded-xl text-center hover:bg-gray-700 active:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-wait"
      >
        {submitting ? (
          <span className="inline-flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Recording acknowledgment…
          </span>
        ) : (
          'I understand and agree'
        )}
      </button>

      <p className="text-[11px] text-gray-400 text-center mt-3 leading-relaxed">
        Clicking records your acknowledgment with a timestamp. You won&rsquo;t see
        this screen again on this account.
      </p>
    </div>
  )
}

// ---------- Installer (post-acceptance) ----------

function Installer({
  token,
  employeeName,
  employeeRole,
  detectedPlatform,
}: {
  token: string
  employeeName: string
  employeeRole: string | null
  detectedPlatform: 'windows' | 'mac' | 'unknown'
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">
        Thanks, {employeeName.split(' ')[0]}
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Your installer is ready. Follow the steps below to get Groundwork running
        on your machine.
      </p>

      {/* Download — goes through /api/download/{token}?platform=X which
          atomically claims redemption (install_token_redeemed_at = now())
          and 302-redirects to the appropriate GitHub release binary for
          the selected platform. The ?platform query overrides the
          User-Agent detection so a Mac visitor can still grab the
          Windows installer if they need it (e.g. fetching for a
          colleague). */}
      <DownloadButtons token={token} detectedPlatform={detectedPlatform} />

      {/* Install token */}
      <div className="mb-6">
        <p className="text-xs font-medium text-gray-700 mb-2">Your install token</p>
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 font-mono text-xs text-gray-900 break-all select-all mb-2">
          {token}
        </div>
        <CopyButton
          value={token}
          label="📋 Copy token"
          className="block w-full bg-indigo-600 text-white text-sm font-medium py-3 rounded-xl text-center hover:bg-indigo-700 active:bg-indigo-800 transition-colors"
        />
        <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
          You&rsquo;ll paste this into Groundwork the first time you launch it. After
          that, the app remembers it.
        </p>
      </div>

      {/* Setup instructions — platform-aware so Mac users see Gatekeeper
          guidance ("Open Anyway in System Settings → Privacy & Security")
          and Windows users see SmartScreen guidance. */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-gray-700">Setup steps</p>
        {(detectedPlatform === 'mac'
          ? [
              { step: '1', text: 'Download Groundwork (button above) — it lands in your Downloads folder.' },
              { step: '2', text: 'Double-click the downloaded file to launch it.' },
              { step: '3', text: 'If macOS blocks it: open System Settings → Privacy & Security, scroll to "Groundwork was blocked", and click "Open Anyway".' },
              { step: '4', text: 'macOS will ask for Screen Recording permission. Grant it in System Settings → Privacy & Security → Screen Recording, then relaunch.' },
              { step: '5', text: 'Paste your install token into the window that appears, then click Continue.' },
              { step: '6', text: 'Done — Groundwork runs silently. Future launches skip this step.' },
            ]
          : [
          { step: '1', text: 'Download Groundwork.exe (button above) — it lands in your Downloads folder.' },
          { step: '2', text: 'Double-click Groundwork.exe to launch it.' },
          { step: '3', text: 'If Windows SmartScreen blocks it: click "More info" → "Run anyway".' },
          { step: '4', text: 'Paste your install token into the window that appears, then click Continue.' },
          { step: '5', text: 'Done — Groundwork runs silently. Future launches skip this step.' },
        ]).map((item) => (
          <div key={item.step} className="flex gap-3">
            <div className="w-5 h-5 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-medium shrink-0">
              {item.step}
            </div>
            <p className="text-xs text-gray-600 pt-0.5 leading-relaxed">{item.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-6 border-t border-gray-100">
        <p className="text-xs text-gray-400 text-center">
          Installer configured for{' '}
          <strong className="text-gray-600">{employeeName}</strong>
          {employeeRole && (
            <>
              {' '}· {employeeRole}
            </>
          )}
        </p>
        <p className="text-[11px] text-gray-400 text-center mt-2">
          <Link
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-600"
          >
            Review the data-collection disclosure
          </Link>
        </p>
      </div>
    </div>
  )
}

// ---------- Platform-aware download buttons ----------

function DownloadButtons({
  token,
  detectedPlatform,
}: {
  token: string
  detectedPlatform: 'windows' | 'mac' | 'unknown'
}) {
  const encoded = encodeURIComponent(token)
  // Primary button = detected OS. When detection failed (mobile UA,
  // Linux, etc), show both side-by-side so the user can choose.
  if (detectedPlatform === 'unknown') {
    return (
      <div className="grid grid-cols-2 gap-2 mb-6">
        <a
          href={`/api/download/${encoded}?platform=windows`}
          className="block bg-gray-900 text-white text-sm font-medium py-3 rounded-xl text-center hover:bg-gray-700 transition-colors"
        >
          ⬇️ Windows
        </a>
        <a
          href={`/api/download/${encoded}?platform=mac`}
          className="block bg-gray-900 text-white text-sm font-medium py-3 rounded-xl text-center hover:bg-gray-700 transition-colors"
        >
          ⬇️ macOS
        </a>
      </div>
    )
  }
  const label =
    detectedPlatform === 'mac'
      ? '⬇️ Download Groundwork for Mac'
      : '⬇️ Download Groundwork for Windows'
  const otherLabel = detectedPlatform === 'mac' ? 'Need Windows?' : 'Need Mac?'
  const otherPlatform = detectedPlatform === 'mac' ? 'windows' : 'mac'
  return (
    <div className="mb-6">
      <a
        href={`/api/download/${encoded}?platform=${detectedPlatform}`}
        className="block w-full bg-gray-900 text-white text-sm font-medium py-3 rounded-xl text-center hover:bg-gray-700 transition-colors mb-2"
      >
        {label}
      </a>
      <a
        href={`/api/download/${encoded}?platform=${otherPlatform}`}
        className="block text-xs text-gray-500 text-center underline hover:text-gray-700"
      >
        {otherLabel}
      </a>
    </div>
  )
}
