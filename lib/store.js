/**
 * Durable storage for the experiment ledger.
 *
 * A ledger belongs to a directory: by default `<session cwd>/.experiments`,
 * or an explicit `root`. Everything is plain JSON plus files so a project can
 * be committed to git and read without this plugin. Writes are atomic
 * (temp file + rename) and never rewrite a ledger we could not parse.
 *
 * @module dsh-experiment-ledger/store
 */
import { promises as fsp } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

/** Default ledger directory name inside a project. */
export const LEDGER_DIRNAME = '.experiments'
/** Ledger file name inside the ledger directory. */
export const LEDGER_FILENAME = 'ledger.json'
/** Current on-disk schema version. */
export const LEDGER_VERSION = 1
/** How many recent roots the panel remembers. */
const MAX_ROOTS = 20

/**
 * Locate DSH_HOME without relying on shell-only environment variables.
 * @returns {string} the harness home directory.
 */
export function dshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  if (process.env.DSH_PROFILE_DIR) return dirname(dirname(process.env.DSH_PROFILE_DIR))
  return join(homedir(), '.dsh')
}

/**
 * Resolve the ledger directory for one call.
 * @param {string | undefined} rootArg - explicit ledger directory (absolute or cwd-relative).
 * @param {string | undefined} cwd - session working directory.
 * @returns {string} absolute ledger directory.
 */
export function resolveRoot(rootArg, cwd) {
  const base = typeof cwd === 'string' && cwd.trim() !== '' ? cwd : process.cwd()
  if (typeof rootArg === 'string' && rootArg.trim() !== '') return resolve(base, rootArg.trim())
  return resolve(base, LEDGER_DIRNAME)
}

/**
 * @param {string} root - ledger directory.
 * @returns {string} the ledger file path.
 */
export function ledgerFilePath(root) {
  return join(root, LEDGER_FILENAME)
}

/**
 * Read one ledger. A missing file is an empty ledger; an unreadable or
 * malformed one is an error, so a corrupted project is never overwritten.
 * @param {string} root - ledger directory.
 * @returns {Promise<{version: number, experiments: object[]}>} the ledger.
 */
export async function loadLedger(root) {
  const file = ledgerFilePath(root)
  let text
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { version: LEDGER_VERSION, experiments: [] }
    throw error
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`ledger is not valid JSON: ${file}`)
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.experiments)) {
    throw new Error(`ledger has an unexpected shape: ${file}`)
  }
  return {
    version: LEDGER_VERSION,
    experiments: data.experiments,
    ...(Array.isArray(data.compareReports) ? { compareReports: data.compareReports } : {}),
    ...(Array.isArray(data.notifications) ? { notifications: data.notifications } : {}),
    ...(Array.isArray(data.datasets) ? { datasets: data.datasets } : {}),
  }
}

/**
 * Write one ledger atomically.
 * @param {string} root - ledger directory.
 * @param {{experiments: object[]}} ledger - ledger to persist.
 * @returns {Promise<void>} resolution after the rename.
 */
export async function saveLedger(root, ledger) {
  await fsp.mkdir(root, { recursive: true })
  const file = ledgerFilePath(root)
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`
  const body = JSON.stringify({
    version: LEDGER_VERSION,
    experiments: ledger.experiments,
    ...(Array.isArray(ledger.compareReports) ? { compareReports: ledger.compareReports } : {}),
    ...(Array.isArray(ledger.notifications) ? { notifications: ledger.notifications } : {}),
    ...(Array.isArray(ledger.datasets) ? { datasets: ledger.datasets } : {}),
  }, null, 2)
  await fsp.writeFile(tmp, body, 'utf8')
  await fsp.rename(tmp, file)
}

/**
 * @returns {string} the remembered-roots file path.
 */
export function rootsFilePath() {
  return join(dshHome(), 'experiment-ledger', 'roots.json')
}

/**
 * Read the remembered roots, newest first. A broken file yields an empty list.
 * @returns {Promise<Array<{path: string, lastUsedAt: number}>>} remembered roots.
 */
export async function listRoots() {
  try {
    const text = await fsp.readFile(rootsFilePath(), 'utf8')
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object' || !Array.isArray(data.roots)) return []
    return data.roots.filter((entry) => entry && typeof entry.path === 'string' && entry.path !== '')
  } catch {
    return []
  }
}

/**
 * Remember one ledger directory for the panel's root selector.
 * @param {string} root - absolute ledger directory.
 * @returns {Promise<void>} resolution after the write.
 */
export async function rememberRoot(root) {
  if (typeof root !== 'string' || root === '') return
  const roots = (await listRoots()).filter((entry) => entry.path !== root)
  roots.unshift({ path: root, lastUsedAt: Date.now() })
  const file = rootsFilePath()
  await fsp.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`
  await fsp.writeFile(tmp, JSON.stringify({ version: 1, roots: roots.slice(0, MAX_ROOTS) }, null, 2), 'utf8')
  await fsp.rename(tmp, file)
}
