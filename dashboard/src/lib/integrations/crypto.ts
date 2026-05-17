/**
 * Token encryption for integrations.
 *
 * Every OAuth access/refresh token we store in public.integrations is
 * encrypted at rest. Anyone with read access to the table (the owner via
 * RLS, or anyone with a DB dump) sees ciphertext, not the live token.
 *
 * Scheme: AES-256-GCM with a 12-byte random IV per encryption. The wire
 * format is base64(iv | authTag | ciphertext) so a single text column
 * holds everything.
 *
 * Key:
 *   INTEGRATION_ENCRYPTION_KEY env var, base64-encoded 32 bytes.
 *   Generate one with:
 *     openssl rand -base64 32
 *
 * Rotation: not supported yet. When we add it, the wire format will gain
 * a one-byte key-version prefix; today's ciphertexts will all decrypt as
 * version 1.
 */

import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

let _cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (_cachedKey) return _cachedKey
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.'
    )
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `INTEGRATION_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length}).`
    )
  }
  _cachedKey = buf
  return buf
}

/** Encrypt a token (or any secret). Returns base64 wire format. */
export function encryptToken(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const ct = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

/** Decrypt a token. Returns null if input is empty; throws if tampered. */
export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null
  const buf = Buffer.from(stored, 'base64')
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('encrypted token too short to be valid')
  }
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ct = buf.subarray(IV_BYTES + TAG_BYTES)
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}
