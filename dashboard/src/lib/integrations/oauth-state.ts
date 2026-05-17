/**
 * Signed OAuth state token.
 *
 * Carries the business_id + tool_name through the OAuth redirect dance so
 * the generic /api/integrations/oauth/callback handler knows which adapter
 * to dispatch to AND which business to write the resulting tokens against.
 *
 * Why signed: the `state` parameter round-trips through the user's browser
 * and the provider. Without a signature, an attacker could craft a state
 * pointing at a different business id and link their own OAuth grant to
 * someone else's tenant. HMAC-SHA256 over the payload prevents tampering.
 *
 * Also bounded by a 10-minute TTL — OAuth dances should complete in
 * seconds, so a 10-min window is plenty of slack for slow IdP UIs and
 * blocks replay of an old state long after the auth attempt.
 */

import crypto from 'node:crypto'

const TTL_MS = 10 * 60 * 1000

type StatePayload = {
  /** business_id */
  b: string
  /** tool_name (e.g., "slack") */
  t: string
  /** ISO timestamp ms when the state was minted */
  at: number
  /** Random nonce to make every state unique. */
  n: string
}

type SignedEnvelope = {
  p: StatePayload
  s: string
}

function getSecret(): Buffer {
  // We deliberately reuse INTEGRATION_ENCRYPTION_KEY here. State-signing
  // and token-encryption are both server-only secrets; bundling them under
  // one env var means there's one fewer thing to misconfigure. If you ever
  // need separate rotation cadences, split this into its own env.
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY is not set — needed for OAuth state signing.'
    )
  }
  return Buffer.from(raw, 'base64')
}

export function createOAuthState(businessId: string, tool: string): string {
  const payload: StatePayload = {
    b: businessId,
    t: tool,
    at: Date.now(),
    n: crypto.randomBytes(8).toString('hex'),
  }
  const sig = crypto
    .createHmac('sha256', getSecret())
    .update(JSON.stringify(payload))
    .digest('base64url')
  const envelope: SignedEnvelope = { p: payload, s: sig }
  return Buffer.from(JSON.stringify(envelope)).toString('base64url')
}

export function verifyOAuthState(
  state: string | null | undefined
): { businessId: string; tool: string } | null {
  if (!state) return null
  let envelope: SignedEnvelope
  try {
    envelope = JSON.parse(
      Buffer.from(state, 'base64url').toString('utf8')
    ) as SignedEnvelope
  } catch {
    return null
  }
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    !envelope.p ||
    !envelope.s
  ) {
    return null
  }

  const expectedSig = crypto
    .createHmac('sha256', getSecret())
    .update(JSON.stringify(envelope.p))
    .digest('base64url')

  // Constant-time compare to avoid timing attacks on the signature byte.
  const sigBuf = Buffer.from(envelope.s, 'base64url')
  const expBuf = Buffer.from(expectedSig, 'base64url')
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    return null
  }

  // TTL check
  if (
    typeof envelope.p.at !== 'number' ||
    Date.now() - envelope.p.at > TTL_MS
  ) {
    return null
  }

  if (typeof envelope.p.b !== 'string' || typeof envelope.p.t !== 'string') {
    return null
  }

  return { businessId: envelope.p.b, tool: envelope.p.t }
}
