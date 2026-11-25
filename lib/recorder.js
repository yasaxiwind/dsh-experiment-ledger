/**
 * Passive run candidates.
 *
 * The recorder observes tool results and keeps a small local list of commands
 * that ran, so an experiment can adopt a command after the fact instead of
 * asking the agent to run it again. Only the tool name, command, working
 * directory, status and duration are stored — no environment, no output.
 *
 * @module dsh-experiment-ledger/recorder
 */
import { promises as fsp } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { dshHome } from './store.js'

/** How many candidates the ring buffer keeps. */
const MAX_CANDIDATES = 50

/**
 * @returns {string} the candidate store path.
 */
export function candidatesPath() {
  return join(dshHome(), 'experiment-ledger', 'candidates.json')
}

/**
 * @returns {Promise<object[]>} newest-first candidates, or an empty list.
 */
export async function loadCandidates() {
  try {
    const text = await fsp.readFile(candidatesPath(), 'utf8')
    const data = JSON.parse(text)
    if (data === null || typeof data !== 'object' || !Array.isArray(data.candidates)) return []
    return data.candidates.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
  } catch {
    return []
  }
}

/**
 * @param {object[]} candidates - candidates to persist.
 * @returns {Promise<void>} resolution after the rename.
 */
export async function saveCandidates(candidates) {
  const file = candidatesPath()
  await fsp.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`
  await fsp.writeFile(tmp, JSON.stringify({ version: 1, candidates: candidates.slice(0, MAX_CANDIDATES) }, null, 2), 'utf8')
  await fsp.rename(tmp, file)
}

/**
 * Record one candidate at the head of the ring buffer.
 * @param {{tool: string, command: string, cwd?: string, status?: string, durationMs?: number, at?: number, sessionId?: string}} input - observed call.
 * @returns {Promise<object>} the stored candidate.
 */
export async function recordCandidate(input) {
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  if (command === '') throw new Error('candidate command is empty')
  const candidate = {
    id: `cand-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`,
    tool: typeof input.tool === 'string' && input.tool !== '' ? input.tool : 'tool',
    command: command.slice(0, 2000),
    cwd: typeof input.cwd === 'string' ? input.cwd : '',
    status: input.status === 'failed' ? 'failed' : 'ok',
    durationMs: typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : 0,
    at: typeof input.at === 'number' ? input.at : Date.now(),
  }
  if (typeof input.sessionId === 'string' && input.sessionId !== '') candidate.sessionId = input.sessionId
  const candidates = await loadCandidates()
  candidates.unshift(candidate)
  await saveCandidates(candidates)
  return candidate
}

/**
 * @param {number} limit - maximum rows.
 * @returns {Promise<object[]>} newest-first candidates.
 */
export async function listCandidates(limit = 20) {
  const candidates = await loadCandidates()
  return candidates.slice(0, Math.max(1, Math.min(limit, MAX_CANDIDATES)))
}

/**
 * @param {string} id - candidate id.
 * @returns {Promise<object | undefined>} the candidate, without removing it.
 */
export async function findCandidate(id) {
  const candidates = await loadCandidates()
  return candidates.find((entry) => entry.id === id)
}

/**
 * Remove one candidate after it has been promoted.
 * @param {string} id - candidate id.
 * @returns {Promise<boolean>} whether a row was removed.
 */
export async function removeCandidate(id) {
  const candidates = await loadCandidates()
  const next = candidates.filter((entry) => entry.id !== id)
  if (next.length === candidates.length) return false
  await saveCandidates(next)
  return true
}
