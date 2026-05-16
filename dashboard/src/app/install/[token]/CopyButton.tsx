'use client'

import { useState } from 'react'

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = '✅ Copied to clipboard',
  className,
}: {
  value: string
  label?: string
  copiedLabel?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API not available (insecure context, old browser) — fail silently
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={
        className ??
        'text-xs font-medium text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100 transition-colors shrink-0'
      }
    >
      {copied ? copiedLabel : label}
    </button>
  )
}
