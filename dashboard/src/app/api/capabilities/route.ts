/**
 * GET /api/capabilities
 *
 * Public, read-only endpoint that returns the canonical capability taxonomy
 * from the `capability_registry` table. Used by the client-side
 * `useCapabilities()` hook so React components can show human-readable
 * labels for capability ids without bundling the taxonomy.
 *
 * The taxonomy isn't per-business data — it's part of the product vocabulary,
 * so no auth check. The server caches the registry in-memory for 5 minutes
 * via lib/capabilities-server. We also set a short browser/edge cache TTL
 * so a returning page paint is instant.
 */
import { NextResponse } from 'next/server'
import { getCapabilities } from '@/lib/capabilities-server'

export async function GET() {
  try {
    const capabilities = await getCapabilities()
    return NextResponse.json(
      { capabilities },
      {
        headers: {
          // 5 min fresh, 10 min stale-while-revalidate. Matches the
          // server-side cache TTL so changes propagate within ~10 min
          // without a deploy.
          'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
        },
      }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('GET /api/capabilities failed', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
