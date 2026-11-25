/**
 * Tests for dataset provenance, run diffs and report charts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeDataset, collectDatasets } from '../lib/datasets.js'
import { diffRuns, formatDiff } from '../lib/diff.js'
import { barChartSvg, chartFileName } from '../lib/chart.js'
import { buildReport, writeReport } from '../lib/report.js'

/**
 * @returns {Promise<string>} a fresh temporary directory.
 */
async function tempDir() {
  return await fsp.mkdtemp(join(tmpdir(), 'exp-features-'))
}

/**
 * @returns {object} one experiment with two runs.
 */
function demoExperiment() {
  return {
    id: 'exp-demo',
    name: 'PID tuning',
    description: 'Find a stable gain',
    factors: [{ key: 'kp', label: 'Kp' }],
    metrics: [
      { key: 'overshoot', label: 'Overshoot', unit: '%', direction: 'min' },
      { key: 'settling', label: 'Settling', unit: 's', direction: 'min' },
    ],
    createdAt: 1,
    updatedAt: 2,
    runs: [
      {
        id: 'run-1', label: 'a', status: 'ok', durationMs: 10,
        params: { kp: 0.8 }, metrics: { overshoot: 12.4, settling: 3.2 },
        artifacts: [{ path: 'C:\\x\\a.png', sha256: 'a'.repeat(64), bytes: 100 }],
        datasets: [{ path: 'C:\\x\\data.csv', sha256: 'b'.repeat(64), bytes: 120, kind: 'csv', rows: 10, cols: 3 }],
      },
      {
        id: 'run-2', label: 'b', status: 'ok', durationMs: 12,
        params: { kp: 1.2 }, metrics: { overshoot: 4.2, settling: 2.8 },
        artifacts: [{ path: 'C:\\x\\a.png', sha256: 'c'.repeat(64), bytes: 120 }, { path: 'C:\\x\\b.png', sha256: 'd'.repeat(64), bytes: 90 }],
        datasets: [],
      },
    ],
  }
}

test('describeDataset hashes a CSV and counts rows and columns', async () => {
  const dir = await tempDir()
  const file = join(dir, 'data.csv')
  await fsp.writeFile(file, 'a,b,c\n1,2,3\n4,5,6\n', 'utf8')
  const dataset = await describeDataset(file, dir)
  assert.equal(dataset.kind, 'csv')
  assert.equal(dataset.rows, 2)
  assert.equal(dataset.cols, 3)
  assert.equal(dataset.sha256.length, 64)
  assert.equal(dataset.bytes, 18)
})

test('describeDataset handles TSV and deduplicates paths', async () => {
  const dir = await tempDir()
  const file = join(dir, 'data.tsv')
  await fsp.writeFile(file, 'a\tb\n1\t2\n', 'utf8')
  const collected = await collectDatasets([file, { path: file, note: 'dup' }], dir)
  assert.equal(collected.length, 1)
  assert.equal(collected[0].cols, 2)
  assert.equal(collected[0].rows, 1)
})

test('diffRuns reports changed params, metrics and artifacts', () => {
  const [left, right] = demoExperiment().runs
  const diff = diffRuns(left, right)
  assert.equal(diff.params.find((row) => row.key === 'kp').changed, true)
  assert.equal(diff.metrics.find((row) => row.key === 'overshoot').changed, true)
  assert.equal(diff.artifacts.find((row) => row.path === 'C:\\x\\a.png').state, 'changed')
  assert.equal(diff.artifacts.find((row) => row.path === 'C:\\x\\b.png').state, 'added')
  const text = formatDiff(diff)
  assert.match(text, /params: 1 changed of 1/)
  assert.match(text, /kp: 0\.8 → 1\.2/)
  assert.match(text, /overshoot: 12\.4 → 4\.2/)
  assert.match(text, /changed: C:\\x\\a\.png/)
})

test('barChartSvg renders bars, whiskers and labels', () => {
  const groups = [
    { label: 'kp=0.8', stats: { overshoot: { n: 2, mean: 12, sd: 0.4 } } },
    { label: 'kp=1.2', stats: { overshoot: { n: 1, mean: 4.2, sd: 0 } } },
  ]
  const svg = barChartSvg({ groups, metric: { key: 'overshoot', label: 'Overshoot', unit: '%' } })
  assert.match(svg, /^<svg /)
  assert.match(svg, /Overshoot \(%\)/)
  assert.match(svg, /kp=0\.8/)
  assert.match(svg, /12/)
  assert.equal(chartFileName('overshoot'), 'overshoot.svg')
})

test('report includes a baseline section and deltas', () => {
  const experiment = demoExperiment()
  experiment.baseline = {
    experimentId: 'exp-base',
    experimentName: 'Baseline exp',
    runId: 'run-base',
    label: 'base',
    metrics: { overshoot: 10 },
    params: {},
    setAt: 3,
  }
  const report = buildReport(experiment, {})
  assert.match(report.markdown, /## Baselines/)
  assert.match(report.markdown, /### base/)
  assert.match(report.markdown, /Baseline exp/)
  assert.match(report.markdown, /Δ \+2\.4/)
  assert.match(report.markdown, /Δ vs base/)
})

test('report includes datasets, charts and writes chart files', async () => {
  const root = await tempDir()
  const experiment = demoExperiment()
  const report = buildReport(experiment, {})
  assert.match(report.markdown, /## Datasets/)
  assert.match(report.markdown, /data\.csv/)
  assert.match(report.markdown, /## Charts/)
  assert.match(report.markdown, /!\[Overshoot \(%\)\]\(charts\/overshoot\.svg\)/)
  assert.ok(report.charts.length >= 1)

  const written = await writeReport(root, experiment, {})
  const chartPath = join(written.path, '..', 'charts', 'overshoot.svg')
  const svg = await fsp.readFile(chartPath, 'utf8')
  assert.match(svg, /^<svg /)
  assert.equal(written.summary.charts, report.charts.length)
  assert.equal(written.summary.datasets, 1)
})
