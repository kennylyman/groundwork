/**
 * Adapter registry. Adding a new tool = adding a file under
 * lib/integrations/adapters/, registering it here, AND adding it to
 * adapters/manifest.ts. Everything else (OAuth callback, runtime, refresh
 * cron, enrichment cron, settings UI) is generic and picks up new
 * entries automatically.
 *
 * The manifest is the client-safe list. This registry holds the full
 * adapter implementations (with OAuth flows + operations). The runtime
 * assert below catches drift between the two.
 */

import type { ToolAdapter } from './types'
import { slackAdapter } from './slack'
import { microsoft365Adapter } from './microsoft365'
import {
  NATIVE_TOOL_MANIFEST,
  nativeToolManifestNames,
} from './manifest'

const ADAPTERS: ToolAdapter[] = [slackAdapter, microsoft365Adapter]

// Fail loud at module load if the manifest and the registry drift apart.
// Better to crash the server boot than serve a UI that promises
// integrations the server can't actually OAuth into.
;(function assertManifestAndRegistryMatch() {
  const fromAdapters = new Set(ADAPTERS.map((a) => a.toolName))
  const fromManifest = new Set(nativeToolManifestNames())
  const inAdaptersOnly = [...fromAdapters].filter((n) => !fromManifest.has(n))
  const inManifestOnly = [...fromManifest].filter((n) => !fromAdapters.has(n))
  if (inAdaptersOnly.length > 0 || inManifestOnly.length > 0) {
    throw new Error(
      `Adapter registry / manifest drift: only-in-registry=${JSON.stringify(
        inAdaptersOnly
      )} only-in-manifest=${JSON.stringify(inManifestOnly)}`
    )
  }
})()

const BY_NAME: Record<string, ToolAdapter> = Object.fromEntries(
  ADAPTERS.map((a) => [a.toolName, a])
)

export function getAdapter(toolName: string): ToolAdapter | null {
  return BY_NAME[toolName] ?? null
}

export function listAdapters(): ToolAdapter[] {
  return [...ADAPTERS]
}

/** Names of tools that have a native OAuth adapter. Identical to
 *  nativeToolManifestNames(), exposed here for routes that already import
 *  from this registry. */
export function nativeToolNames(): string[] {
  return nativeToolManifestNames()
}

export { NATIVE_TOOL_MANIFEST } from './manifest'
export type { NativeToolManifestEntry } from './manifest'
export type { ToolAdapter, ToolCallContext, TokenResponse } from './types'
