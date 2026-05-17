/**
 * Capability taxonomy — client-side hook.
 *
 * The server stores the canonical taxonomy in `capability_registry` (see
 * supabase/migrations/0011_capability_registry.sql) and exposes it via
 * GET /api/capabilities. This module wraps that endpoint in a React Context
 * so any client component can render labels for capability ids.
 *
 * The provider fetches once per page mount, holds the result in module-level
 * memory, and reuses it across the tree. Subsequent mounts (e.g., after a
 * client-side navigation) skip the network entirely.
 *
 * Usage:
 *   // In a layout or root component
 *   <CapabilityProvider>
 *     ...
 *   </CapabilityProvider>
 *
 *   // In any client component
 *   const { capabilityLabel } = useCapabilities()
 *   <span>{capabilityLabel('data.entry.form_fill')}</span>
 *
 * Before the fetch resolves, capabilityLabel(id) returns the id itself —
 * good enough as a placeholder, and the label fills in on next paint.
 */
'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react'

export type Capability = {
  id: string
  label: string
  automatable: boolean
}

type CapabilityState = {
  byId: Record<string, Capability>
  loaded: boolean
}

// Module-level cache so navigations within a single tab don't refetch.
let _moduleCache: CapabilityState | null = null
let _inFlight: Promise<CapabilityState> | null = null

async function fetchCapabilities(): Promise<CapabilityState> {
  if (_moduleCache) return _moduleCache
  if (_inFlight) return _inFlight
  _inFlight = (async () => {
    try {
      const res = await fetch('/api/capabilities', { cache: 'force-cache' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { capabilities: Capability[] }
      const byId: Record<string, Capability> = {}
      for (const c of body.capabilities ?? []) byId[c.id] = c
      _moduleCache = { byId, loaded: true }
      return _moduleCache
    } catch (err) {
      console.error('useCapabilities: fetch failed', err)
      // Surface an empty taxonomy — components fall back to rendering the id.
      _moduleCache = { byId: {}, loaded: true }
      return _moduleCache
    } finally {
      _inFlight = null
    }
  })()
  return _inFlight
}

type CapabilityContextValue = {
  byId: Record<string, Capability>
  loaded: boolean
  capabilityLabel: (id: string) => string
}

const CapabilityContext = createContext<CapabilityContextValue | null>(null)

export function CapabilityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CapabilityState>(
    _moduleCache ?? { byId: {}, loaded: false }
  )

  useEffect(() => {
    if (state.loaded) return
    let cancelled = false
    void fetchCapabilities().then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [state.loaded])

  const capabilityLabel = useCallback(
    (id: string) => state.byId[id]?.label ?? id,
    [state.byId]
  )

  const value = useMemo<CapabilityContextValue>(
    () => ({ byId: state.byId, loaded: state.loaded, capabilityLabel }),
    [state.byId, state.loaded, capabilityLabel]
  )

  return (
    <CapabilityContext.Provider value={value}>
      {children}
    </CapabilityContext.Provider>
  )
}

/**
 * Hook for client components that need to render capability labels.
 *
 * Outside a provider, the hook still works — it lazily kicks off a fetch
 * on first mount and renders the id as a placeholder until the response
 * lands. This keeps callers from blowing up when a component is rendered
 * in a context that forgot to wrap with `<CapabilityProvider>`.
 */
export function useCapabilities(): CapabilityContextValue {
  const ctx = useContext(CapabilityContext)
  const [fallbackState, setFallbackState] = useState<CapabilityState>(
    _moduleCache ?? { byId: {}, loaded: false }
  )

  useEffect(() => {
    if (ctx) return
    if (fallbackState.loaded) return
    let cancelled = false
    void fetchCapabilities().then((next) => {
      if (!cancelled) setFallbackState(next)
    })
    return () => {
      cancelled = true
    }
  }, [ctx, fallbackState.loaded])

  if (ctx) return ctx

  return {
    byId: fallbackState.byId,
    loaded: fallbackState.loaded,
    capabilityLabel: (id: string) => fallbackState.byId[id]?.label ?? id,
  }
}
