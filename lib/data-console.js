/**
 * Live link to the DSH data console's open/recent files. The data console's
 * own dataset ids (`ds1`) are per-process; the files it holds are stable, so a
 * metric can name one and the ledger resolves it at run time.
 *
 * @module dsh-experiment-ledger/data-console
 */
import { readFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * @returns {string} DSH home directory.
 */
export function dshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  if (process.env.DSH_PROFILE_DIR) return dirname(dirname(process.env.DSH_PROFILE_DIR))
  return join(homedir(), '.dsh')
}

/**
 * Read the data console's open/recent file list.
 * @returns {Array<{path: string, name: string, open: boolean}>} existing files, de-duplicated.
 */
export function dataConsoleDatasets() {
  const file = join(dshHome(), 'data-console', 'datasets.json')
  if (!existsSync(file)) return []
  let state
  try {
    state = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  const entries = []
  for (const entry of Array.isArray(state.open) ? state.open : []) {
    if (entry !== null && typeof entry === 'object' && typeof entry.path === 'string' && entry.path !== '') {
      entries.push({ path: entry.path, name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : basename(entry.path), open: true })
    }
  }
  for (const entry of Array.isArray(state.recent) ? state.recent : []) {
    if (entry !== null && typeof entry === 'object' && typeof entry.path === 'string' && entry.path !== '') {
      entries.push({ path: entry.path, name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : basename(entry.path), open: false })
    }
  }
  const seen = new Set()
  return entries.filter((entry) => {
    if (seen.has(entry.path) || !existsSync(entry.path)) return false
    seen.add(entry.path)
    return true
  })
}

/**
 * Resolve one file name/path against the data console's state.
 * @param {string} name - file name, relative name or absolute path.
 * @returns {string} absolute path.
 */
export function resolveDataConsolePath(name) {
  const wanted = String(name ?? '').trim()
  if (wanted === '') throw new Error('dataConsole name is empty')
  const datasets = dataConsoleDatasets()
  const matches = datasets.filter((entry) => entry.path === wanted || entry.name === wanted || basename(entry.path) === wanted)
  if (matches.length === 1) return matches[0].path
  if (matches.length > 1) {
    throw new Error(`data-console name is ambiguous: ${wanted} (${matches.map((entry) => entry.path).join(', ')})`)
  }
  const available = datasets.map((entry) => entry.name).join(', ')
  throw new Error(`data-console dataset not found: ${wanted}${available === '' ? ' (the data console has no open/recent files)' : ` (available: ${available})`}`)
}
