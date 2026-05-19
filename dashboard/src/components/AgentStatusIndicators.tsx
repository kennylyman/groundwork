'use client'

/**
 * AgentStatusIndicators — two-chip status display for an employee row.
 *
 * Splits the legacy single "online/offline" badge into two distinct
 * signals so owners can tell the difference between a crashed agent
 * and an idle employee:
 *
 *   1. Agent health (is the process running?)
 *      - Active        — heartbeat within 90 min
 *      - No heartbeat  — heartbeat older than 90 min (agent crashed/network)
 *      - Not installed — agent_version null (never set up)
 *
 *   2. Last active (when did they last do something?)
 *      - "Active now" / "12 min ago" / "2 hrs ago" / "Yesterday" / "No activity yet"
 *      - Optional qualifier: "Idle" (still at desk but quiet) or
 *        "Off hours" (last activity was outside the business window)
 *
 * Shared by /(home dashboard) and /settings/team so the two surfaces
 * never drift apart.
 */

import { CircleDot, CircleOff, Circle, Wifi } from 'lucide-react'
import type { AgentHealth, LastActive } from '@/lib/agent-heartbeat'


export function AgentHealthChip({
  health,
  ageLabel,
}: {
  health: AgentHealth
  /** Short suffix shown in the tooltip: "Last seen 12 min ago". */
  ageLabel?: string
}) {
  const cfg = HEALTH_VARIANTS[health]
  const Icon = cfg.icon
  return (
    <span
      title={ageLabel ? `${cfg.tooltip} (last seen ${ageLabel})` : cfg.tooltip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cfg.classes}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  )
}

const HEALTH_VARIANTS: Record<
  AgentHealth,
  { label: string; tooltip: string; classes: string; icon: typeof CircleDot }
> = {
  active: {
    label: 'Active',
    tooltip: 'Agent heartbeat received in the last 90 minutes',
    classes: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    icon: CircleDot,
  },
  no_heartbeat: {
    label: 'No heartbeat',
    tooltip: 'Agent has not checked in for over 90 minutes — may have crashed or lost connection',
    classes: 'bg-red-50 text-red-700 border-red-100',
    icon: CircleOff,
  },
  not_installed: {
    label: 'Not installed',
    tooltip: 'No agent installed yet — send an invite from the team page',
    classes: 'bg-gray-50 text-gray-500 border-gray-200',
    icon: Circle,
  },
}


export function LastActiveChip({ value }: { value: LastActive }) {
  const qualifier = value.qualifier
  // Color: green when active-now, amber when idle (gentle attention),
  // gray for everything else (off hours, plain timestamps, no activity).
  let toneClasses: string
  if (value.text === 'Active now') {
    toneClasses = 'bg-emerald-50 text-emerald-700 border-emerald-100'
  } else if (qualifier === 'idle') {
    toneClasses = 'bg-amber-50 text-amber-700 border-amber-100'
  } else {
    toneClasses = 'bg-gray-50 text-gray-600 border-gray-200'
  }
  return (
    <span
      title={tooltipFor(value)}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${toneClasses}`}
    >
      <Wifi className="w-2.5 h-2.5" />
      {value.text}
      {qualifier && (
        <span className="text-[10px] opacity-75">· {QUALIFIER_LABEL[qualifier]}</span>
      )}
    </span>
  )
}

const QUALIFIER_LABEL: Record<'idle' | 'off_hours', string> = {
  idle: 'Idle',
  off_hours: 'Off hours',
}

function tooltipFor(v: LastActive): string {
  const base = `Last capture: ${v.text}`
  if (v.qualifier === 'idle') {
    return `${base}. Agent is alive but no captures during business hours — user may be away from their desk.`
  }
  if (v.qualifier === 'off_hours') {
    return `${base}. Last capture was outside business hours — expected end-of-shift silence.`
  }
  return base
}
