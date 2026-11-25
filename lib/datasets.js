/**
 * Dataset provenance for experiment runs.
 *
 * A run may reference one or more data files. The ledger stores their identity
 * (path, SHA-256, size) and, for plain-text tables, an approximate row/column
 * count so a later reader can tell whether the input changed. Parsing Excel or
 * computing statistics is deliberately left to the data console and the agent.
 *
 * @module dsh-experiment-ledger/datasets
 */
import { createReadStream, promises as fsp } from 'node:fs'
import { extname, isAbsolute, resolve } from 'node:path'
import { hashFile } from './runner.js'

/** Text tables whose row/column count is cheap enough to compute. */
const TEXT_TABLES = new Set(['.csv', '.tsv', '.txt'])
/** Files larger than this are hashed but not counted. */
const MAX_COUNT_BYTES = 200 * 1024 * 1024
/** Row counting stops here and marks the record truncated. */
const MAX_COUNT_ROWS = 5_000_000
/** How much of the head is kept for the header line. */
const HEAD_BYTES = 64 * 1024

/**
 * @param {string} extension - lower-case extension.
 * @returns {string} a short kind label.
 */
function kindOf(extension) {
  switch (extension) {
    case '.csv': return 'csv'
    case '.tsv': return 'tsv'
    case '.txt': return 'text'
    case '.xlsx':
    case '.xlsm':
    case '.xls': return 'excel'
    case '.json': return 'json'
    case '.parquet': return 'parquet'
    default: return extension.replace(/^\./, '') || 'file'
  }
}

/**
 * Count lines and the header width of a delimited text file without loading it.
 * @param {string} file - file path.
 * @param {string} extension - lower-case extension.
 * @returns {Promise<{rows: number, cols: number, columnsApprox?: boolean, truncated?: boolean}>} table facts.
 */
async function countTextTable(file, extension) {
  const delimiter = extension === '.tsv' ? '\t' : extension === '.csv' ? ',' : null
  let head = ''
  let newlines = 0
  let lastByte = 0
  let bytes = 0
  let truncated = false
  const stream = createReadStream(file, { highWaterMark: 256 * 1024 })
  for await (const chunk of stream) {
    bytes += chunk.length
    if (head.length < HEAD_BYTES) head += chunk.toString('utf8', 0, Math.min(chunk.length, HEAD_BYTES - head.length))
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] === 10) newlines += 1
      lastByte = chunk[index]
    }
    if (bytes > MAX_COUNT_BYTES || newlines > MAX_COUNT_ROWS) {
      truncated = true
      stream.destroy()
      break
    }
  }
  const lines = newlines + (lastByte !== 0 && lastByte !== 10 ? 1 : 0)
  const header = (head.split(/\r?\n/)[0] ?? '').trim()
  let cols = 0
  let columnsApprox = false
  if (header !== '') {
    if (delimiter === null) {
      cols = 0
    } else if (header.includes('"')) {
      columnsApprox = true
      cols = header.split(delimiter).length
    } else {
      cols = header.split(delimiter).length
    }
  }
  const record = { rows: Math.max(0, lines - 1), cols }
  if (columnsApprox) record.columnsApprox = true
  if (truncated) record.truncated = true
  return record
}

/**
 * Describe one dataset reference.
 * @param {string | {path: string, note?: string}} input - path or object.
 * @param {string} cwd - base directory for relative paths.
 * @returns {Promise<object>} the dataset record.
 */
export async function describeDataset(input, cwd) {
  const raw = typeof input === 'string' ? { path: input } : input
  if (raw === null || typeof raw !== 'object' || typeof raw.path !== 'string' || raw.path.trim() === '') {
    throw new Error('each dataset must be a path or {path, note?}')
  }
  const file = isAbsolute(raw.path) ? raw.path : resolve(cwd, raw.path)
  const stat = await fsp.stat(file)
  if (!stat.isFile()) throw new Error(`dataset is not a file: ${file}`)
  const digest = await hashFile(file)
  const extension = extname(file).toLowerCase()
  const record = {
    path: file,
    sha256: digest.sha256,
    bytes: digest.bytes,
    mtimeMs: stat.mtimeMs,
    kind: kindOf(extension),
  }
  if (typeof raw.note === 'string' && raw.note.trim() !== '') record.note = raw.note.trim().slice(0, 200)
  if (TEXT_TABLES.has(extension)) {
    try {
      Object.assign(record, await countTextTable(file, extension))
    } catch {
      record.countError = true
    }
  }
  return record
}

/**
 * Describe every declared dataset, de-duplicated by path.
 * @param {unknown} value - `string[]` or `{path, note?}[]`.
 * @param {string} cwd - base directory for relative paths.
 * @returns {Promise<object[]>} dataset records.
 */
export async function collectDatasets(value, cwd) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('datasets must be an array of paths')
  const records = []
  const seen = new Set()
  for (const entry of value) {
    const record = await describeDataset(entry, cwd)
    if (seen.has(record.path)) continue
    seen.add(record.path)
    records.push(record)
    if (records.length > 20) throw new Error('at most 20 datasets per run')
  }
  return records
}
