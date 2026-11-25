/**
 * External audit anchors: the current audit head/count is written to a local
 * registry and, optionally, to an external file, git commit or HTTP endpoint.
 * Anchors let a later verifier detect a fully rewritten chain.
 *
 * @module dsh-experiment-ledger/anchors
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './data-console.js'

/**
 * @returns {string} local anchors file path.
 */
export function anchorsPath() {
  return join(dshHome(), 'experiment-ledger', 'anchors.ndjson')
}

/**
 * @returns {Array<object>} local anchor records.
 */
export function listAnchors() {
  const file = anchorsPath()
  if (!existsSync(file)) return []
  const entries = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      const entry = JSON.parse(line)
      if (entry !== null && typeof entry === 'object' && typeof entry.headHash === 'string') entries.push(entry)
    } catch {
      // ignore corrupt lines
    }
  }
  return entries
}

/**
 * Append one anchor record.
 * @param {{headHash: string, count: number, mode: string, ref?: string|null, note?: string|null}} anchor - anchor.
 * @returns {object} written record.
 */
export function appendAnchor(anchor) {
  const record = {
    at: Date.now(),
    headHash: anchor.headHash,
    count: anchor.count,
    mode: anchor.mode,
    ref: anchor.ref ?? null,
    note: anchor.note ?? null,
  }
  const file = anchorsPath()
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
  return record
}

/**
 * Verify every anchor against the current audit entries.
 * @param {Array<object>} auditEntries - current chain.
 * @returns {{total: number, valid: number, broken: Array<object>}} verification summary.
 */
export function verifyAnchors(auditEntries) {
  const anchors = listAnchors()
  const broken = []
  for (const anchor of anchors) {
    const entry = auditEntries[anchor.count - 1]
    if (entry === undefined || entry.hash !== anchor.headHash) broken.push(anchor)
  }
  return { total: anchors.length, valid: anchors.length - broken.length, broken }
}
