/**
 * Comparison rules for the experiment ledger: group runs by factor values,
 * summarize numeric metrics, and pick the best run per metric direction.
 *
 * Pure functions over plain ledger objects so the tool, the panel route and
 * the report builder all agree on the numbers.
 *
 * @module dsh-experiment-ledger/compare
 */
import { formatValue } from './model.js'
import { confidenceInterval95, effectLabel, welchFromStats } from './stats.js'

/**
 * @param {Array<unknown>} values - candidate values.
 * @returns {number[]} finite numbers only.
 */
function numbers(values) {
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value))
}

/**
 * Summarize one numeric series.
 * @param {number[]} values - finite numbers.
 * @returns {{n: number, mean: number | null, sd: number | null, min: number | null, max: number | null}} the summary.
 */
export function summarize(values) {
  const nums = numbers(values)
  if (nums.length === 0) {
    return { n: 0, mean: null, sd: null, min: null, max: null, se: null, ci95: null, smallSample: true }
  }
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length
  const variance = nums.length > 1
    ? nums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (nums.length - 1)
    : 0
  const interval = confidenceInterval95(nums)
  return {
    n: nums.length,
    mean,
    sd: Math.sqrt(variance),
    min: Math.min(...nums),
    max: Math.max(...nums),
    se: interval === null ? null : interval.se,
    ci95: interval === null ? null : [interval.low, interval.high],
    smallSample: nums.length < 3,
  }
}

/**
 * @param {object[]} runs - runs in one group.
 * @param {string} key - metric key.
 * @returns {Array<{value: string, count: number}>} distinct non-numeric values.
 */
export function distinctValues(runs, key) {
  const counts = new Map()
  for (const run of runs) {
    const value = run.metrics?.[key]
    if (value === undefined || typeof value === 'number') continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count }))
}

/**
 * Build a group key from one run's parameter values.
 * @param {object} run - one run.
 * @param {string[]} groupBy - factor keys.
 * @returns {{key: string, label: string}} the group identity.
 */
function groupOf(run, groupBy) {
  if (groupBy.length === 0) return { key: 'all', label: 'all runs' }
  const parts = groupBy.map((factor) => {
    const value = run.params?.[factor]
    return `${factor}=${value === undefined ? '—' : formatValue(value)}`
  })
  return { key: parts.join('|'), label: parts.join(', ') }
}

/**
 * @param {object[]} runs - runs to compare.
 * @returns {string[]} metric keys present on the runs, first-seen order.
 */
function observedMetricKeys(runs) {
  const keys = []
  for (const run of runs) for (const key of Object.keys(run.metrics ?? {})) if (!keys.includes(key)) keys.push(key)
  return keys
}

/**
 * Factors whose value actually varies between runs, falling back to every
 * declared factor when nothing varies.
 * @param {object} experiment - ledger experiment.
 * @returns {string[]} factor keys.
 */
export function varyingFactors(experiment) {
  const factors = Array.isArray(experiment.factors) ? experiment.factors : []
  const runs = Array.isArray(experiment.runs) ? experiment.runs : []
  const varying = factors
    .map((factor) => factor.key)
    .filter((key) => {
      const seen = new Set(runs.map((run) => JSON.stringify(run.params?.[key] ?? null)))
      return seen.size > 1
    })
  return varying.length > 0 ? varying : factors.map((factor) => factor.key)
}

/**
 * Compare the runs of one experiment.
 * @param {object} experiment - ledger experiment.
 * @param {{groupBy?: string[], metrics?: string[], compareGroups?: string[]}} options - grouping and metric subset.
 * @returns {{
 *   groupBy: string[],
 *   runCount: number,
 *   metrics: Array<{key: string, label: string, unit?: string, direction: string}>,
 *   groups: Array<{key: string, label: string, runs: number, stats: Record<string, object>, values: Record<string, Array<{value: string, count: number}>>}>,
 *   best: Array<{metric: string, runId: string, label: string, value: number}>,
 * }} the comparison.
 */
