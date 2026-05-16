'use client'

import { useState } from 'react'
import { Pause, Play } from 'lucide-react'

export function PauseToggle({
  employeeId,
  initialPaused,
  onChange,
  size = 'md',
}: {
  employeeId: string
  initialPaused: boolean
  onChange?: (paused: boolean) => void
  size?: 'sm' | 'md'
}) {
  const [paused, setPaused] = useState(initialPaused)
  const [busy, setBusy] = useState(false)

  async function toggle(e: React.MouseEvent) {
    // Critical when the button lives inside a clickable row.
    e.preventDefault()
    e.stopPropagation()

    if (busy) return
    const next = !paused
    setPaused(next) // optimistic
    setBusy(true)

    try {
      const r = await fetch('/api/employee/set-pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, paused: next }),
      })
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`)
      }
      onChange?.(next)
    } catch (err) {
      console.error('PauseToggle: revert', err)
      setPaused(!next)
    } finally {
      setBusy(false)
    }
  }

  const isSmall = size === 'sm'
  const padding = isSmall ? 'px-2.5 py-1' : 'px-3 py-1.5'
  const iconSize = isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5'
  const textSize = isSmall ? 'text-[11px]' : 'text-xs'

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={paused ? 'Resume capture for this employee' : 'Pause capture for this employee'}
      className={`inline-flex items-center gap-1.5 ${padding} ${textSize} font-medium rounded-lg transition-colors ${
        paused
          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-200'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
      } ${busy ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
    >
      {paused ? <Play className={iconSize} /> : <Pause className={iconSize} />}
      {paused ? 'Resume' : 'Pause'}
    </button>
  )
}

export function PausedBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      Paused
    </span>
  )
}
