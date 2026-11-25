/**
 * Unit tests for the experiment-ledger primitives. Run with `npm test` or
 * `node --test test/ledger.test.mjs`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLedger, saveLedger, resolveRoot, ledgerFilePath } from '../lib/store.js'
import {
  normalizeFactors,
  normalizeMetricDefs,
  normalizeParams,
  normalizeMetrics,
  parseMetricsText,
  mergeMetrics,
  formatExperimentDetail,
  formatRunDetail,
  summarizeExperiment,
} from '../lib/model.js'
import { runCommand, hashFile } from '../lib/runner.js'

/**
 * @returns {Promise<string>} a fresh temporary directory.
 */
async function tempDir() {
  return await fsp.mkdtemp(join(tmpdir(), 'exp-ledger-'))
}

test('resolveRoot defaults to .experiments under the cwd', () => {
  assert.equal(resolveRoot(undefined, 'C:\\work\\project'), 'C:\\work\\project\\.experiments')
  assert.equal(resolveRoot('ledger', 'C:\\work\\project'), 'C:\\work\\project\\ledger')
})

test('saveLedger and loadLedger round-trip, and a broken file is not overwritten', async () => {
  const dir = await tempDir()
  const ledger = { experiments: [{ id: 'exp-1', name: 'demo', runs: [] }] }
  await saveLedger(dir, ledger)
  const loaded = await loadLedger(dir)
  assert.equal(loaded.experiments.length, 1)
  assert.equal(loaded.experiments[0].name, 'demo')

  await fsp.writeFile(ledgerFilePath(dir), '{ not json', 'utf8')
  await assert.rejects(() => loadLedger(dir), /not valid JSON/)
  assert.equal(await fsp.readFile(ledgerFilePath(dir), 'utf8'), '{ not json')
})

test('missing ledger reads as empty', async () => {
  const dir = await tempDir()
  const loaded = await loadLedger(dir)
  assert.deepEqual(loaded.experiments, [])
})

test('normalizeFactors accepts strings and objects and rejects invalid keys', () => {
  const factors = normalizeFactors(['kp', { key: 'ki', label: 'Ki gain', unit: '1/s' }, 'kp'])
  assert.equal(factors.length, 2)
  assert.deepEqual(factors[0], { key: 'kp', label: 'kp' })
  assert.deepEqual(factors[1], { key: 'ki', label: 'Ki gain', unit: '1/s' })
  assert.throws(() => normalizeFactors(['1bad']), /invalid key/)
})

test('normalizeMetricDefs validates direction', () => {
  const metrics = normalizeMetricDefs([{ key: 'overshoot', unit: '%', direction: 'min' }])
  assert.deepEqual(metrics[0], { key: 'overshoot', label: 'overshoot', direction: 'min', unit: '%' })
  assert.throws(() => normalizeMetricDefs([{ key: 'x', direction: 'down' }]), /invalid metric direction/)
})

test('normalizeParams rejects nested objects and arrays', () => {
  assert.deepEqual(normalizeParams({ a: 1, b: 'x', c: true }), { a: 1, b: 'x', c: true })
  assert.throws(() => normalizeParams([1, 2]), /params must be an object/)
  assert.throws(() => normalizeParams({ a: { b: 1 } }), /string, number or boolean/)
})

test('parseMetricsText reads the last EXP_METRICS line and ignores bad JSON', () => {
  const text = [
    'start',
    'EXP_METRICS: {"overshoot": 6.1}',
    'more',
    'EXP_METRICS {"overshoot": 4.2, "settling": 0.8}',
    'EXP_METRICS: {broken',
    'EXP_METRICS: {"ignored": {"nested": 1}, "ok": 2}',
  ].join('\n')
  assert.deepEqual(parseMetricsText(text), { overshoot: 4.2, settling: 0.8, ok: 2 })
})

test('mergeMetrics lets later sources win', () => {
  assert.deepEqual(mergeMetrics({ a: 1, b: 2 }, { b: 3 }, { c: 4 }), { a: 1, b: 3, c: 4 })
})

test('summarizeExperiment and detail formatters stay bounded', () => {
  const experiment = {
    id: 'exp-1',
    name: 'PID',
    description: 'tune it',
    factors: [{ key: 'kp', label: 'kp' }],
    metrics: [{ key: 'overshoot', direction: 'min', label: 'overshoot' }],
    updatedAt: 1,
    runs: [
      { id: 'run-1', label: 'a', status: 'ok', durationMs: 1200, params: { kp: 1 }, metrics: { overshoot: 4.2 } },
      { id: 'run-2', label: 'b', status: 'failed', durationMs: 500, params: {}, metrics: {}, artifacts: [{ path: 'x', missing: true }], notes: 'why' },
    ],
  }
  assert.equal(summarizeExperiment(experiment).runs, 2)
  const detail = formatExperimentDetail(experiment, 10)
  assert.match(detail, /Experiment exp-1: PID/)
  assert.match(detail, /overshoot=4\.2/)
  const runDetail = formatRunDetail(experiment.runs[1])
  assert.match(runDetail, /Run run-2 \(failed\)/)
  assert.match(runDetail, /x \(missing\)/)
})

test('runCommand captures stdout, metrics and exit status', async () => {
  const dir = await tempDir()
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, [
    "console.log('EXP_METRICS: {\"overshoot\": 4.2, \"settling\": 0.8}')",
    "console.log('done')",
    '',
  ].join('\n'), 'utf8')
  const result = await runCommand({
    command: `"${process.execPath}" "${script}"`,
    cwd: dir,
    runDir: join(dir, 'run'),
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.exitCode, 0)
  assert.match(result.stdoutTail, /done/)
  const metrics = parseMetricsText(result.stdoutTail)
  assert.deepEqual(metrics, { overshoot: 4.2, settling: 0.8 })
})

test('runCommand reports a non-zero exit as failed', async () => {
  const dir = await tempDir()
  const script = join(dir, 'fail.mjs')
  await fsp.writeFile(script, 'process.exit(3)\n', 'utf8')
  const result = await runCommand({
    command: `"${process.execPath}" "${script}"`,
    cwd: dir,
    runDir: join(dir, 'run'),
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.exitCode, 3)
})

test('hashFile returns a stable digest', async () => {
  const dir = await tempDir()
  const file = join(dir, 'artifact.txt')
  await fsp.writeFile(file, 'hello\n', 'utf8')
  const first = await hashFile(file)
  const second = await hashFile(file)
  assert.equal(first.sha256, second.sha256)
  assert.equal(first.bytes, 6)
})
