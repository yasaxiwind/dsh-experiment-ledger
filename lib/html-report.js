/**
 * Self-contained HTML report: the same design, runs, comparison and charts as
 * the Markdown report, rendered into one portable file with inline CSS/SVG.
 *
 * @module dsh-experiment-ledger/html-report
 */
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { buildReport } from './report.js'
import { hashFile } from './runner.js'

/** Escape text for HTML. */
function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Three significant decimals. */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '—'
}

/** @returns {string} filesystem-safe stamp. */
function stampOf(time) {
  return new Date(time).toISOString().replaceAll(':', '').replace(/\.\d+Z$/, 'Z').replace('T', '-')
}

/** @returns {string} filesystem-safe slug. */
function slugOf(name) {
  return String(name ?? 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report'
}

/** Comparison table HTML. */
function comparisonTable(comparison) {
  const rows = comparison.groups.map((group) => {
    const cells = comparison.metrics.map((metric) => {
      const stat = group.stats[metric.key]
      if (stat === undefined || stat.n === 0) return '<td>—</td>'
      const ci = Array.isArray(stat.ci95) ? ` <span class="muted">[${num(stat.ci95[0])}, ${num(stat.ci95[1])}]</span>` : ''
      return `<td>${num(stat.mean)} ± ${num(stat.sd)}${ci} <span class="muted">(n=${stat.n})</span></td>`
    }).join('')
    return `<tr><td class="strong">${esc(group.label)}</td><td>${group.runs}</td>${cells}</tr>`
  }).join('')
  const head = comparison.metrics
    .map((metric) => `<th>${esc(metric.label ?? metric.key)}${metric.unit ? ` (${esc(metric.unit)})` : ''}</th>`)
    .join('')
  return `<table><thead><tr><th>Group</th><th>n</th>${head}</tr></thead><tbody>${rows}</tbody></table>`
}

/** Runs table HTML. */
function runsTable(runs, limit) {
  const rows = runs.slice(0, Math.max(1, limit)).map((run) => {
    const metrics = Object.entries(run.metrics ?? {})
      .map(([key, value]) => `<span class="metric"><b>${esc(key)}</b> ${esc(typeof value === 'number' ? num(value) : value)}</span>`)
      .join(' ')
    return `<tr><td class="mono">${esc(run.id)}</td><td>${esc(run.label ?? '')}</td><td><span class="badge ${esc(run.status)}">${esc(run.status)}</span></td><td>${run.durationMs === undefined ? '—' : `${num(run.durationMs)} ms`}</td><td>${metrics || '—'}</td></tr>`
  }).join('')
  return `<table><thead><tr><th>Run</th><th>Label</th><th>Status</th><th>Duration</th><th>Metrics</th></tr></thead><tbody>${rows}</tbody></table>`
}

/** Datasets table HTML. */
function datasetsTable(datasets) {
  if (datasets.length === 0) return '<p class="muted">No datasets declared.</p>'
  const rows = datasets.map((entry) => {
    const name = entry.name ?? String(entry.path ?? '').split(/[\\/]/).pop() ?? ''
    return `<tr><td>${esc(name)}</td><td class="mono small">${esc(entry.path)}</td><td class="mono small">${esc(String(entry.sha256 ?? '').slice(0, 16))}…</td><td>${entry.bytes ?? '—'}</td></tr>`
  }).join('')
  return `<table><thead><tr><th>Dataset</th><th>Path</th><th>SHA-256</th><th>Bytes</th></tr></thead><tbody>${rows}</tbody></table>`
}

/**
 * Render one self-contained HTML report.
 * @param {object} experiment - ledger experiment.
 * @param {ReturnType<typeof buildReport>} built - built report data.
 * @param {number} generatedAt - timestamp.
 * @returns {string} HTML.
 */
export function renderHtmlReport(experiment, built, generatedAt = Date.now(), print = false) {
  const tags = Array.isArray(experiment.tags) && experiment.tags.length > 0
    ? `<p class="tags">${experiment.tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</p>`
    : ''
  const charts = built.charts.length > 0
    ? `<div class="charts-grid">${built.charts.map((chart) => `<section class="card"><h2>${esc(chart.label ?? chart.key)}</h2>${chart.svg}</section>`).join('\n')}</div>`
    : ''
  const small = built.comparison.groups.some((group) => built.comparison.metrics.some((metric) => {
    const stat = group.stats[metric.key]
    return stat !== undefined && stat.n > 0 && stat.smallSample
  }))
  const best = built.comparison.best.length > 0
    ? `<p class="best">Best: ${built.comparison.best.map((winner) => `<b>${esc(winner.metric)}</b> → <span class="mono">${esc(winner.runId)}</span> (${num(winner.value)})`).join(' · ')}</p>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(experiment.name)} · experiment report</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; padding: 32px; font: 14px/1.55 system-ui, -apple-system, Segoe UI, sans-serif; color: #1f2328; background: #f6f8fa; }
main { max-width: 1080px; margin: 0 auto; }
h1 { margin: 0 0 4px; font-size: 26px; }
h2 { margin: 0 0 12px; font-size: 16px; }
p { margin: 0 0 12px; }
.muted { color: #6e7781; }
.mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.small { font-size: 12px; }
.tags span, .badge { display: inline-block; padding: 1px 7px; border-radius: 999px; background: #ddf4ff; color: #0969da; font-size: 12px; margin-right: 4px; }
.badge.ok { background: #dafbe1; color: #1a7f37; }
.badge.failed { background: #ffebe9; color: #cf222e; }
.badge.timeout { background: #fff8c5; color: #9a6700; }
.card { background: #fff; border: 1px solid #d0d7de; border-radius: 10px; padding: 18px; margin: 16px 0; overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid #eaeef2; vertical-align: top; }
th { color: #57606a; font-weight: 600; background: #f6f8fa; }
.strong { font-weight: 600; }
.metric { display: inline-block; margin-right: 10px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 16px 0; }
.stat { background: #fff; border: 1px solid #d0d7de; border-radius: 10px; padding: 12px; }
.stat b { display: block; font-size: 22px; }
.best { margin: 12px 0; }
.charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.charts-grid .card { margin: 0; }
.warn { color: #9a6700; }
footer { margin-top: 24px; color: #6e7781; font-size: 12px; }
svg { max-width: 100%; height: auto; }
@media (prefers-color-scheme: dark) {
  body { color: #e6edf3; background: #0d1117; }
  .card, .stat { background: #161b22; border-color: #30363d; }
  th { background: #161b22; color: #8b949e; }
  th, td { border-color: #21262d; }
  .muted, footer { color: #8b949e; }
}
@media print {
  body { background: #fff; color: #000; padding: 0; }
  .card, .stat { background: #fff; border-color: #ccc; break-inside: avoid; }
  th { background: #f2f2f2; color: #000; }
  th, td { border-color: #ddd; }
  .muted, footer { color: #444; }
  h1 { page-break-after: avoid; }
  .charts-grid { grid-template-columns: 1fr 1fr; }
  footer { page-break-before: avoid; }
}
</style>
</head>
<body>
<main>
<h1>${esc(experiment.name)}</h1>
<p class="muted mono">${esc(experiment.id)} · generated ${esc(new Date(generatedAt).toISOString())}${experiment.archived === true ? ' · archived' : ''}</p>
${tags}
${experiment.description ? `<p>${esc(experiment.description)}</p>` : ''}
${experiment.conclusion ? `<section class="card"><h2>Conclusion (${esc(experiment.conclusion.status ?? 'draft')})</h2><p>${esc(experiment.conclusion.text ?? '—')}</p>${experiment.conclusion.decidedBy ? `<p class="muted">by ${esc(experiment.conclusion.decidedBy)}${experiment.conclusion.role ? ` (${esc(experiment.conclusion.role)})` : ''}</p>` : ''}</section>` : ''}
<div class="grid">
  <div class="stat"><b>${built.comparison.runCount}</b>runs</div>
  <div class="stat"><b>${built.comparison.groups.length}</b>groups</div>
  <div class="stat"><b>${built.comparison.best.length}</b>best metrics</div>
  <div class="stat"><b>${built.charts.length}</b>charts</div>
  <div class="stat"><b>${built.datasets.length}</b>datasets</div>
</div>
${best}
<section class="card"><h2>Comparison</h2>${comparisonTable(built.comparison)}${small ? '<p class="warn">Small samples (n &lt; 3): confidence intervals are unreliable.</p>' : ''}</section>
${charts}
<section class="card"><h2>Runs</h2>${runsTable(Array.isArray(experiment.runs) ? experiment.runs : [], 100)}</section>
<section class="card"><h2>Datasets</h2>${datasetsTable(built.datasets)}</section>
<footer>Generated by dsh-experiment-ledger · self-contained HTML (no external assets).</footer>
</main>
</body>
</html>`
}

/**
 * Write a self-contained HTML report under `<ledger>/reports/`.
 * @param {string} root - ledger directory.
 * @param {object} experiment - ledger experiment.
 * @param {{groupBy?: string[], maxRuns?: number}} options - report options.
 * @returns {Promise<object>} written report metadata.
 */
export async function writeHtmlReport(root, experiment, options = {}) {
  const built = buildReport(experiment, options)
  const generatedAt = Date.now()
  const print = options.print === true
  const directory = join(root, 'reports', `${stampOf(generatedAt)}-${slugOf(experiment.name)}`)
  await fsp.mkdir(directory, { recursive: true })
  const file = join(directory, print ? 'report-print.html' : 'report.html')
  await fsp.writeFile(file, renderHtmlReport(experiment, built, generatedAt, print), 'utf8')
  const digest = await hashFile(file)
  return {
    path: file,
    relative: file.slice(root.length).replace(/^[\\/]+/, ''),
    sha256: digest.sha256,
    bytes: digest.bytes,
    id: `rep-${generatedAt.toString(36)}`,
    format: print ? 'print' : 'html',
    summary: {
      runs: built.comparison.runCount,
      groups: built.comparison.groups.length,
      best: built.comparison.best.length,
      charts: built.charts.length,
      datasets: built.datasets.length,
    },
  }
}
