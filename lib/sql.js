/**
 * SQL metrics over delimited datasets.
 *
 * An experiment metric may declare `sql`, `dataset` and an optional `column`.
 * The dataset is loaded into an in-memory SQLite table named `data` and the
 * query's first row supplies the value. Only CSV/TSV is supported here; Excel
 * and interactive exploration stay with the data console, which can export a
 * CSV for the ledger.
 *
 * @module dsh-experiment-ledger/sql
 */
import { readFileSync, statSync, existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { loadLedger } from './store.js'
import { resolveDataConsolePath } from './data-console.js'

/** Largest dataset the SQL loader will read. */
const MAX_BYTES = 50 * 1024 * 1024
/** Largest row count the SQL loader will insert. */
const MAX_ROWS = 500_000

/**
 * Parse a delimited text file with quoted fields.
 * @param {string} text - file contents.
 * @param {string} delimiter - field delimiter.
 * @returns {string[][]} rows of raw fields.
 */
export function parseDelimited(text, delimiter = ',') {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === delimiter) {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (character !== '\r') {
      field += character
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * @param {string} header - raw column name.
 * @param {number} index - column position.
 * @param {Set<string>} used - names already taken.
 * @returns {string} a safe unique SQLite column name.
 */
function safeColumn(header, index, used) {
  let name = String(header ?? '').trim().replace(/[^A-Za-z0-9_]+/g, '_')
  if (name === '') name = `col_${index + 1}`
  if (/^[0-9]/.test(name)) name = `c_${name}`
  let unique = name
  let suffix = 2
  while (used.has(unique)) {
    unique = `${name}_${suffix}`
    suffix += 1
  }
  used.add(unique)
  return unique
}

/**
 * @param {string} raw - raw cell.
 * @returns {string | number | null} the typed cell.
 */
function cellValue(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return null
  const number = Number(text)
  return Number.isFinite(number) ? number : text
}

/**
 * Open a dataset as an in-memory database with one `data` table.
 * @param {string} file - CSV/TSV path.
 * @param {string} kind - file extension, used for the delimiter.
 * @returns {{db: DatabaseSync, columns: string[], rows: number}} the loaded database.
 */
export function openDatasetDb(file, kind) {
  const stat = statSync(file)
  if (stat.size > MAX_BYTES) throw new Error(`dataset is larger than ${MAX_BYTES / 1024 / 1024} MB: ${file}`)
  const text = readFileSync(file, 'utf8')
  const delimiter = kind === 'tsv' || file.endsWith('.tsv') ? '\t' : ','
  const rows = parseDelimited(text, delimiter)
  if (rows.length === 0) throw new Error(`dataset is empty: ${file}`)
  const used = new Set()
  const header = rows[0]
  const columns = header.map((cell, index) => safeColumn(cell, index, used))
  if (columns.length === 0) throw new Error(`dataset has no columns: ${file}`)
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => String(cell).trim() !== ''))
  if (dataRows.length > MAX_ROWS) throw new Error(`dataset has more than ${MAX_ROWS} rows: ${file}`)

  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE data (${columns.map((column) => `"${column}"`).join(', ')})`)
  const placeholders = columns.map(() => '?').join(', ')
  const insert = db.prepare(`INSERT INTO data VALUES (${placeholders})`)
  db.exec('BEGIN')
  try {
    for (const row of dataRows) {
      insert.run(...columns.map((_, index) => cellValue(row[index])))
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    db.close()
    throw error
  }
  db.exec('PRAGMA query_only = ON')
  return { db, columns, rows: dataRows.length }
}

/**
 * Resolve a metric's dataset declaration.
 * @param {string} path - declared path.
 * @param {string} cwd - session directory.
 * @param {string} root - ledger directory.
 * @returns {string} the first existing candidate, or the cwd-relative path.
 */
export function resolveDataset(path, cwd, root) {
  if (isAbsolute(path)) return path
  const candidates = [resolve(cwd, path), resolve(root, path)]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return candidates[0]
}

/**
 * @param {string} file - dataset path.
 * @returns {'csv' | 'tsv' | 'other'} the loader kind.
 */
function kindOf(file) {
  const lower = file.toLowerCase()
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.tsv')) return 'tsv'
  return 'other'
}

/**
 * Execute a metric's query and return its scalar value.
 * @param {DatabaseSync} db - loaded database.
 * @param {object} metric - metric definition with `sql`.
 * @returns {string | number} the value.
 */
function queryMetric(db, metric) {
  const statement = db.prepare(metric.sql)
  const row = statement.get()
  if (row === undefined || row === null) throw new Error(`query returned no row: ${metric.key}`)
  const values = Object.values(row)
  const raw = metric.column !== undefined && row[metric.column] !== undefined ? row[metric.column] : values[0]
  if (raw === null || raw === undefined) throw new Error(`query returned no value: ${metric.key}`)
  if (typeof raw === 'number') return raw
  const text = String(raw).trim()
  const number = Number(text)
  return Number.isFinite(number) && text !== '' ? number : text
}

/**
 * Compute every SQL metric declared by an experiment.
 * @param {object} experiment - ledger experiment.
 * @param {{cwd: string, root: string}} context - resolution roots.
 * @returns {Promise<{values: Record<string, string | number>, errors: Array<{key: string, error: string}>, datasets: string[]}>} the result.
 */
export async function computeSqlMetrics(experiment, context) {
  const defs = (Array.isArray(experiment.metrics) ? experiment.metrics : [])
    .filter((metric) => typeof metric.sql === 'string' && metric.sql !== '')
  const values = {}
  const errors = []
  const datasets = []
  if (defs.length === 0) return { values, errors, datasets }

  const ledger = context.ledger ?? await loadLedger(context.root)
  const registry = new Map(
    (Array.isArray(ledger.datasets) ? ledger.datasets : []).map((record) => [record.id, record]),
  )
  const groups = new Map()
  for (const metric of defs) {
    let declared = metric.dataset
    if (typeof metric.datasetId === 'string' && metric.datasetId !== '') {
      const record = registry.get(metric.datasetId)
      if (record === undefined) {
        errors.push({ key: metric.key, error: `dataset id not found: ${metric.datasetId}` })
        continue
      }
      declared = record.path
    }
    if (typeof metric.dataConsole === 'string' && metric.dataConsole !== '') {
      try {
        declared = resolveDataConsolePath(metric.dataConsole)
      } catch (error) {
        errors.push({ key: metric.key, error: error instanceof Error ? error.message : String(error) })
        continue
      }
    }
    if (typeof declared !== 'string' || declared === '') {
      errors.push({ key: metric.key, error: 'dataset, datasetId or dataConsole is required' })
      continue
    }
    const file = resolveDataset(declared, context.cwd, context.root)
    const list = groups.get(file) ?? []
    list.push(metric)
    groups.set(file, list)
  }

  for (const [file, metrics] of groups) {
    const kind = kindOf(file)
    if (kind === 'other') {
      for (const metric of metrics) errors.push({ key: metric.key, error: `SQL metrics need a CSV/TSV dataset, got ${file}` })
      continue
    }
    if (!existsSync(file)) {
      for (const metric of metrics) errors.push({ key: metric.key, error: `dataset not found: ${file}` })
      continue
    }
    let opened
    try {
      opened = openDatasetDb(file, kind)
      datasets.push(file)
      for (const metric of metrics) {
        try {
          values[metric.key] = queryMetric(opened.db, metric)
        } catch (error) {
          errors.push({ key: metric.key, error: `${file}: ${error instanceof Error ? error.message : String(error)}` })
        }
      }
    } catch (error) {
      for (const metric of metrics) errors.push({ key: metric.key, error: `${file}: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      opened?.db.close()
    }
  }
  return { values, errors, datasets }
}