export function compareRuns(experiment, options = {}) {
  const runs = Array.isArray(experiment.runs) ? experiment.runs : []
  const declared = Array.isArray(experiment.metrics) ? experiment.metrics : []
  const groupBy = Array.isArray(options.groupBy)
    ? options.groupBy.filter((key) => typeof key === 'string' && key !== '')
    : varyingFactors(experiment)

  const declaredByKey = new Map(declared.map((metric) => [metric.key, metric]))
  const keys = []
  for (const metric of declared) keys.push(metric.key)
  for (const key of observedMetricKeys(runs)) if (!keys.includes(key)) keys.push(key)
  const requested = Array.isArray(options.metrics) && options.metrics.length > 0 ? options.metrics : null
  const metricKeys = requested === null ? keys : keys.filter((key) => requested.includes(key))

  const buckets = new Map()
  for (const run of runs) {
    const group = groupOf(run, groupBy)
    if (!buckets.has(group.key)) buckets.set(group.key, { ...group, runs: [] })
    buckets.get(group.key).runs.push(run)
  }

  const groups = [...buckets.values()].map((bucket) => {
    const stats = {}
    const values = {}
    for (const key of metricKeys) {
      const series = bucket.runs.map((run) => run.metrics?.[key]).filter((value) => value !== undefined)
      stats[key] = summarize(series)
      values[key] = distinctValues(bucket.runs, key)
    }
    return {
      key: bucket.key,
      label: bucket.label,
      runs: bucket.runs.length,
      stats,
      values,
    }
  })

  groups.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))

  const best = []
  for (const metric of declared) {
    if (metric.direction !== 'min' && metric.direction !== 'max') continue
    let winner = null
    for (const run of runs) {
      const value = run.metrics?.[metric.key]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      if (winner === null || (metric.direction === 'min' ? value < winner.value : value > winner.value)) {
        winner = { metric: metric.key, runId: run.id, label: run.label ?? run.id, value }
      }
    }
    if (winner !== null) best.push(winner)
  }

  const metrics = metricKeys.map((key) => {
    const declaredMetric = declaredByKey.get(key)
    return declaredMetric ?? { key, label: key, direction: 'none' }
  })

  let pairwise = null
  if (Array.isArray(options.compareGroups) && options.compareGroups.length === 2) {
    const findGroup = (name) => groups.find((group) => group.label === name || group.key === name)
    const left = findGroup(options.compareGroups[0])
    const right = findGroup(options.compareGroups[1])
    if (left !== undefined && right !== undefined) {
      pairwise = { a: left.label, b: right.label, metrics: {} }
      for (const key of metricKeys) {
        const test = welchFromStats(left.stats[key], right.stats[key])
        if (test !== null) pairwise.metrics[key] = test
      }
    }
  }

  return { groupBy, runCount: runs.length, metrics, groups, best, pairwise }
}

/**
 * Render a comparison as bounded text for `exp_compare`.
 * @param {object} experiment - ledger experiment.
 * @param {ReturnType<typeof compareRuns>} comparison - comparison result.
 * @returns {string} the text form.
 */
export function formatComparison(experiment, comparison) {
  const lines = []
  const grouping = comparison.groupBy.length === 0 ? 'all runs' : comparison.groupBy.join(', ')
  lines.push(`Comparison ${experiment.id}: ${experiment.name} · ${comparison.runCount} runs · grouped by ${grouping}`)
  if (comparison.runCount === 0) {
    lines.push('No runs yet.')
    return lines.join('\n')
  }
  const header = ['group', 'n']
  for (const metric of comparison.metrics) {
    const unit = metric.unit ? ` (${metric.unit})` : ''
    header.push(`${metric.key}${unit} mean±sd`)
  }
  lines.push(header.join(' | '))
  for (const group of comparison.groups) {
    const cells = [group.label, String(group.runs)]
    for (const metric of comparison.metrics) {
      const stat = group.stats[metric.key]
      if (metric.direction === 'none' && stat.n === 0) {
        const distinct = group.values[metric.key] ?? []
        cells.push(distinct.length === 0 ? '—' : distinct.slice(0, 3).map((entry) => `${entry.value}×${entry.count}`).join(', '))
      } else if (stat.n === 0) {
        cells.push('—')
      } else {
        const ci = Array.isArray(stat.ci95) ? ` [${formatNumber(stat.ci95[0])}, ${formatNumber(stat.ci95[1])}]` : ''
        cells.push(`${formatNumber(stat.mean)}±${formatNumber(stat.sd)}${ci} (${stat.n})`)
      }
    }
    lines.push(cells.join(' | '))
  }
  const smallSamples = []
  for (const group of comparison.groups) {
    for (const metric of comparison.metrics) {
      const stat = group.stats[metric.key]
      if (stat.n > 0 && stat.smallSample) smallSamples.push(`${group.label}/${metric.key} n=${stat.n}`)
    }
  }
  if (smallSamples.length > 0) {
    lines.push('')
    lines.push(`sample warning (n<3, CI unreliable): ${smallSamples.slice(0, 12).join('; ')}${smallSamples.length > 12 ? '…' : ''}`)
  }
  if (comparison.best.length > 0) {
    lines.push('')
    lines.push(`best: ${comparison.best.map((winner) => `${winner.metric} → ${winner.runId} (${formatNumber(winner.value)})`).join('; ')}`)
  }
  if (comparison.pairwise !== null) {
    lines.push('')
    lines.push(`pairwise: ${comparison.pairwise.a} vs ${comparison.pairwise.b}`)
    for (const metric of comparison.metrics) {
      const test = comparison.pairwise.metrics[metric.key]
      if (test === undefined) continue
      const ci = Array.isArray(test.ci95)
        ? `[${formatNumber(test.ci95[0])}, ${formatNumber(test.ci95[1])}]`
        : '—'
      lines.push(`  ${metric.key}: Δ=${formatSigned(test.difference)} · 95% CI ${ci} · d=${formatNumber(test.cohenD)} (${effectLabel(test.cohenD)}) · p=${formatNumber(test.p)}`)
    }
  }
  return lines.join('\n')
}

/**
 * @param {number | null} value - number to format.
 * @returns {string} three significant decimals without trailing zeros.
 */
export function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return String(Math.round(value * 1000) / 1000)
}

/**
 * @param {number} value - a delta.
 * @returns {string} the number with an explicit plus sign when positive.
 */
export function formatSigned(value) {
  const text = formatNumber(value)
  return value > 0 ? `+${text}` : text
}
