/**
 * Append-only, hash-chained audit log for review, import/export and key
 * lifecycle events. Each entry hashes its canonical body plus the previous
 * entry's hash, so edits or deletions break verification.
 *
 * @module dsh-experiment-ledger/audit
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './data-console.js'

/**
 * @returns {string} audit log path.
 */
export function auditPath() {
  return join(dshHome(), 'experiment-ledger', 'audit.ndjson')
}

/**
 * @returns {Array<object>} every audit entry in order.
 */
export function auditEntries() {
  const file = auditPath()
  if (!existsSync(file)) return []
  return parseAuditLines(readFileSync(file, 'utf8'))
}

/**
 * Parse newline-delimited audit entries.
 * @param {string} text - NDJSON text.
 * @returns {Array<object>} valid entries.
 */
export function parseAuditLines(text) {
  const entries = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      const entry = JSON.parse(line)
      if (entry !== null && typeof entry === 'object' && typeof entry.hash === 'string') entries.push(entry)
    } catch {
      // keep parsing; verification reports the broken line via the chain
    }
  }
  return entries
}

/**
 * @returns {{headHash: string, count: number, at: number}} current audit anchor.
 */
export function auditAnchor() {
  const entries = auditEntries()
  return {
    headHash: entries.length > 0 ? entries[entries.length - 1].hash : 'genesis',
    count: entries.length,
    at: Date.now(),
  }
}

/**
 * Append one event to the hash chain.
 * @param {{action: string, actor?: string|null, detail?: object}} event - audit event.
 * @returns {object} the written entry.
 */
export function appendAudit(event) {
  const file = auditPath()
  const entries = auditEntries()
  const prevHash = entries.length > 0 ? entries[entries.length - 1].hash : 'genesis'
  const body = {
    at: Date.now(),
    action: event.action,
    actor: event.actor ?? null,
    detail: event.detail ?? null,
    prevHash,
  }
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const entry = { ...body, hash }
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
  return entry
}

/**
 * Verify an in-memory audit chain.
 * @param {Array<object>} entries - audit entries.
 * @returns {{ok: boolean, count: number, brokenAt: number|null}} verification result.
 */
export function verifyAuditEntries(entries) {
  let prevHash = 'genesis'
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const body = { at: entry.at, action: entry.action, actor: entry.actor ?? null, detail: entry.detail ?? null, prevHash }
    const expected = createHash('sha256').update(JSON.stringify(body)).digest('hex')
    if (entry.prevHash !== prevHash || entry.hash !== expected) return { ok: false, count: entries.length, brokenAt: index }
    prevHash = entry.hash
  }
  return { ok: true, count: entries.length, brokenAt: null }
}

/**
 * Verify the hash chain.
 * @returns {{ok: boolean, count: number, brokenAt: number|null}} verification result.
 */
export function verifyAudit() {
  return verifyAuditEntries(auditEntries())
}
