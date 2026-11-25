/**
 * Tests for SQL metrics over delimited datasets.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDelimited, openDatasetDb, computeSqlMetrics } from '../lib/sql.js'
import { normalizeMetricDefs } from '../lib/model.js'

/**
 * @returns {Promise<string>} a fresh temporary directory.
 */
async function tempDir() {
  return await fsp.mkdtemp(join(tmpdir(), 'exp-sql-'))
}

test('parseDelimited handles quotes, escaped quotes and CRLF', () => {
  const rows = parseDelimited('a,b\r\n"x,1","y""q"\r\n', ',')
  assert.deepEqual(rows, [['a', 'b'], ['x,1', 'y"q']])
})

test('openDatasetDb loads a CSV with typed cells', async () => {
  const dir = await tempDir()
  const file = join(dir, 'data.csv')
  await fsp.writeFile(file, 'x,y,name\n1,2.5,a\n2,,b\n', 'utf8')
  const opened = openDatasetDb(file, 'csv')
  try {
    assert.equal(opened.rows, 2)
    assert.deepEqual(opened.columns, ['x', 'y', 'name'])
    const row = opened.db.prepare('SELECT x, y, name FROM data WHERE x = 2').get()
    assert.equal(row.x, 2)
    assert.equal(row.y, null)
    assert.equal(row.name, 'b')
  } finally {
    opened.db.close()
  }
})

test('computeSqlMetrics runs one query per metric and supports column selection', async () => {
  const dir = await tempDir()
  const file = join(dir, 'data.csv')
  await fsp.writeFile(file, 'x,y\n1,1\n2,3\n', 'utf8')
  const experiment = {
    metrics: [
      { key: 'avg_y', sql: 'SELECT avg(y) AS v FROM data', dataset: file },
      { key: 'min_y', sql: 'SELECT max(y) AS hi, min(y) AS lo FROM data', dataset: file, column: 'lo' },
    ],
  }
  const result = await computeSqlMetrics(experiment, { cwd: dir, root: dir })
  assert.deepEqual(result.errors, [])
  assert.equal(result.values.avg_y, 2)
  assert.equal(result.values.min_y, 1)
  assert.deepEqual(result.datasets, [file])
})

test('computeSqlMetrics resolves datasetId through the ledger registry', async () => {
  const dir = await tempDir()
  const file = join(dir, 'data.csv')
  await fsp.writeFile(file, 'x,y\n1,2\n3,4\n', 'utf8')
  const experiment = { metrics: [{ key: 'avg_y', sql: 'SELECT avg(y) AS v FROM data', datasetId: 'ds-test' }] }
  const result = await computeSqlMetrics(experiment, {
    cwd: dir,
    root: dir,
    ledger: { datasets: [{ id: 'ds-test', path: file, name: 'data.csv' }] },
  })
  assert.deepEqual(result.errors, [])
  assert.equal(result.values.avg_y, 3)
  assert.deepEqual(result.datasets, [file])

  const missing = await computeSqlMetrics(experiment, { cwd: dir, root: dir, ledger: { datasets: [] } })
  assert.equal(missing.errors.length, 1)
  assert.match(missing.errors[0].error, /dataset id not found/)
})

test('computeSqlMetrics resolves dataConsole names against the live file list', async () => {
  const home = await tempDir()
  const dir = await tempDir()
  const file = join(dir, 'live.csv')
  await fsp.writeFile(file, 'x,y\n1,2\n3,4\n', 'utf8')
  await fsp.mkdir(join(home, 'data-console'), { recursive: true })
  await fsp.writeFile(join(home, 'data-console', 'datasets.json'), JSON.stringify({ open: [{ path: file, name: 'live.csv' }], recent: [] }), 'utf8')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const result = await computeSqlMetrics({
      metrics: [{ key: 'avg_y', sql: 'SELECT avg(y) AS value FROM data', dataConsole: 'live.csv' }],
    }, { cwd: dir, root: dir })
    assert.deepEqual(result.errors, [])
    assert.equal(result.values.avg_y, 3)

    const missing = await computeSqlMetrics({
      metrics: [{ key: 'avg_y', sql: 'SELECT avg(y) AS value FROM data', dataConsole: 'missing.csv' }],
    }, { cwd: dir, root: dir })
    assert.equal(missing.errors.length, 1)
    assert.match(missing.errors[0].error, /data-console dataset not found/)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('computeSqlMetrics reports missing datasets and unsupported formats', async () => {
  const dir = await tempDir()
  const missing = await computeSqlMetrics({
    metrics: [{ key: 'v', sql: 'SELECT 1 AS v', dataset: 'nope.csv' }],
  }, { cwd: dir, root: dir })
  assert.equal(missing.errors.length, 1)
  assert.match(missing.errors[0].error, /dataset not found/)

  const excel = join(dir, 'data.xlsx')
  await fsp.writeFile(excel, 'not really excel', 'utf8')
  const unsupported = await computeSqlMetrics({
    metrics: [{ key: 'v', sql: 'SELECT 1 AS v', dataset: excel }],
  }, { cwd: dir, root: dir })
  assert.equal(unsupported.errors.length, 1)
  assert.match(unsupported.errors[0].error, /CSV\/TSV/)
})

test('normalizeMetricDefs validates sql metrics', () => {
  const metrics = normalizeMetricDefs([
    { key: 'y', sql: 'SELECT avg(y) FROM data', dataset: 'data.csv', direction: 'min' },
  ])
  assert.equal(metrics[0].sql, 'SELECT avg(y) FROM data')
  assert.equal(metrics[0].dataset, 'data.csv')

  assert.throws(() => normalizeMetricDefs([{ key: 'y', sql: 'SELECT 1' }]), /needs a dataset/)
  assert.throws(() => normalizeMetricDefs([{ key: 'y', dataset: 'data.csv' }]), /without sql|no sql/)
  assert.throws(() => normalizeMetricDefs([{ key: 'y', sql: 'SELECT 1; SELECT 2', dataset: 'data.csv' }]), /single statement/)
})
