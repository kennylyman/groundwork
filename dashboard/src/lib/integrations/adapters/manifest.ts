/**
 * Client-safe list of native adapters.
 *
 * Importing the full adapters from a client component is fine in practice
 * (their entry points are lazy and reference process.env only at call time),
 * but pulling the whole adapter graph into the client bundle is wasteful
 * and makes it easier to accidentally call a server-only function from
 * the browser.
 *
 * This manifest is the single source of truth for "which tools have a
 * native OAuth path". The server registry (adapters/index.ts) must export
 * the same set of toolNames — there's a runtime assert in the registry
 * that throws on mismatch so a missed update fails loudly during dev/CI.
 *
 * Adding a new adapter:
 *   1. Add the toolName here.
 *   2. Implement adapters/<tool>.ts.
 *   3. Register it in adapters/index.ts.
 *
 * Step 1 first lets the settings UI show a "Coming soon" row before the
 * adapter ships, if you want — today we only list shipped adapters.
 */

export type NativeToolManifestEntry = {
  toolName: string
  label: string
}

export const NATIVE_TOOL_MANIFEST: NativeToolManifestEntry[] = [
  { toolName: 'slack', label: 'Slack' },
  { toolName: 'microsoft-365', label: 'Microsoft 365' },
]

export function nativeToolManifestNames(): string[] {
  return NATIVE_TOOL_MANIFEST.map((t) => t.toolName)
}
