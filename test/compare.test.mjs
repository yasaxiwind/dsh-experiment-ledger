/**
 * Unit tests for the comparison and report builders.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { summarize, compareRuns, formatComparison, varyingFactors } from '../lib/compare.js'
import { buildReport, writeReport } from '../lib/report.js'

/**
 * @returns {object} one experiment with four runs.
 */
function demoExperiment() {
  return {
    id: 'exp-demo',
    name: 'PID tuning',
    description: 'Find a stable gain',
    factors: [{ key: 'kp', label: 'Kp' }, { key: 'ki', label: 'Ki' }],
    metrics: [
      { key: 'overshoot', label: 'Overshoot', unit: '%', direction: 'min' },
      { key: 'settling', label: 'Settling', unit: 's', direction: 'min' },
    ],
    createdAt: 1,
    updatedAt: 2,
    reports: [],
    runs: [
      { id: 'run-1', label: 'a', status: 'ok', durationMs: 10, params: { kp: 0.8, ki: 0.2 }, metrics: { overshoot: 12.4, settling: 3.2 }, artifacts: [] },
      { id: 'run-2', label: 'b', status: 'ok', durationMs: 11, params: { kp: 0.8, ki: 0.2 }, metrics: { overshoot: 11.6, settling: 3.0 }, artifacts: [{ path: 'C:\\x\\a.png', sha256: 'a'.repeat(64), bytes: 100 }] },
      { id: 'run-3', label: 'c', status: 'ok', durationMs: 12, params: { kp: 1.2, ki: 0.2 }, metrics: { overshoot: 4.2, settling: 2.8 }, artifacts: [] },
      { id: 'run-4', label: 'd', status: 'failed', durationMs: 13, params: { kp: 1.2, ki: 0.2 }, metrics: {}, artifacts: [] },
    ],
  }
}

test('summarize computes mean, sample sd, min and max', () => {
  const summary = summarize([1, 2, 3, undefined, 'x'])
  assert.equal(summary.n, 3)
  assert.equal(summary.mean, 2)
  assert.ok(Math.abs(summary.sd - 1) < 1e-9)
  assert.equal(summary.min, 1)
  assert.equal(summary.max, 3)
  assert.equal(summary.smallSample, false)
  assert.ok(summary.ci95[0] < summary.mean && summary.ci95[1] > summary.mean)
  const empty = summarize([])
  assert.equal(empty.n, 0)
  assert.equal(empty.mean, null)
  assert.equal(empty.ci95, null)
  const single = summarize([5])
  assert.equal(single.n, 1)
  assert.equal(single.ci95, null)
  assert.equal(single.smallSample, true)
})

test('pairwise comparison reports difference, CI, effect size and p', () => {
  const experiment = {
    id: 'exp-pair',
    name: 'Pairwise',
    factors: [{ key: 'k' }],
    metrics: [{ key: 'm', direction: 'max' }],
    runs: [
      { id: 'a1', status: 'ok', params: { k: 1 }, metrics: { m: 1 } },
      { id: 'a2', status: 'ok', params: { k: 1 }, metrics: { m: 2 } },
      { id: 'a3', status: 'ok', params: { k: 1 }, metrics: { m: 3 } },
      { id: 'b1', status: 'ok', params: { k: 2 }, metrics: { m: 4 } },
      { id: 'b2', status: 'ok', params: { k: 2 }, metrics: { m: 5 } },
      { id: 'b3', status: 'ok', params: { k: 2 }, metrics: { m: 6 } },
    ],
  }
  const comparison = compareRuns(experiment, { groupBy: ['k'], compareGroups: ['k=1', 'k=2'] })
  assert.ok(comparison.pairwise !== null)
  const test = comparison.pairwise.metrics.m
  assert.equal(test.difference, -3)
  assert.ok(Math.abs(test.p - 0.021) < 0.01)
  assert.ok(test.ci95[0] < test.difference && test.ci95[1] < 0)
  assert.ok(test.cohenD < 0)
  const text = formatComparison(experiment, comparison)
  assert.match(text, /pairwise: k=1 vs k=2/)
  assert.match(text, /95% CI/)
  assert.match(text, /d=/)
})

test('compareRuns groups by the varying factor and finds the best run', () => {
  const experiment = demoExperiment()
  assert.deepEqual(varyingFactors(experiment), ['kp'])
  const comparison = compareRuns(experiment, {})
  assert.deepEqual(comparison.groupBy, ['kp'])
  assert.equal(comparison.groups.length, 2)
  const group = comparison.groups.find((entry) => entry.label === 'kp=1.2')
  assert.equal(group.runs, 2)
  assert.equal(group.stats.overshoot.mean, 4.2)
  assert.equal(group.stats.overshoot.sd, 0)
  const first = comparison.groups.find((entry) => entry.label === 'kp=0.8')
  assert.equal(first.stats.overshoot.n, 2)
  const overshootBest = comparison.best.find((entry) => entry.metric === 'overshoot')
  assert.equal(overshootBest.runId, 'run-3')
  assert.equal(overshootBest.value, 4.2)
})

test('compareRuns can put every run in one group and follow an explicit groupBy', () => {
  const experiment = demoExperiment()
  const all = compareRuns(experiment, { groupBy: [] })
  assert.equal(all.groups.length, 1)
  assert.equal(all.groups[0].label, 'all runs')
  const byKi = compareRuns(experiment, { groupBy: ['ki'] })
  assert.equal(byKi.groups.length, 1)
  assert.match(byKi.groups[0].label, /ki=0\.2/)
})

test('formatComparison is bounded and names the best runs', () => {
  const experiment = demoExperiment()
  const text = formatComparison(experiment, compareRuns(experiment, {}))
  assert.match(text, /Comparison exp-demo: PID tuning/)
  assert.match(text, /grouped by kp/)
  assert.match(text, /kp=0\.8/)
  assert.match(text, /12±0\.566/)
  assert.match(text, /best:/)
  assert.match(text, /run-3/)
})

test('buildReport contains the four sections and the comparison table', () => {
  const report = buildReport(demoExperiment(), {})
  assert.match(report.markdown, /^# PID tuning/)
  assert.match(report.markdown, /## Design/)
  assert.match(report.markdown, /## Runs/)
  assert.match(report.markdown, /## Comparison/)
  assert.match(report.markdown, /## Artifacts/)
  assert.match(report.markdown, /4\.2 ± 0|4\.2 ± 0\.0/)
  assert.match(report.markdown, /Best runs:/)
})

test('writeReport writes report.md and returns its digest', async () => {
  const root = await fsp.mkdtemp(join(tmpdir(), 'exp-report-'))
  const experiment = demoExperiment()
  const report = await writeReport(root, experiment, {})
  const text = await fsp.readFile(report.path, 'utf8')
  assert.match(text, /# PID tuning/)
  assert.equal(report.sha256.length, 64)
  assert.ok(report.bytes > 100)
  assert.equal(report.summary.runs, 4)
  assert.match(report.relative, /^reports[\\/].+report\.md$/)
})
