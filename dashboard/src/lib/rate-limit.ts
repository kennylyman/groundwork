/**
 * Per-business rate limit on expensive LLM routes.
 *
 * Currently applied to: generate-sop, generate-intelligence, intake/chat,
 * discover-roles. Limit: 10 calls per business per minute (sliding window).
 * Identifier for intake/chat is per-user since the business doesn't exist
 * yet during onboarding.
 *
 * Fails OPEN when Upstash env vars are missing (e.g., local dev or before
 * the Vercel env is configured). Fails CLOSED only when Upstash itself
 * returns an error — in which case we'd rather block the call than risk
 * unbounded Anthropic spend.
 *
 * Required env:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 * Both are provisioned by Upstash and pasted into Vercel.
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const RATE_LIMIT_REQUESTS = 10
const RATE_LIMIT_WINDOW = '60 s'

type LimitResult = {
  success: boolean
  remaining: number
  reset: number
  reason?: 'configured' | 'no-upstash' | 'upstash-error'
}

let cachedLimiter: Ratelimit | null = null
let upstashInitChecked = false

function getLimiter(): Ratelimit | null {
  if (upstashInitChecked) return cachedLimiter
  upstashInitChecked = true

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    return null
  }

  try {
    cachedLimiter = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW),
      analytics: true,
      prefix: 'gw:llm',
    })
    return cachedLimiter
  } catch (err) {
    console.error('rate-limit: Upstash init failed', err)
    return null
  }
}

/**
 * Check the per-key rate limit. The key should namespace the entity that
 * "owns" the cost — usually `business:<id>` for owner-facing routes, or
 * `user:<id>` for routes that run during onboarding before a business
 * exists.
 */
export async function checkRateLimit(key: string): Promise<LimitResult> {
  const limiter = getLimiter()
  if (!limiter) {
    // Fail open — better to allow calls than block all users when Upstash
    // isn't configured yet. The route's existing auth check is still the
    // primary access control.
    return { success: true, remaining: RATE_LIMIT_REQUESTS, reset: 0, reason: 'no-upstash' }
  }

  try {
    const result = await limiter.limit(key)
    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
      reason: 'configured',
    }
  } catch (err) {
    // Upstash is configured but errored. Fail CLOSED here — if rate
    // limiting is supposed to be on, we'd rather block than risk runaway
    // Anthropic spend.
    console.error('rate-limit: Upstash request failed', err)
    return { success: false, remaining: 0, reset: 0, reason: 'upstash-error' }
  }
}
