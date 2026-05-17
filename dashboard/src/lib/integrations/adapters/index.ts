/**
 * Adapter registry. Adding a new tool = adding a file under
 * lib/integrations/adapters/ and exporting it here. Everything else
 * (OAuth callback, runtime, refresh cron, enrichment cron, settings UI)
 * is generic and picks up new entries automatically.
 */

import type { ToolAdapter } from './types'
import { slackAdapter } from './slack'

const ADAPTERS: ToolAdapter[] = [slackAdapter]

const BY_NAME: Record<string, ToolAdapter> = Object.fromEntries(
  ADAPTERS.map((a) => [a.toolName, a])
)

export function getAdapter(toolName: string): ToolAdapter | null {
  return BY_NAME[toolName] ?? null
}

export function listAdapters(): ToolAdapter[] {
  return [...ADAPTERS]
}

/** Names of tools that have a native OAuth adapter — used by the
 *  settings UI to decide whether to show "Connect" or "Connect via Zapier". */
export function nativeToolNames(): string[] {
  return ADAPTERS.map((a) => a.toolName)
}

export type { ToolAdapter, ToolCallContext, TokenResponse } from './types'
