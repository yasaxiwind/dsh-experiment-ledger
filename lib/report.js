/**
 * Markdown report generation for one experiment.
 *
 * The report is a plain file under `<ledger>/reports/<stamp>-<slug>/report.md`,
 * so it can be opened, diffed or attached without this plugin. Its SHA-256 is
 * returned and recorded on the experiment.
 *
 * @module dsh-experiment-ledger/report
 */
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { hashFile } from './runner.js'
import { compareRuns, formatNumber, formatSigned, varyingFactors } from './compare.js'
import { formatDuration, formatValue, experimentBaselines } from './model.js'
import { barChartSvg, chartFileName } from './chart.js'

/**
 * @param {string} name - experiment name.
 * @returns {string} a filesystem-safe slug.
 */
function slugOf(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug === '' ? 'experiment' : slug
}

/**
 * @param {number} time - epoch milliseconds.
 * @returns {string} a UTC timestamp safe for a directory name.
 */
function stampOf(time) {
  return new Date(time).toISOString().replace(/[:.]/g, '-')
}

/**
 * @param {string[]} cells - table cells.
 * @returns {string} a Markdown row.
 */
function row(cells) {
  return `| ${cells.join(' | ')} |`
}

/**
 * Build the Markdown report.
 * @param {object} experiment - ledger experiment.
 * @param {{groupBy?: string[], maxRuns?: number}} options - report options.
 * @returns {{markdown: string, comparison: object, groupBy: string[]}} the report.
 */
