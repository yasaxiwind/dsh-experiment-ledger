/**
 * Trusted signing keys for share packages. Keys are pinned by id in
 * `$DSH_HOME/experiment-ledger/trusted-keys.json`; the private key never
 * leaves the profile.
 *
 * @module dsh-experiment-ledger/trust
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './data-console.js'

/**
 * @returns {string} trusted-keys file path.
 */
export function trustPath() {
  return join(dshHome(), 'experiment-ledger', 'trusted-keys.json')
}

/**
 * @returns {Array<{keyId: string, publicKey: string, label: string, addedAt: number}>} trusted keys.
 */
export function trustedKeys() {
  const file = trustPath()
  if (!existsSync(file)) return []
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(state.keys)
      ? state.keys.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.keyId === 'string')
      : []
  } catch {
    return []
  }
}

/**
 * @param {string} keyId - key id.
 * @returns {boolean} whether the key is pinned.
 */
export function isTrustedKey(keyId) {
  return trustedKeys().some((entry) => entry.keyId === keyId)
}

/**
 * Add or update a trusted key.
 * @param {{keyId: string, publicKey: string, label?: string}} entry - key.
 * @returns {object} stored entry.
 */
export function trustKey(entry) {
  const keys = trustedKeys()
  const previous = keys.find((item) => item.keyId === entry.keyId)
  const stored = {
    keyId: entry.keyId,
    publicKey: entry.publicKey,
    label: typeof entry.label === 'string' && entry.label !== '' ? entry.label : (previous?.label ?? entry.keyId),
    addedAt: previous?.addedAt ?? Date.now(),
    ...(typeof entry.expiresAt === 'number' ? { expiresAt: entry.expiresAt } : (previous?.expiresAt ? { expiresAt: previous.expiresAt } : {})),
    ...(entry.rotatedFrom !== undefined ? { rotatedFrom: entry.rotatedFrom } : (previous?.rotatedFrom ? { rotatedFrom: previous.rotatedFrom } : {})),
    ...(previous?.revokedAt ? { revokedAt: previous.revokedAt } : {}),
  }
  const index = keys.findIndex((item) => item.keyId === entry.keyId)
  if (index >= 0) keys[index] = stored
  else keys.push(stored)
  const file = trustPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ keys: keys.slice(-100) }, null, 2), 'utf8')
  return stored
}

/**
 * Revoke a key without deleting its history.
 * @param {string} keyId - key id.
 * @returns {object|null} updated entry.
 */
export function revokeKey(keyId) {
  const keys = trustedKeys()
  const entry = keys.find((item) => item.keyId === keyId)
  if (entry === undefined) return null
  entry.revokedAt = Date.now()
  const file = trustPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ keys }, null, 2), 'utf8')
  return entry
}

/**
 * Evaluate trust at the package's signing time.
 * @param {string} keyId - key id.
 * @param {number} signedAt - signature timestamp.
 * @returns {{trusted: boolean, reason: string, entry: object|null}} trust decision.
 */
export function trustStatus(keyId, signedAt) {
  const entry = trustedKeys().find((item) => item.keyId === keyId)
  if (entry === undefined) return { trusted: false, reason: 'untrusted', entry: null }
  const at = typeof signedAt === 'number' ? signedAt : Date.now()
  if (typeof entry.expiresAt === 'number' && at > entry.expiresAt) return { trusted: false, reason: 'expired', entry }
  if (typeof entry.revokedAt === 'number' && at > entry.revokedAt) return { trusted: false, reason: 'revoked', entry }
  return { trusted: true, reason: entry.revokedAt ? 'signed-before-revocation' : 'trusted', entry }
}

/**
 * Remove a trusted key.
 * @param {string} keyId - key id.
 * @returns {boolean} whether it was removed.
 */
export function removeTrustedKey(keyId) {
  const keys = trustedKeys()
  const next = keys.filter((entry) => entry.keyId !== keyId)
  if (next.length === keys.length) return false
  const file = trustPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ keys: next }, null, 2), 'utf8')
  return true
}
