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

const LLM_RATE_LIMIT_REQUESTS = 10
const LLM_RATE_LIMIT_WINDOW = '60 s'
// Capture ingestion runs ~2/min in steady state (one capture every 30s
// per agent). 30/min gives 15x headroom for queue-flush bursts (after a
// network hiccup the agent may flush several at once) while still
// shutting down a stolen-token abuse case where someone tries to spam
// captures.
const CAPTURES_RATE_LIMIT_REQUESTS = 30
const CAPTURES_RATE_LIMIT_WINDOW = '60 s'

type LimitResult = {
  success: boolean
  remaining: number
  reset: number
  reason?: 'configured' | 'no-upstash' | 'upstash-error'
}

let cachedLlmLimiter: Ratelimit | null = null
let cachedCapturesLimiter: Ratelimit | null = null
let upstashInitChecked = false
let upstashRedis: Redis | null = null

function ensureUpstash(): Redis | null {
  if (upstashInitChecked) return upstashRedis
  upstashInitChecked = true
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    upstashRedis = new Redis({ url, token })
    return upstashRedis
  } catch (err) {
    console.error('rate-limit: Upstash init failed', err)
    return null
  }
}

function getLimiter(): Ratelimit | null {
  if (cachedLlmLimiter) return cachedLlmLimiter
  const redis = ensureUpstash()
  if (!redis) return null
  cachedLlmLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(LLM_RATE_LIMIT_REQUESTS, LLM_RATE_LIMIT_WINDOW),
    analytics: true,
    prefix: 'gw:llm',
  })
  return cachedLlmLimiter
}

function getCapturesLimiter(): Ratelimit | null {
  if (cachedCapturesLimiter) return cachedCapturesLimiter
  const redis = ensureUpstash()
  if (!redis) return null
  cachedCapturesLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(
      CAPTURES_RATE_LIMIT_REQUESTS,
      CAPTURES_RATE_LIMIT_WINDOW
    ),
    analytics: true,
    prefix: 'gw:captures',
  })
  return cachedCapturesLimiter
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
    return { success: true, remaining: LLM_RATE_LIMIT_REQUESTS, reset: 0, reason: 'no-upstash' }
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

/**
 * Per-install-token rate limit on /api/captures. Steady state is one
 * capture every 30s; we allow 30/min to leave headroom for queue-flush
 * bursts and clock drift. Burst guard against a stolen-token-spam scenario.
 *
 * Key shape: `captures:<install_token>`. We hash the token rather than
 * raw-include it to avoid Upstash logging the bare credential.
 */
export async function checkCapturesRateLimit(installToken: string): Promise<LimitResult> {
  const limiter = getCapturesLimiter()
  if (!limiter) {
    return { success: true, remaining: CAPTURES_RATE_LIMIT_REQUESTS, reset: 0, reason: 'no-upstash' }
  }

  // Don't pass the raw token through Upstash — hash it first.
  // crypto is node-native so safe in server-side routes.
  const { createHash } = await import('node:crypto')
  const hashed = createHash('sha256').update(installToken).digest('hex').slice(0, 32)
  const key = `captures:${hashed}`

  try {
    const result = await limiter.limit(key)
    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
      reason: 'configured',
    }
  } catch (err) {
    // For captures specifically we fail OPEN on Upstash errors. We'd
    // rather accept the capture than lose data — the install_token
    // validation already gates access, and a stolen-token DoS scenario
    // can be handled by reactivating the employee.
    console.error('rate-limit (captures): Upstash request failed', err)
    return { success: true, remaining: 0, reset: 0, reason: 'upstash-error' }
  }
}
