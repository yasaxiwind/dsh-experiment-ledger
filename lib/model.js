/**
 * Experiment-ledger data rules: identifiers, validation, metric parsing and
 * the bounded text forms the model reads back.
 *
 * The ledger is intentionally plain: factors and metrics are declared once per
 * experiment, while every run stores a flat parameter object and a flat metric
 * object. Nothing here executes anything.
 *
 * @module dsh-experiment-ledger/model
 */
import { randomBytes } from 'node:crypto'

/** Parameter and metric keys accepted by the ledger. */
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
/** Recognised metric directions. */
const DIRECTIONS = new Set(['min', 'max', 'none'])
/** Metric/parameter ceilings keep one record bounded. */
const MAX_ENTRIES = 64

/**
 * @param {string} prefix - id prefix (`exp` or `run`).
 * @returns {string} a time-ordered unique id.
 */
export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`
}

/**
 * @param {unknown} value - candidate key.
 * @returns {string} the normalized key.
 */
export function normalizeKey(value) {
  if (typeof value !== 'string') throw new Error('key must be a string')
  const key = value.trim()
  if (!KEY_RE.test(key)) {
    throw new Error(`invalid key "${key}": use letters, digits, dot, dash or underscore, starting with a letter`)
  }
  return key
}

/**
 * @param {unknown} value - declared label.
 * @param {string} key - fallback label.
 * @returns {string} the display label.
 */
function labelOf(value, key) {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return key
}

/**
 * Normalize an experiment's factor declarations.
 * @param {unknown} value - `string[]` or `{key,label?,unit?}[]`.
 * @returns {Array<{key: string, label: string, unit?: string}>} factors.
 */
export function normalizeFactors(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('factors must be an array')
  const factors = []
  for (const entry of value) {
    const item = typeof entry === 'string' ? { key: entry } : entry
    if (item === null || typeof item !== 'object') throw new Error('each factor must be a string or an object')
    const key = normalizeKey(item.key)
    if (factors.some((factor) => factor.key === key)) continue
    const factor = { key, label: labelOf(item.label, key) }
    if (typeof item.unit === 'string' && item.unit.trim() !== '') factor.unit = item.unit.trim()
    factors.push(factor)
    if (factors.length > 32) throw new Error('at most 32 factors per experiment')
  }
  return factors
}

/**
 * Normalize an experiment's metric declarations.
 * @param {unknown} value - `string[]` or `{key,label?,unit?,direction?}[]`.
 * @returns {Array<{key: string, label: string, unit?: string, direction: string}>} metrics.
 */
export function normalizeMetricDefs(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('metrics must be an array')
  const metrics = []
  for (const entry of value) {
    const item = typeof entry === 'string' ? { key: entry } : entry
    if (item === null || typeof item !== 'object') throw new Error('each metric must be a string or an object')
    const key = normalizeKey(item.key)
    if (metrics.some((metric) => metric.key === key)) continue
    const direction = typeof item.direction === 'string' ? item.direction.toLowerCase() : 'none'
    if (!DIRECTIONS.has(direction)) throw new Error(`invalid metric direction "${item.direction}": use min, max or none`)
    const metric = { key, label: labelOf(item.label, key), direction }
    if (typeof item.unit === 'string' && item.unit.trim() !== '') metric.unit = item.unit.trim()
    if (typeof item.sql === 'string' && item.sql.trim() !== '') {
      const datasetPath = typeof item.dataset === 'string' && item.dataset.trim() !== '' ? item.dataset.trim() : null
      const datasetId = typeof item.datasetId === 'string' && item.datasetId.trim() !== '' ? item.datasetId.trim() : null
      const dataConsole = typeof item.dataConsole === 'string' && item.dataConsole.trim() !== '' ? item.dataConsole.trim() : null
      const declared = [datasetPath, datasetId, dataConsole].filter((value) => value !== null)
      if (declared.length === 0) {
        throw new Error(`metric "${key}" with sql needs a dataset path, datasetId or dataConsole name`)
      }
      if (declared.length > 1) {
        throw new Error(`metric "${key}" must declare only one of dataset, datasetId or dataConsole`)
      }
      if (datasetId !== null && !/^[A-Za-z0-9._-]{1,100}$/.test(datasetId)) {
        throw new Error(`metric "${key}" has an invalid datasetId`)
      }
      const sql = item.sql.trim().replace(/;\s*$/, '')
      if (sql.includes(';')) throw new Error(`metric "${key}" sql must be a single statement`)
      metric.sql = sql
      if (datasetPath !== null) metric.dataset = datasetPath
      if (datasetId !== null) metric.datasetId = datasetId
      if (dataConsole !== null) metric.dataConsole = dataConsole
      if (typeof item.column === 'string' && item.column.trim() !== '') metric.column = item.column.trim()
    } else if (
      (typeof item.dataset === 'string' && item.dataset.trim() !== '')
      || (typeof item.datasetId === 'string' && item.datasetId.trim() !== '')
      || (typeof item.dataConsole === 'string' && item.dataConsole.trim() !== '')
    ) {
      throw new Error(`metric "${key}" declares a dataset but no sql`)
    }
    metrics.push(metric)
    if (metrics.length > 32) throw new Error('at most 32 metrics per experiment')
  }
  return metrics
}

/**
 * Normalize one run's parameter object.
 * @param {unknown} value - untrusted `params`.
 * @returns {Record<string, string | number | boolean>} the parameters.
 */
export function normalizeParams(value) {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('params must be an object')
  const params = {}
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeKey(rawKey)
    if (rawValue === null || rawValue === undefined) continue
    if (!['string', 'number', 'boolean'].includes(typeof rawValue)) {
      throw new Error(`param "${key}" must be a string, number or boolean`)
    }
    params[key] = rawValue
    if (Object.keys(params).length > MAX_ENTRIES) throw new Error(`at most ${MAX_ENTRIES} params per run`)
  }
  return params
}

/**
 * Normalize one run's metric values.
 * @param {unknown} value - untrusted `metrics`.
 * @returns {Record<string, string | number>} the metric values.
 */
export function normalizeMetrics(value) {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('metrics must be an object')
  const metrics = {}
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeKey(rawKey)
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      metrics[key] = rawValue
    } else if (typeof rawValue === 'string' && rawValue.trim() !== '') {
      metrics[key] = rawValue.trim()
    } else {
      throw new Error(`metric "${key}" must be a finite number or a non-empty string`)
    }
    if (Object.keys(metrics).length > MAX_ENTRIES) throw new Error(`at most ${MAX_ENTRIES} metrics per run`)
  }
  return metrics
}

/**
 * Parse metric lines printed by a command:
 *
 *     EXP_METRICS: {"overshoot": 4.2, "settling": 0.8}
 *
 * Later lines win, so a script can print intermediate values and a final one.
 * @param {string} text - captured stdout tail.
 * @returns {Record<string, string | number>} parsed metric values.
 */
export function parseMetricsText(text) {
  if (typeof text !== 'string' || text === '') return {}
  const metrics = {}
  const pattern = /^[ \t]*EXP_METRICS[ \t]*:?[ \t]*(\{.*\})[ \t]*$/gm
  let match
  while ((match = pattern.exec(text)) !== null) {
    let parsed
    try {
      parsed = JSON.parse(match[1])
    } catch {
      continue
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      let key
      try {
        key = normalizeKey(rawKey)
      } catch {
        continue
      }
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) metrics[key] = rawValue
      else if (typeof rawValue === 'string' && rawValue.trim() !== '') metrics[key] = rawValue.trim()
    }
  }
  return metrics
}

/**
 * Merge metric objects, later sources winning.
 * @param {...Record<string, string | number>} sources - metric objects.
 * @returns {Record<string, string | number>} the merged object.
 */
export function mergeMetrics(...sources) {
  const merged = {}
  for (const source of sources) Object.assign(merged, source ?? {})
  return merged
}

/**
 * @param {number} ms - duration in milliseconds.
 * @returns {string} a compact duration.
 */
export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

/**
 * @param {unknown} value - metric or param value.
 * @returns {string} a compact display form.
 */
export function formatValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    if (Number.isInteger(value)) return String(value)
    return String(Math.round(value * 1000) / 1000)
  }
  return String(value)
}

/**
 * @param {object} experiment - one experiment.
 * @returns {object} the row the panel and `exp_list` render.
 */
export function summarizeExperiment(experiment) {
  const runs = Array.isArray(experiment.runs) ? experiment.runs : []
  const last = runs.length === 0 ? null : runs[runs.length - 1]
  return {
    id: experiment.id,
    name: experiment.name,
    description: experiment.description ?? '',
    runs: runs.length,
    lastStatus: last === null ? '' : last.status,
    lastRunAt: last === null ? 0 : last.startedAt ?? 0,
    updatedAt: experiment.updatedAt ?? 0,
    factors: Array.isArray(experiment.factors) ? experiment.factors.length : 0,
    metrics: Array.isArray(experiment.metrics) ? experiment.metrics.length : 0,
  }
}

/**
 * @param {object[]} runs - experiment runs.
 * @returns {string[]} metric keys seen across runs, in first-seen order.
 */
export function metricKeysOf(runs) {
  const keys = []
  for (const run of runs) {
    for (const key of Object.keys(run.metrics ?? {})) if (!keys.includes(key)) keys.push(key)
  }
  return keys
}

/**
 * @param {object} experiment - one experiment.
 * @returns {object[]} its baselines, including a legacy single `baseline`.
 */
export function experimentBaselines(experiment) {
  const list = Array.isArray(experiment.baselines)
    ? experiment.baselines.filter((entry) => entry !== null && typeof entry === 'object')
    : []
  if (list.length > 0) return list
  const legacy = experiment.baseline
  if (legacy !== null && typeof legacy === 'object') return [{ id: 'baseline-legacy', name: 'baseline', ...legacy }]
  return []
}

/**
 * @param {object} experiment - one experiment.
 * @param {number} limit - maximum runs shown.
 * @returns {string} the bounded text form for `exp_show`.
 */
export function formatExperimentDetail(experiment, limit = 20) {
  const runs = Array.isArray(experiment.runs) ? experiment.runs : []
  const shown = runs.slice(-limit)
  const lines = []
  lines.push(`Experiment ${experiment.id}: ${experiment.name}`)
  if (experiment.description) lines.push(experiment.description)
  lines.push(`factors: ${(experiment.factors ?? []).map((factor) => factor.key).join(', ') || '—'}`)
  lines.push(`metrics: ${(experiment.metrics ?? []).map(metricText).join(', ') || '—'}`)
  lines.push(`runs: ${runs.length}${runs.length > shown.length ? ` (showing last ${shown.length})` : ''}`)
  if (experiment.conclusion !== undefined && experiment.conclusion !== null) {
    const status = experiment.conclusion.status ?? 'draft'
    const text = typeof experiment.conclusion.text === 'string' && experiment.conclusion.text !== '' ? experiment.conclusion.text : '—'
    const by = experiment.conclusion.decidedBy
      ? ` · by ${experiment.conclusion.decidedBy}${experiment.conclusion.role ? ` (${experiment.conclusion.role})` : ''}`
      : ''
    lines.push(`conclusion [${status}]${by}: ${truncate(text, 500)}`)
    if (Array.isArray(experiment.conclusion.history) && experiment.conclusion.history.length > 0) {
      lines.push(`conclusion history: ${experiment.conclusion.history.length} entr${experiment.conclusion.history.length === 1 ? 'y' : 'ies'}`)
      for (const entry of experiment.conclusion.history.slice(-3)) {
        const when = typeof entry.at === 'number' ? new Date(entry.at).toISOString() : '—'
        lines.push(`  - ${when} ${entry.status ?? 'draft'}${entry.decidedBy ? ` by ${entry.decidedBy}` : ''}${entry.note ? ` — ${truncate(entry.note, 200)}` : ''}`)
      }
    }
    if (experiment.conclusion.signature?.keyId) {
      const signer = experiment.conclusion.signature.signer
      lines.push(`decision signature: ed25519 ${experiment.conclusion.signature.keyId}${signer ? ` (${signer})` : ''}`)
    }
  }
  for (const baseline of experimentBaselines(experiment)) {
    lines.push(`baseline "${baseline.name}": ${baseline.experimentName} / ${baseline.label} (${baseline.runId})`)
  }
  if (shown.length === 0) {
    lines.push('No runs yet. Use exp_run or exp_record.')
    return lines.join('\n')
  }
  lines.push('')
  for (const run of shown) {
    const metrics = Object.entries(run.metrics ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')
    lines.push(`${run.id} | ${run.label || '—'} | ${run.status} | ${formatDuration(run.durationMs)} | ${metrics || 'no metrics'}`)
  }
  return lines.join('\n')
}

/**
 * @param {object} run - one run.
 * @returns {string} the bounded text form for one run.
 */
export function formatRunDetail(run) {
  const lines = []
  const when = typeof run.startedAt === 'number' ? new Date(run.startedAt).toISOString() : '—'
  lines.push(`Run ${run.id} (${run.status}) · ${when} · ${formatDuration(run.durationMs)}`)
  if (run.label) lines.push(`label: ${run.label}`)
  const params = Object.entries(run.params ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')
  lines.push(`params: ${params || '—'}`)
  const metrics = Object.entries(run.metrics ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')
  lines.push(`metrics: ${metrics || '—'}`)
  if (Array.isArray(run.metricErrors) && run.metricErrors.length > 0) {
    lines.push('metric errors:')
    for (const entry of run.metricErrors) lines.push(`  ${entry.key}: ${truncate(entry.error, 300)}`)
  }
  if (run.command) lines.push(`command: ${truncate(run.command, 300)}`)
  if (typeof run.exitCode === 'number') lines.push(`exit: ${run.exitCode}`)
  if (run.manifest) {
    const manifest = run.manifest
    if (manifest.git) {
      const dirty = manifest.git.dirty ? ' · dirty' : ''
      lines.push(`git: ${manifest.git.commit?.slice(0, 12) ?? '—'}${manifest.git.branch ? ` (${manifest.git.branch})` : ''}${dirty}`)
    }
    if (manifest.toolchain) {
      lines.push(`toolchain: node ${manifest.toolchain.node} · ${manifest.toolchain.platform}/${manifest.toolchain.arch}`)
    }
    const env = Object.entries(manifest.env ?? {})
    if (env.length > 0) lines.push(`env: ${env.map(([key, value]) => `${key}=${value}`).join(', ')}`)
  }
  if (Array.isArray(run.artifacts) && run.artifacts.length > 0) {
    lines.push('artifacts:')
    for (const artifact of run.artifacts) {
      if (artifact.missing) lines.push(`  ${artifact.path} (missing)`)
      else lines.push(`  ${artifact.path} · ${artifact.sha256?.slice(0, 12) ?? '—'} · ${artifact.bytes ?? '?'} bytes`)
    }
  }
  if (Array.isArray(run.datasets) && run.datasets.length > 0) {
    lines.push('datasets:')
    for (const dataset of run.datasets) {
      const shape = typeof dataset.rows === 'number' ? ` · ${dataset.rows}×${dataset.cols ?? '?'}` : ''
      lines.push(`  ${dataset.path}${shape} · ${dataset.sha256?.slice(0, 12) ?? '—'}`)
    }
  }
  if (run.notes) lines.push(`notes: ${truncate(run.notes, 500)}`)
  if (run.stdoutTail) {
    lines.push('stdout tail:')
    lines.push(truncate(run.stdoutTail, 1200))
  }
  if (run.stderrTail) {
    lines.push('stderr tail:')
    lines.push(truncate(run.stderrTail, 800))
  }
  return lines.join('\n')
}

/**
 * @param {object} metric - one metric declaration.
 * @returns {string} `label [unit] ↓`.
 */
function metricText(metric) {
  const unit = metric.unit ? ` [${metric.unit}]` : ''
  const arrow = metric.direction === 'min' ? ' ↓' : metric.direction === 'max' ? ' ↑' : ''
  const source = metric.sql ? ' (sql)' : ''
  return `${metric.key}${unit}${arrow}${source}`
}

/**
 * @param {string} text - text to cut.
 * @param {number} limit - maximum characters.
 * @returns {string} the truncated text.
 */
export function truncate(text, limit) {
  if (typeof text !== 'string') return ''
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}