export function buildReport(experiment, options = {}) {
  const runs = Array.isArray(experiment.runs) ? experiment.runs : []
  const factors = Array.isArray(experiment.factors) ? experiment.factors : []
  const metrics = Array.isArray(experiment.metrics) ? experiment.metrics : []
  const groupBy = Array.isArray(options.groupBy) && options.groupBy.length > 0 ? options.groupBy : varyingFactors(experiment)
  const maxRuns = typeof options.maxRuns === 'number' ? options.maxRuns : 100
  const comparison = compareRuns(experiment, { groupBy })

  const lines = []
  lines.push(`# ${experiment.name}`)
  lines.push('')
  if (experiment.description) {
    lines.push(experiment.description)
    lines.push('')
  }
  lines.push(`- Experiment: \`${experiment.id}\``)
  lines.push(`- Runs: ${runs.length}`)
  if (typeof experiment.createdAt === 'number') lines.push(`- Created: ${new Date(experiment.createdAt).toISOString()}`)
  if (typeof experiment.updatedAt === 'number') lines.push(`- Updated: ${new Date(experiment.updatedAt).toISOString()}`)
  lines.push('')

  if (experiment.conclusion !== undefined && experiment.conclusion !== null) {
    lines.push(`## Conclusion (${experiment.conclusion.status ?? 'draft'})`)
    lines.push('')
    lines.push(experiment.conclusion.text || '—')
    if (experiment.conclusion.decidedBy) {
      lines.push('')
      lines.push(`_By ${experiment.conclusion.decidedBy}${experiment.conclusion.role ? ` (${experiment.conclusion.role})` : ''}._`)
    }
    lines.push('')
  }

  lines.push('## Design')
  lines.push('')
  if (factors.length === 0) {
    lines.push('No factors declared.')
  } else {
    lines.push(row(['Factor', 'Label', 'Unit', 'Values seen']))
    lines.push(row(['---', '---', '---', '---']))
    for (const factor of factors) {
      const seen = [...new Set(runs.map((run) => formatValue(run.params?.[factor.key] ?? '—')))].slice(0, 8)
      lines.push(row([factor.key, factor.label ?? factor.key, factor.unit ?? '', seen.join(', ')]))
    }
  }
  lines.push('')
  if (metrics.length === 0) {
    lines.push('No metrics declared.')
  } else {
    lines.push(row(['Metric', 'Label', 'Unit', 'Direction']))
    lines.push(row(['---', '---', '---', '---']))
    for (const metric of metrics) {
      lines.push(row([metric.key, metric.label ?? metric.key, metric.unit ?? '', metric.direction ?? 'none']))
    }
  }
  lines.push('')

  const datasetRows = new Map()
  for (const run of runs) {
    for (const dataset of run.datasets ?? []) {
      const key = `${dataset.path}|${dataset.sha256}`
      if (!datasetRows.has(key)) datasetRows.set(key, { ...dataset, runs: 0 })
      datasetRows.get(key).runs += 1
    }
  }
  if (datasetRows.size > 0) {
    lines.push('## Datasets')
    lines.push('')
    lines.push(row(['Path', 'Kind', 'Rows × cols', 'SHA-256', 'Runs']))
    lines.push(row(['---', '---', '---', '---', '---']))
    for (const dataset of datasetRows.values()) {
      const shape = typeof dataset.rows === 'number'
        ? `${dataset.rows.toLocaleString()} × ${dataset.cols ?? '?'}`
        : '—'
      lines.push(row([
        `\`${dataset.path}\``,
        dataset.kind ?? '',
        shape,
        (dataset.sha256 ?? '').slice(0, 12),
        String(dataset.runs),
      ]))
    }
    lines.push('')
  }

  const baselines = experimentBaselines(experiment)
  if (baselines.length > 0) {
    lines.push('## Baselines')
    lines.push('')
    for (const baseline of baselines) {
      lines.push(`### ${baseline.name}`)
      lines.push('')
      lines.push(`- Run: \`${baseline.runId}\` (${baseline.label ?? baseline.runId}) in ${baseline.experimentName ?? baseline.experimentId}`)
      if (typeof baseline.setAt === 'number') lines.push(`- Set: ${new Date(baseline.setAt).toISOString()}`)
      const baselineKeys = Object.keys(baseline.metrics ?? {})
      if (baselineKeys.length > 0) {
        lines.push('')
        lines.push(row(['Metric', 'Baseline value']))
        lines.push(row(['---', '---']))
        for (const key of baselineKeys) {
          const value = baseline.metrics[key]
          lines.push(row([key, typeof value === 'number' ? formatNumber(value) : formatValue(value)]))
        }
      }
      lines.push('')
    }
  }

  lines.push('## Runs')
  lines.push('')
  if (runs.length === 0) {
    lines.push('No runs recorded.')
  } else {
    const shown = runs.slice(-maxRuns)
    const metricKeys = comparison.metrics.map((metric) => metric.key)
    lines.push(row(['Run', 'Label', 'Status', 'Duration', ...factors.map((factor) => factor.key), ...metricKeys]))
    lines.push(row(['---', '---', '---', '---', ...factors.map(() => '---'), ...metricKeys.map(() => '---')]))
    for (const run of shown) {
      lines.push(row([
        `\`${run.id}\``,
        run.label ?? '',
        run.status ?? '',
        formatDuration(run.durationMs),
        ...factors.map((factor) => formatValue(run.params?.[factor.key] ?? '—')),
        ...metricKeys.map((key) => formatValue(run.metrics?.[key] ?? '—')),
      ]))
    }
    if (runs.length > shown.length) lines.push('', `_Showing the last ${shown.length} of ${runs.length} runs._`)
  }
  lines.push('')

  lines.push('## Comparison')
  lines.push('')
  lines.push(`Grouped by: ${groupBy.length === 0 ? 'all runs' : groupBy.map((key) => `\`${key}\``).join(', ')}`)
  const primaryBaseline = baselines[0] ?? null
  if (primaryBaseline !== null) lines.push(`Δ columns use baseline: \`${primaryBaseline.name}\``)
  lines.push('')
  if (comparison.runCount === 0) {
    lines.push('No runs to compare.')
  } else {
    const header = ['Group', 'n', ...comparison.metrics.map((metric) => `${metric.key}${metric.unit ? ` (${metric.unit})` : ''}`)]
    lines.push(row(header))
    lines.push(row(['---', '---', ...comparison.metrics.map(() => '---')]))
    for (const group of comparison.groups) {
      const cells = [group.label, String(group.runs)]
      for (const metric of comparison.metrics) {
        const stat = group.stats[metric.key]
        const baselineValue = primaryBaseline?.metrics?.[metric.key]
        const delta = typeof baselineValue === 'number' && typeof stat.mean === 'number'
          ? ` (Δ ${formatSigned(stat.mean - baselineValue)})`
          : ''
        const ci = Array.isArray(stat.ci95)
          ? ` (95% CI ${formatNumber(stat.ci95[0])}–${formatNumber(stat.ci95[1])})`
          : ''
        cells.push(stat.n === 0 ? '—' : `${formatNumber(stat.mean)} ± ${formatNumber(stat.sd)}${ci}${delta}`)
      }
      lines.push(row(cells))
    }
    const smallSamples = comparison.groups.some((group) => comparison.metrics.some((metric) => {
      const stat = group.stats[metric.key]
      return stat.n > 0 && stat.smallSample
    }))
    if (smallSamples) {
      lines.push('')
      lines.push('_Small samples (n < 3): confidence intervals are unreliable._')
    }
    for (const baseline of baselines) {
      lines.push('')
      lines.push(`**Δ vs ${baseline.name}:**`)
      lines.push('')
      lines.push(row(['Group', ...comparison.metrics.map((metric) => `${metric.key} Δ`)]))
      lines.push(row(['---', ...comparison.metrics.map(() => '---')]))
      for (const group of comparison.groups) {
        const cells = [group.label]
        for (const metric of comparison.metrics) {
          const stat = group.stats[metric.key]
          const baseValue = baseline.metrics?.[metric.key]
          cells.push(typeof baseValue === 'number' && stat.n > 0 && typeof stat.mean === 'number'
            ? formatSigned(stat.mean - baseValue)
            : '—')
        }
        lines.push(row(cells))
      }
    }
    if (comparison.best.length > 0) {
      lines.push('')
      lines.push('**Best runs:**')
      lines.push('')
      for (const winner of comparison.best) {
        lines.push(`- ${winner.metric}: \`${winner.runId}\` (${winner.label}) = ${formatNumber(winner.value)}`)
      }
    }
  }
  lines.push('')

  const charts = []
  const chartNames = new Set()
  for (const metric of comparison.metrics) {
    const numeric = comparison.groups.some((group) => (group.stats[metric.key]?.n ?? 0) > 0)
    if (!numeric) continue
    const file = chartFileName(metric.key)
    if (chartNames.has(file)) continue
    chartNames.add(file)
    const label = `${metric.label ?? metric.key}${metric.unit ? ` (${metric.unit})` : ''}`
    charts.push({ key: metric.key, label, file, svg: barChartSvg({ groups: comparison.groups, metric }) })
    if (charts.length >= 8) break
  }
  if (charts.length > 0) {
    lines.push('## Charts')
    lines.push('')
    for (const chart of charts) lines.push(`![${chart.label}](charts/${chart.file})`, '')
  }

  lines.push('## Artifacts')
  lines.push('')
  const seen = new Set()
  const artifactRows = []
  for (const run of runs) {
    for (const artifact of run.artifacts ?? []) {
      if (seen.has(artifact.path)) continue
      seen.add(artifact.path)
      artifactRows.push(row([
        `\`${artifact.path}\``,
        artifact.missing ? 'missing' : (artifact.sha256 ?? '').slice(0, 12),
        artifact.missing ? '—' : String(artifact.bytes ?? ''),
        `\`${run.id}\``,
      ]))
    }
  }
  if (artifactRows.length === 0) {
    lines.push('No artifacts recorded.')
  } else {
    lines.push(row(['Path', 'SHA-256', 'Bytes', 'Run']))
    lines.push(row(['---', '---', '---', '---']))
    lines.push(...artifactRows)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(`Generated by dsh-experiment-ledger at ${new Date().toISOString()}.`)

  return { markdown: lines.join('\n'), comparison, groupBy, charts, datasets: [...datasetRows.values()] }
}

