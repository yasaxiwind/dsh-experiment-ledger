/**
 * Two-run comparison: what changed between two runs of one experiment.
 *
 * The ledger keeps flat scalar parameters and metrics, so a diff is a keyed
 * union with a changed flag; artifacts compare by path and SHA-256.
 *
 * @module dsh-experiment-ledger/diff
 */
import { formatDuration, formatValue } from './model.js'

/**
 * @param {unknown} left - left value.
 * @param {unknown} right - right value.
 * @returns {boolean} whether the values are equal.
 */
function same(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/**
 * Compare two flat objects.
 * @param {Record<string, unknown>} left - left object.
 * @param {Record<string, unknown>} right - right object.
 * @returns {Array<{key: string, left: unknown, right: unknown, changed: boolean}>} the rows.
 */
function diffMap(left, right) {
  const keys = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].sort()
  return keys.map((key) => ({
    key,
    left: left?.[key],
    right: right?.[key],
    changed: !same(left?.[key], right?.[key]),
  }))
}

/**
 * Compare artifact lists by path.
 * @param {object[]} left - left artifacts.
 * @param {object[]} right - right artifacts.
 * @returns {Array<{path: string, leftSha: string, rightSha: string, state: string}>} the rows.
 */
function diffArtifacts(left, right) {
  const byPath = new Map()
  for (const artifact of left ?? []) byPath.set(artifact.path, { left: artifact })
  for (const artifact of right ?? []) {
    const entry = byPath.get(artifact.path) ?? {}
    entry.right = artifact
    byPath.set(artifact.path, entry)
  }
  const rows = []
  for (const [path, entry] of byPath) {
    const leftSha = entry.left?.sha256 ?? ''
    const rightSha = entry.right?.sha256 ?? ''
    let state = 'same'
    if (entry.left === undefined) state = 'added'
    else if (entry.right === undefined) state = 'removed'
    else if (leftSha !== rightSha) state = 'changed'
    rows.push({ path, leftSha, rightSha, state })
  }
  rows.sort((a, b) => a.path.localeCompare(b.path))
  return rows
}

/**
 * Compare two runs.
 * @param {object} left - the earlier run.
 * @param {object} right - the later run.
 * @returns {{left: object, right: object, params: object[], metrics: object[], artifacts: object[]}} the diff.
 */
export function diffRuns(left, right) {
  return {
    left: { id: left.id, label: left.label ?? left.id, status: left.status, startedAt: left.startedAt, durationMs: left.durationMs },
    right: { id: right.id, label: right.label ?? right.id, status: right.status, startedAt: right.startedAt, durationMs: right.durationMs },
    params: diffMap(left.params, right.params),
    metrics: diffMap(left.metrics, right.metrics),
    artifacts: diffArtifacts(left.artifacts, right.artifacts),
  }
}

/**
 * @param {object} diff - result of `diffRuns`.
 * @returns {string} bounded text for the model.
 */
export function formatDiff(diff) {
  const lines = []
  const side = (run) => `${run.id} (${run.label}) · ${run.status} · ${formatDuration(run.durationMs)}`
  lines.push(`Diff: ${side(diff.right)}  ←  ${side(diff.left)}`)
  const section = (title, rows, unit) => {
    const changed = rows.filter((row) => row.changed)
    lines.push('')
    lines.push(`${title}: ${changed.length} changed of ${rows.length}`)
    for (const row of rows) {
      if (!row.changed) continue
      lines.push(`  ${row.key}: ${row.left === undefined ? '—' : formatValue(row.left)} → ${row.right === undefined ? '—' : formatValue(row.right)}`)
    }
    if (changed.length === 0) lines.push('  (no change)')
  }
  section('params', diff.params)
  section('metrics', diff.metrics)
  lines.push('')
  const changedArtifacts = diff.artifacts.filter((row) => row.state !== 'same')
  lines.push(`artifacts: ${changedArtifacts.length} changed of ${diff.artifacts.length}`)
  for (const row of changedArtifacts) {
    lines.push(`  ${row.state}: ${row.path}`)
  }
  if (changedArtifacts.length === 0) lines.push('  (no change)')
  return lines.join('\n')
}
