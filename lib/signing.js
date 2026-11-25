/**
 * Local Ed25519 signing for share packages. The key pair lives under
 * `$DSH_HOME/experiment-ledger/keys/ed25519.json`; the manifest carries the
 * public key, key id and signature over `ledger.json`. This proves integrity
 * and key continuity, not a trusted third-party identity.
 *
 * @module dsh-experiment-ledger/signing
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './data-console.js'

/**
 * @returns {string} key file path.
 */
export function signingKeyPath() {
  return join(dshHome(), 'experiment-ledger', 'keys', 'ed25519.json')
}

/**
 * Load or create the profile signing key.
 * @returns {{privateKey: string, publicKey: string}} PEM pair.
 */
export function signingKey() {
  const file = signingKeyPath()
  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof stored.privateKey === 'string' && typeof stored.publicKey === 'string') return stored
    } catch {
      // regenerate a corrupt key file
    }
  }
  const pair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ privateKey: pair.privateKey, publicKey: pair.publicKey }, null, 2), { mode: 0o600 })
  return pair
}

/**
 * @param {string} publicKey - PEM public key.
 * @returns {string} short fingerprint.
 */
export function keyId(publicKey) {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 16)
}

/**
 * Sign a buffer with the local key.
 * @param {Buffer} bytes - bytes to sign.
 * @param {{signer?: string}} options - optional signer label.
 * @returns {{algorithm: string, keyId: string, publicKey: string, signer: string|null, signature: string}} signature block.
 */
export function signBytes(bytes, options = {}) {
  const pair = signingKey()
  return {
    algorithm: 'ed25519',
    keyId: keyId(pair.publicKey),
    publicKey: pair.publicKey,
    signer: typeof options.signer === 'string' && options.signer !== '' ? options.signer : null,
    signedAt: Date.now(),
    signature: sign(null, bytes, createPrivateKey(pair.privateKey)).toString('base64'),
  }
}

/**
 * Generate a new key pair and archive the current one.
 * @returns {{oldKeyId: string|null, newKeyId: string, publicKey: string}} rotation result.
 */
export function rotateSigningKey() {
  const file = signingKeyPath()
  let oldKeyId = null
  if (existsSync(file)) {
    try {
      const current = signingKey()
      oldKeyId = keyId(current.publicKey)
      const archive = join(dirname(file), `archive-${oldKeyId}.json`)
      writeFileSync(archive, JSON.stringify(current, null, 2), { mode: 0o600 })
    } catch {
      // rotate over a corrupt key file
    }
  }
  const pair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ privateKey: pair.privateKey, publicKey: pair.publicKey }, null, 2), { mode: 0o600 })
  return { oldKeyId, newKeyId: keyId(pair.publicKey), publicKey: pair.publicKey }
}

/**
 * Verify a signature block over bytes.
 * @param {Buffer} bytes - signed bytes.
 * @param {object} block - manifest signature block.
 * @returns {boolean} whether the signature matches.
 */
export function verifyBytes(bytes, block) {
  if (block === null || typeof block !== 'object') return false
  if (block.algorithm !== 'ed25519' || typeof block.publicKey !== 'string' || typeof block.signature !== 'string') return false
  try {
    return verify(null, bytes, createPublicKey(block.publicKey), Buffer.from(block.signature, 'base64'))
  } catch {
    return false
  }
}