/**
 * Build and write the report under `<ledger>/reports/`.
 * @param {string} root - ledger directory.
 * @param {object} experiment - ledger experiment.
 * @param {{groupBy?: string[], maxRuns?: number}} options - report options.
 * @returns {Promise<{path: string, relative: string, sha256: string, bytes: number, summary: {runs: number, groups: number, best: number, charts: number, datasets: number}}>} the written report.
 */
export async function writeReport(root, experiment, options = {}) {
  const { markdown, comparison, charts, datasets } = buildReport(experiment, options)
  const id = `rep-${Date.now().toString(36)}`
  const directory = join(root, 'reports', `${stampOf(Date.now())}-${slugOf(experiment.name)}`)
  await fsp.mkdir(directory, { recursive: true })
  if (charts.length > 0) {
    const chartDir = join(directory, 'charts')
    await fsp.mkdir(chartDir, { recursive: true })
    for (const chart of charts) await fsp.writeFile(join(chartDir, chart.file), chart.svg, 'utf8')
  }
  const file = join(directory, 'report.md')
  await fsp.writeFile(file, markdown, 'utf8')
  const digest = await hashFile(file)
  return {
    path: file,
    relative: file.slice(root.length).replace(/^[\\/]+/, ''),
    sha256: digest.sha256,
    bytes: digest.bytes,
    id,
    summary: {
      runs: comparison.runCount,
      groups: comparison.groups.length,
      best: comparison.best.length,
      charts: charts.length,
      datasets: datasets.length,
    },
  }
}
