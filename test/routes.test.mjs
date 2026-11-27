/**
 * Tests for the panel write routes: candidates, promote and report.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'

process.env.DSH_HOME = await fsp.mkdtemp(join(tmpdir(), 'exp-routes-home-'))

import { apply } from '../index.js'
import { recordCandidate, listCandidates } from '../lib/recorder.js'

/**
 * Mount the plugin and capture its routes.
 * @returns {Promise<{tools: Map<string, object>, routes: Map<string, Function>}>} the harness.
 */
async function mount(options = {}) {
  const tools = new Map()
  const routes = new Map()
  const ctx = {
    effect: (fn) => fn(),
    on: () => () => {},
    tools: { register: (definition) => tools.set(definition.name, definition) },
    webServer: {
      register: (definition) => {
        routes.set(definition.path, definition.handler)
        return () => {}
      },
    },
    connection: options.connection ?? { requestRejection: () => undefined },
    logger: { warn: () => {} },
  }
  apply(ctx, { recorder: false, scheduler: false })
  return { tools, routes }
}

/**
 * @param cwd - session directory.
 * @returns {object} a tool execution context.
 */
function execAt(cwd) {
  return { agent: { session: { header: { cwd, id: 'session-routes' } } } }
}

/**
 * Build a mock request.
 * @param method - HTTP method.
 * @param url - request path.
 * @param body - optional JSON body.
 * @returns {Readable} the request stream with method/url/headers.
 */
function fakeReq(method, url, body) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  stream.method = method
  stream.url = url
  stream.headers = { 'x-dsh-experiment-ledger': '1', host: '127.0.0.1:1' }
  return stream
}

/**
 * Call one captured route.
 * @param handler - route handler.
 * @param method - HTTP method.
 * @param url - path.
 * @param body - JSON body.
 * @returns {Promise<{status: number, payload: object}>} the response.
 */
async function call(handler, method, url, body) {
  const response = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status },
    end(chunk) { this.body = chunk ?? '' },
  }
  await handler(fakeReq(method, url, body), response)
  return { status: response.status, payload: response.body === '' ? {} : JSON.parse(response.body) }
}

/**
 * @param ms - milliseconds.
 * @returns {Promise<void>} resolution after the wait.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('panel routes refuse a request rejected by the DSH connection admission', async () => {
  const { routes } = await mount({ connection: { requestRejection: () => 403 } })
  const base = '/plugin-experiment-ledger'
  const response = await call(routes.get(`${base}/list`), 'GET', `${base}/list`)
  assert.equal(response.status, 403)
})

test('panel routes list, promote and report', async () => {  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-routes-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'

  const defined = await tools.get('exp_define').execute({ name: 'Route demo', metrics: ['acc'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  const ledgerRoot = join(dir, '.experiments')
  const candidate = await recordCandidate({
    tool: 'pwsh',
    command: 'node train.js --epochs 3',
    cwd: dir,
    status: 'ok',
    durationMs: 1200,
    at: Date.now(),
  })

  const listed = await call(routes.get(`${base}/candidates`), 'GET', `${base}/candidates`)
  assert.equal(listed.status, 200)
  assert.equal(listed.payload.candidates.length, 1)
  assert.equal(listed.payload.candidates[0].id, candidate.id)

  const promoted = await call(routes.get(`${base}/promote`), 'POST', `${base}/promote`, {
    root: ledgerRoot,
    candidateId: candidate.id,
    experimentId,
  })
  assert.equal(promoted.status, 200, JSON.stringify(promoted.payload))
  assert.equal(promoted.payload.ok, true)
  assert.match(promoted.payload.run.id, /^run-/)
  assert.equal((await listCandidates(5)).length, 0)

  const reported = await call(routes.get(`${base}/report`), 'POST', `${base}/report`, {
    root: ledgerRoot,
    experimentId,
  })
  assert.equal(reported.status, 200)
  assert.ok(existsSync(reported.payload.report.path))
  assert.match(reported.payload.report.relative, /report\.md$/)

  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].runs.length, 1)
  assert.equal(ledger.experiments[0].runs[0].executor.kind, 'tool')
  assert.equal(ledger.experiments[0].reports.length, 1)

  const missing = await call(routes.get(`${base}/promote`), 'POST', `${base}/promote`, {
    root: ledgerRoot,
    candidateId: 'cand-missing',
    experimentId,
  })
  assert.equal(missing.status, 404)
  assert.equal(missing.payload.ok, false)
})

test('panel sweep route starts a job and reports completion', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-sweep-route-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')
  const defined = await tools.get('exp_define').execute({
    name: 'Sweep route',
    factors: ['k'],
    metrics: [{ key: 'm', direction: 'max' }],
  }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"m\": ' + Number(process.env.EXP_PARAM_K) + '}')\n", 'utf8')

  const started = await call(routes.get(`${base}/sweep`), 'POST', `${base}/sweep`, {
    root: ledgerRoot,
    experimentId,
    command: `"${process.execPath}" "${script}"`,
    grid: { k: [1, 2, 3] },
    maxParallel: 1,
  })
  assert.equal(started.status, 200)
  const jobId = started.payload.job.id
  let job = started.payload.job
  for (let attempt = 0; attempt < 100 && job.status === 'running'; attempt += 1) {
    await sleep(50)
    const status = await call(routes.get(`${base}/sweep/status`), 'GET', `${base}/sweep/status?jobId=${encodeURIComponent(jobId)}`)
    job = status.payload.job
  }
  assert.equal(job.status, 'done')
  assert.equal(job.done, 3)
  assert.equal(job.runs.length, 3)
  const ledger = JSON.parse(await fsp.readFile(join(ledgerRoot, 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].runs.length, 3)
  assert.deepEqual(ledger.experiments[0].runs.map((run) => run.metrics.m), [1, 2, 3])
})

test('panel sweep route can stop a running job', async () => {  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-sweep-stop-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')
  const defined = await tools.get('exp_define').execute({ name: 'Stop sweep' }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]

  const started = await call(routes.get(`${base}/sweep`), 'POST', `${base}/sweep`, {
    root: ledgerRoot,
    experimentId,
    command: `"${process.execPath}" -e "setTimeout(function(){}, 400)"`,
    grid: { k: [1, 2, 3, 4] },
    maxParallel: 1,
  })
  assert.equal(started.status, 200)
  const jobId = started.payload.job.id

  const stopped = await call(routes.get(`${base}/sweep/stop`), 'POST', `${base}/sweep/stop`, { jobId })
  assert.equal(stopped.status, 200)
  assert.equal(stopped.payload.ok, true)

  let job = stopped.payload.job
  for (let attempt = 0; attempt < 100 && job.status === 'running'; attempt += 1) {
    await sleep(50)
    const status = await call(routes.get(`${base}/sweep/status`), 'GET', `${base}/sweep/status?jobId=${encodeURIComponent(jobId)}`)
    job = status.payload.job
  }
  assert.equal(job.status, 'stopped')
  assert.equal(job.stopped, true)
  assert.ok(job.done < 4)
})

test('panel baseline routes set, list and clear', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-baseline-route-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')

  const target = await tools.get('exp_define').execute({ name: 'Target', metrics: ['m'] }, exec)
  const targetId = target.match(/Experiment (exp-[\w-]+)/)[1]
  const source = await tools.get('exp_define').execute({ name: 'Source', metrics: ['m'] }, exec)
  const sourceId = source.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_record').execute({ experimentId: sourceId, label: 'base', metrics: { m: 5 } }, exec)

  const set = await call(routes.get(`${base}/baseline`), 'POST', `${base}/baseline`, {
    root: ledgerRoot,
    experimentId: targetId,
    baselineExperimentId: sourceId,
    name: 'reference',
  })
  assert.equal(set.status, 200)
  assert.equal(set.payload.baselines.length, 1)
  assert.equal(set.payload.baselines[0].name, 'reference')
  assert.equal(set.payload.baselines[0].metrics.m, 5)
  assert.match(set.payload.baselines[0].runId, /^run-/)

  const second = await call(routes.get(`${base}/baseline`), 'POST', `${base}/baseline`, {
    root: ledgerRoot,
    experimentId: targetId,
    baselineExperimentId: sourceId,
    name: 'second',
  })
  assert.equal(second.payload.baselines.length, 2)

  const options = await call(routes.get(`${base}/baseline/options`), 'GET', `${base}/baseline/options?root=${encodeURIComponent(ledgerRoot)}`)
  assert.equal(options.status, 200)
  const sourceOptions = options.payload.experiments.find((experiment) => experiment.id === sourceId)
  assert.equal(sourceOptions.runs.length, 1)

  const removed = await call(routes.get(`${base}/baseline`), 'POST', `${base}/baseline`, {
    root: ledgerRoot,
    experimentId: targetId,
    clear: true,
    baselineId: second.payload.baselines[0].id,
  })
  assert.equal(removed.payload.baselines.length, 1)

  const cleared = await call(routes.get(`${base}/baseline`), 'POST', `${base}/baseline`, {
    root: ledgerRoot,
    experimentId: targetId,
    clear: true,
  })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.payload.baselines.length, 0)
  assert.equal(cleared.payload.baseline, null)
})

test('report open returns the latest report path without launching', async () => {  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-open-report-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')
  const defined = await tools.get('exp_define').execute({ name: 'Open report' }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_record').execute({ experimentId, metrics: { m: 1 } }, exec)

  const missing = await call(routes.get(`${base}/report/open`), 'POST', `${base}/report/open`, {
    root: ledgerRoot,
    experimentId,
  })
  assert.equal(missing.status, 404)

  await call(routes.get(`${base}/report`), 'POST', `${base}/report`, { root: ledgerRoot, experimentId })
  process.env.DSH_EXPERIMENT_LEDGER_NO_OPEN = '1'
  try {
    const opened = await call(routes.get(`${base}/report/open`), 'POST', `${base}/report/open`, {
      root: ledgerRoot,
      experimentId,
    })
    assert.equal(opened.status, 200)
    assert.equal(opened.payload.skipped, true)
    assert.ok(existsSync(opened.payload.opened))
  } finally {
    delete process.env.DSH_EXPERIMENT_LEDGER_NO_OPEN
  }
})

test('panel compare/experiments route returns a group matrix', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-multi-compare-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')

  const first = await tools.get('exp_define').execute({
    name: 'First',
    factors: ['k'],
    metrics: [{ key: 'm', direction: 'max' }],
  }, exec)
  const firstId = first.match(/Experiment (exp-[\w-]+)/)[1]
  const second = await tools.get('exp_define').execute({
    name: 'Second',
    factors: ['k'],
    metrics: [{ key: 'm', direction: 'max' }],
  }, exec)
  const secondId = second.match(/Experiment (exp-[\w-]+)/)[1]

  for (const [experimentId, k, m] of [[firstId, 1, 2], [firstId, 2, 4], [secondId, 1, 3], [secondId, 2, 5]]) {
    await tools.get('exp_record').execute({ experimentId, params: { k }, metrics: { m } }, exec)
  }

  const grouped = await call(
    routes.get(`${base}/compare/experiments`),
    'GET',
    `${base}/compare/experiments?root=${encodeURIComponent(ledgerRoot)}&ids=${firstId},${secondId}&groupBy=k`,
  )
  assert.equal(grouped.status, 200)
  assert.deepEqual(grouped.payload.groupBy, ['k'])
  assert.deepEqual(grouped.payload.labels, ['k=1', 'k=2'])
  assert.equal(grouped.payload.experiments.length, 2)
  const firstGroups = grouped.payload.experiments[0].groups
  const firstOne = firstGroups.find((group) => group.label === 'k=1')
  assert.equal(firstOne.stats.m.mean, 2)

  const flat = await call(
    routes.get(`${base}/compare/experiments`),
    'GET',
    `${base}/compare/experiments?root=${encodeURIComponent(ledgerRoot)}&ids=${firstId},${secondId}`,
  )
  assert.deepEqual(flat.payload.labels, ['all runs'])

  const tooFew = await call(
    routes.get(`${base}/compare/experiments`),
    'GET',
    `${base}/compare/experiments?root=${encodeURIComponent(ledgerRoot)}&ids=${firstId}`,
  )
  assert.equal(tooFew.status, 400)
})

test('panel preset route saves and deletes a sweep preset', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-preset-route-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')
  const defined = await tools.get('exp_define').execute({ name: 'Preset' }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]

  const saved = await call(routes.get(`${base}/preset`), 'POST', `${base}/preset`, {
    root: ledgerRoot,
    experimentId,
    action: 'save',
    name: 'quick',
    command: 'node job.js --k {k}',
    grid: { k: [1, 2] },
    maxParallel: 2,
    failFast: true,
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.payload.presets.length, 1)
  assert.equal(saved.payload.presets[0].name, 'quick')
  assert.deepEqual(saved.payload.presets[0].grid, { k: [1, 2] })
  assert.equal(saved.payload.presets[0].maxParallel, 2)

  const deleted = await call(routes.get(`${base}/preset`), 'POST', `${base}/preset`, {
    root: ledgerRoot,
    experimentId,
    action: 'delete',
    presetId: saved.payload.presets[0].id,
  })
  assert.equal(deleted.status, 200)
  assert.equal(deleted.payload.presets.length, 0)
})

test('panel compare export writes CSV and Markdown', async () => {  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-export-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')

  const first = await tools.get('exp_define').execute({
    name: 'First', factors: ['k'], metrics: [{ key: 'm', direction: 'max' }],
  }, exec)
  const firstId = first.match(/Experiment (exp-[\w-]+)/)[1]
  const second = await tools.get('exp_define').execute({
    name: 'Second', factors: ['k'], metrics: [{ key: 'm', direction: 'max' }],
  }, exec)
  const secondId = second.match(/Experiment (exp-[\w-]+)/)[1]
  for (const [experimentId, k, m] of [[firstId, 1, 2], [firstId, 2, 4], [secondId, 1, 3], [secondId, 2, 5]]) {
    await tools.get('exp_record').execute({ experimentId, params: { k }, metrics: { m } }, exec)
  }

  const csv = await call(routes.get(`${base}/compare/export`), 'POST', `${base}/compare/export`, {
    root: ledgerRoot,
    ids: [firstId, secondId],
    metric: 'm',
    groupBy: ['k'],
    format: 'csv',
  })
  assert.equal(csv.status, 200, JSON.stringify(csv.payload))
  const csvText = await fsp.readFile(csv.payload.file.path, 'utf8')
  assert.match(csvText, /^group,First mean,First sd,First n,Second mean,Second sd,Second n/)
  assert.match(csvText, /k=1,2,0,1,3,0,1/)

  const md = await call(routes.get(`${base}/compare/export`), 'POST', `${base}/compare/export`, {
    root: ledgerRoot,
    ids: [firstId, secondId],
    metric: 'm',
    groupBy: ['k'],
    format: 'md',
  })
  assert.equal(md.status, 200)
  const mdText = await fsp.readFile(md.payload.file.path, 'utf8')
  assert.match(mdText, /\| Group \| First \| Second \|/)
  assert.match(mdText, /k=2/)

  process.env.DSH_EXPERIMENT_LEDGER_NO_OPEN = '1'
  try {
    const opened = await call(routes.get(`${base}/compare/open`), 'POST', `${base}/compare/open`, {
      root: ledgerRoot,
      path: csv.payload.file.relative,
    })
    assert.equal(opened.status, 200)
    assert.equal(opened.payload.skipped, true)
  } finally {
    delete process.env.DSH_EXPERIMENT_LEDGER_NO_OPEN
  }

  const bad = await call(routes.get(`${base}/compare/export`), 'POST', `${base}/compare/export`, {
    root: ledgerRoot,
    ids: [firstId, secondId],
    metric: 'nope',
  })
  assert.equal(bad.status, 400)
})

test('panel compare routes accept cross-project refs and write a report', async () => {
  const dirA = await fsp.mkdtemp(join(tmpdir(), 'exp-cross-a-'))
  const dirB = await fsp.mkdtemp(join(tmpdir(), 'exp-cross-b-'))
  const { tools, routes } = await mount()
  const base = '/plugin-experiment-ledger'
  const ledgerA = join(dirA, '.experiments')
  const ledgerB = join(dirB, '.experiments')

  const alpha = await tools.get('exp_define').execute({ name: 'Alpha', metrics: ['m'] }, execAt(dirA))
  const alphaId = alpha.match(/Experiment (exp-[\w-]+)/)[1]
  const beta = await tools.get('exp_define').execute({ name: 'Beta', metrics: ['m'] }, execAt(dirB))
  const betaId = beta.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_record').execute({ experimentId: alphaId, metrics: { m: 1 } }, execAt(dirA))
  await tools.get('exp_record').execute({ experimentId: betaId, metrics: { m: 2 } }, execAt(dirB))

  const refs = [
    { root: ledgerA, experimentId: alphaId },
    { root: ledgerB, experimentId: betaId },
  ]
  const compared = await call(routes.get(`${base}/compare`), 'POST', `${base}/compare`, { refs })
  assert.equal(compared.status, 200)
  assert.equal(compared.payload.experiments.length, 2)
  assert.deepEqual(compared.payload.experiments.map((entry) => entry.root), [ledgerA, ledgerB])

  const report = await call(routes.get(`${base}/compare/report`), 'POST', `${base}/compare/report`, {
    root: ledgerA,
    refs,
  })
  assert.equal(report.status, 200)
  const reportText = await fsp.readFile(report.payload.report.path, 'utf8')
  assert.match(reportText, /# Multi-experiment comparison/)
  assert.match(reportText, /Alpha/)
  assert.match(reportText, /Beta/)
  assert.ok(report.payload.report.summary.metrics >= 1)

  const archived = await call(
    routes.get(`${base}/compare/reports`),
    'GET',
    `${base}/compare/reports?root=${encodeURIComponent(ledgerA)}`,
  )
  assert.equal(archived.status, 200)
  assert.equal(archived.payload.reports.length, 1)
  assert.equal(archived.payload.reports[0].refs.length, 2)

  const exported = await call(routes.get(`${base}/compare/export`), 'POST', `${base}/compare/export`, {
    root: ledgerA,
    refs,
    metric: 'm',
    format: 'csv',
  })
  assert.equal(exported.status, 200)
  assert.ok(existsSync(exported.payload.file.path))

  const all = await call(routes.get(`${base}/all-experiments`), 'GET', `${base}/all-experiments`)
  assert.equal(all.status, 200)
  assert.ok(all.payload.roots.some((entry) => entry.root === ledgerA))
  assert.ok(all.payload.roots.some((entry) => entry.root === ledgerB))

  process.env.DSH_EXPERIMENT_LEDGER_NO_OPEN = '1'
  try {
    const opened = await call(routes.get(`${base}/compare/report/open`), 'POST', `${base}/compare/report/open`, {
      root: ledgerA,
      path: report.payload.report.relative,
    })
    assert.equal(opened.status, 200)
    assert.equal(opened.payload.skipped, true)
  } finally {
    delete process.env.DSH_EXPERIMENT_LEDGER_NO_OPEN
  }
})

test('panel schedule route saves, toggles, runs and deletes', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-schedule-route-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"m\": ' + Number(process.env.EXP_PARAM_K) + '}')\n", 'utf8')

  const defined = await tools.get('exp_define').execute({
    name: 'Scheduled', factors: ['k'], metrics: [{ key: 'm', direction: 'max' }],
  }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_presets').execute({
    experimentId,
    action: 'save',
    name: 'quick',
    command: `"${process.execPath}" "${script}"`,
    grid: { k: [1, 2] },
    maxParallel: 1,
  }, exec)

  const saved = await call(routes.get(`${base}/schedule`), 'POST', `${base}/schedule`, {
    root: ledgerRoot,
    experimentId,
    action: 'save',
    name: 'nightly',
    preset: 'quick',
    intervalMinutes: 60,
    retryLimit: 2,
    retryDelayMs: 10000,
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.payload.schedules.length, 1)
  assert.equal(saved.payload.schedules[0].enabled, true)
  assert.equal(saved.payload.schedules[0].retryLimit, 2)
  assert.ok(saved.payload.schedules[0].nextRunAt > Date.now())

  const toggled = await call(routes.get(`${base}/schedule`), 'POST', `${base}/schedule`, {
    root: ledgerRoot,
    experimentId,
    action: 'toggle',
    scheduleId: saved.payload.schedules[0].id,
    enabled: false,
  })
  assert.equal(toggled.payload.schedules[0].enabled, false)

  const ran = await call(routes.get(`${base}/schedule`), 'POST', `${base}/schedule`, {
    root: ledgerRoot,
    experimentId,
    action: 'run',
    scheduleId: saved.payload.schedules[0].id,
  })
  assert.equal(ran.status, 200)
  const jobId = ran.payload.job.id
  let job = ran.payload.job
  for (let attempt = 0; attempt < 100 && job.status === 'running'; attempt += 1) {
    await sleep(50)
    job = (await call(routes.get(`${base}/sweep/status`), 'GET', `${base}/sweep/status?jobId=${encodeURIComponent(jobId)}`)).payload.job
  }
  assert.equal(job.status, 'done')
  assert.equal(job.done, 2)
  const ledger = JSON.parse(await fsp.readFile(join(ledgerRoot, 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].runs.length, 2)
  assert.equal(ledger.experiments[0].schedules[0].lastJobId, jobId)

  const detail = await call(
    routes.get(`${base}/experiment`),
    'GET',
    `${base}/experiment?root=${encodeURIComponent(ledgerRoot)}&id=${experimentId}`,
  )
  assert.equal(detail.payload.experiment.schedules[0].history.length, 1)
  assert.equal(detail.payload.experiment.schedules[0].lastStatus, 'done')
  assert.ok(typeof detail.payload.experiment.schedules[0].history[0].durationMs === 'number')
  assert.equal(detail.payload.experiment.schedules[0].history[0].metrics.m, 1.5)

  const notifications = await call(
    routes.get(`${base}/notifications`),
    'GET',
    `${base}/notifications?root=${encodeURIComponent(ledgerRoot)}`,
  )
  assert.equal(notifications.status, 200)
  assert.equal(notifications.payload.unread, 1)
  assert.match(notifications.payload.notifications[0].text, /finished/)

  const read = await call(routes.get(`${base}/notifications/read`), 'POST', `${base}/notifications/read`, {
    root: ledgerRoot,
  })
  assert.equal(read.payload.unread, 0)

  const report = await call(routes.get(`${base}/schedule`), 'POST', `${base}/schedule`, {
    root: ledgerRoot,
    experimentId,
    action: 'report',
    scheduleId: saved.payload.schedules[0].id,
  })
  assert.equal(report.status, 200)
  assert.equal(report.payload.report.summary.runs, 1)
  const reportText = await fsp.readFile(report.payload.report.path, 'utf8')
  assert.match(reportText, /## History/)
  assert.match(reportText, /## Duration trend/)
  assert.match(reportText, /chart\.svg/)
  assert.ok(existsSync(join(dirname(report.payload.report.path), 'chart.svg')))

  process.env.DSH_EXPERIMENT_LEDGER_NO_OPEN = '1'
  try {
    const openedReport = await call(routes.get(`${base}/compare/report/open`), 'POST', `${base}/compare/report/open`, {
      root: ledgerRoot,
      path: report.payload.report.relative,
    })
    assert.equal(openedReport.status, 200)
    assert.equal(openedReport.payload.skipped, true)
  } finally {
    delete process.env.DSH_EXPERIMENT_LEDGER_NO_OPEN
  }

  const archived = await call(
    routes.get(`${base}/schedule/reports`),
    'GET',
    `${base}/schedule/reports?root=${encodeURIComponent(ledgerRoot)}&experimentId=${encodeURIComponent(experimentId)}`,
  )
  assert.equal(archived.status, 200)
  assert.equal(archived.payload.reports.length, 1)
  assert.equal(archived.payload.reports[0].path, report.payload.report.relative)

  const deleted = await call(routes.get(`${base}/schedule`), 'POST', `${base}/schedule`, {
    root: ledgerRoot,
    experimentId,
    action: 'delete',
    scheduleId: saved.payload.schedules[0].id,
  })
  assert.equal(deleted.payload.schedules.length, 0)
})

test('panel schedule retries a failed run with backoff', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-retry-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')

  const defined = await tools.get('exp_define').execute({
    name: 'Retry', factors: ['k'], metrics: ['m'],
  }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_presets').execute({
    experimentId,
    action: 'save',
    name: 'broken',
    command: `"${process.execPath}" "-e" "process.exit(1)"`,
    grid: { k: [1] },
    maxParallel: 1,
  }, exec)

  const saved = await call(routes.get(`${base}/schedule`), 'POST', `${base}/schedule`, {
    root: ledgerRoot,
    experimentId,
    action: 'save',
    name: 'retry-me',
    preset: 'broken',
    intervalMinutes: 60,
    retryLimit: 1,
    retryDelayMs: 10000,
  })
  const scheduleId = saved.payload.schedules[0].id
  const ran = await call(routes.get(`${base}/schedule`), 'POST', `${base}/schedule`, {
    root: ledgerRoot, experimentId, action: 'run', scheduleId,
  })
  let job = ran.payload.job
  for (let attempt = 0; attempt < 100 && job.status === 'running'; attempt += 1) {
    await sleep(50)
    job = (await call(routes.get(`${base}/sweep/status`), 'GET', `${base}/sweep/status?jobId=${encodeURIComponent(job.id)}`)).payload.job
  }
  assert.equal(job.status, 'done')

  const detail = await call(
    routes.get(`${base}/experiment`),
    'GET',
    `${base}/experiment?root=${encodeURIComponent(ledgerRoot)}&id=${experimentId}`,
  )
  const schedule = detail.payload.experiment.schedules[0]
  assert.equal(schedule.lastStatus, 'failed')
  assert.equal(schedule.retryCount, 1)
  assert.equal(schedule.history.length, 1)
  assert.equal(schedule.history[0].failed, 1)
  assert.ok(schedule.nextRunAt > Date.now())

  const notifications = await call(
    routes.get(`${base}/notifications`),
    'GET',
    `${base}/notifications?root=${encodeURIComponent(ledgerRoot)}`,
  )
  assert.match(notifications.payload.notifications[0].text, /retry 1\/1/)

  await call(routes.get(`${base}/schedule`), 'POST', `${base}/schedule`, {
    root: ledgerRoot, experimentId, action: 'delete', scheduleId,
  })
})

test('panel schedule pauses after consecutive failures', async () => {  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-pause-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')

  const defined = await tools.get('exp_define').execute({ name: 'Pause', factors: ['k'], metrics: ['m'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_presets').execute({
    experimentId,
    action: 'save',
    name: 'broken',
    command: `"${process.execPath}" "-e" "process.exit(1)"`,
    grid: { k: [1] },
    maxParallel: 1,
  }, exec)

  const saved = await call(routes.get(`${base}/schedule`), 'POST', `${base}/schedule`, {
    root: ledgerRoot,
    experimentId,
    action: 'save',
    name: 'pause-me',
    preset: 'broken',
    intervalMinutes: 60,
    retryLimit: 0,
    failureLimit: 1,
  })
  assert.equal(saved.payload.schedules[0].failureLimit, 1)
  const scheduleId = saved.payload.schedules[0].id
  const ran = await call(routes.get(`${base}/schedule`), 'POST', `${base}/schedule`, {
    root: ledgerRoot, experimentId, action: 'run', scheduleId,
  })
  let job = ran.payload.job
  for (let attempt = 0; attempt < 100 && job.status === 'running'; attempt += 1) {
    await sleep(50)
    job = (await call(routes.get(`${base}/sweep/status`), 'GET', `${base}/sweep/status?jobId=${encodeURIComponent(job.id)}`)).payload.job
  }

  const detail = await call(
    routes.get(`${base}/experiment`),
    'GET',
    `${base}/experiment?root=${encodeURIComponent(ledgerRoot)}&id=${experimentId}`,
  )
  const schedule = detail.payload.experiment.schedules[0]
  assert.equal(schedule.enabled, false)
  assert.equal(schedule.failureCount, 1)
  assert.equal(schedule.lastStatus, 'failed')

  const notifications = await call(
    routes.get(`${base}/notifications`),
    'GET',
    `${base}/notifications?root=${encodeURIComponent(ledgerRoot)}`,
  )
  assert.match(notifications.payload.notifications[0].text, /paused after 1 consecutive failures/)
  assert.equal(notifications.payload.notifications[0].action, 'resume-run')

  const resumed = await call(routes.get(`${base}/schedule`), 'POST', `${base}/schedule`, {
    root: ledgerRoot,
    experimentId,
    action: 'resume-run',
    scheduleId,
  })
  assert.equal(resumed.status, 200)
  assert.equal(resumed.payload.schedules[0].enabled, true)
  assert.equal(resumed.payload.schedules[0].failureCount, 0)
  let resumedJob = resumed.payload.job
  for (let attempt = 0; attempt < 100 && resumedJob.status === 'running'; attempt += 1) {
    await sleep(50)
    resumedJob = (await call(routes.get(`${base}/sweep/status`), 'GET', `${base}/sweep/status?jobId=${encodeURIComponent(resumedJob.id)}`)).payload.job
  }
  assert.equal(resumedJob.status, 'done')

  const all = await call(routes.get(`${base}/notifications/all`), 'GET', `${base}/notifications/all`)
  assert.equal(all.status, 200)
  assert.ok(all.payload.notifications.some((note) => note.root === ledgerRoot))
})

test('panel search and reproduce routes work', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-search-route-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"m\": 1}')\n", 'utf8')

  const defined = await tools.get('exp_define').execute({ name: 'Search route', factors: ['k'], metrics: ['m'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  const ran = await tools.get('exp_run').execute({
    experimentId, command: `"${process.execPath}" "${script}"`, params: { k: 1 },
  }, exec)
  const runId = ran.match(/Run (run-[\w-]+)/)[1]

  const found = await call(
    routes.get(`${base}/search`),
    'GET',
    `${base}/search?root=${encodeURIComponent(ledgerRoot)}&q=search`,
  )
  assert.equal(found.status, 200)
  assert.equal(found.payload.results.length, 1)
  assert.equal(found.payload.results[0].run.id, runId)

  const refused = await call(routes.get(`${base}/reproduce`), 'POST', `${base}/reproduce`, {
    root: ledgerRoot, experimentId, runId, confirm: false,
  })
  assert.equal(refused.status, 400)

  const reproduced = await call(routes.get(`${base}/reproduce`), 'POST', `${base}/reproduce`, {
    root: ledgerRoot, experimentId, runId, confirm: true,
  })
  assert.equal(reproduced.status, 200)
  assert.equal(reproduced.payload.run.reproducedFrom, runId)
  const ledger = JSON.parse(await fsp.readFile(join(ledgerRoot, 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].runs.length, 2)
})

test('panel export and import routes round-trip a ledger bundle', async () => {
  const sourceDir = await fsp.mkdtemp(join(tmpdir(), 'exp-route-export-src-'))
  const targetDir = await fsp.mkdtemp(join(tmpdir(), 'exp-route-export-dst-'))
  const { tools, routes } = await mount()
  const base = '/plugin-experiment-ledger'
  const sourceRoot = join(sourceDir, '.experiments')
  const targetRoot = join(targetDir, '.experiments')
  const exec = execAt(sourceDir)
  const script = join(sourceDir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"score\": 2}')\n", 'utf8')
  const defined = await tools.get('exp_define').execute({ name: 'Route export', metrics: ['score'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_run').execute({ experimentId, command: `"${process.execPath}" "${script}"` }, exec)

  const bundleFile = join(sourceDir, 'bundle.json')
  const exported = await call(routes.get(`${base}/export`), 'POST', `${base}/export`, {
    root: sourceRoot, path: bundleFile,
  })
  assert.equal(exported.status, 200)
  assert.equal(exported.payload.bundle.counts.experiments, 1)

  const imported = await call(routes.get(`${base}/import`), 'POST', `${base}/import`, {
    root: targetRoot, path: bundleFile,
  })
  assert.equal(imported.status, 200)
  assert.equal(imported.payload.summary.experimentsAdded, 1)
  const ledger = JSON.parse(await fsp.readFile(join(targetRoot, 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].name, 'Route export')
  assert.equal(ledger.experiments[0].runs.length, 1)
})

test('panel report route writes an HTML report when requested', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-html-route-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"score\": 1}')\n", 'utf8')
  const defined = await tools.get('exp_define').execute({ name: 'HTML route', metrics: ['score'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_run').execute({ experimentId, command: `"${process.execPath}" "${script}"` }, exec)

  const response = await call(routes.get(`${base}/report`), 'POST', `${base}/report`, {
    root: ledgerRoot, experimentId, format: 'html',
  })
  assert.equal(response.status, 200)
  assert.match(response.payload.report.path, /report\.html$/)
  const html = await fsp.readFile(response.payload.report.path, 'utf8')
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<svg/)
})

test('panel conclude route records a conclusion and decision', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-conclude-route-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')
  const defined = await tools.get('exp_define').execute({ name: 'Conclude route', metrics: ['score'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  const response = await call(routes.get(`${base}/conclude`), 'POST', `${base}/conclude`, {
    root: ledgerRoot, experimentId, text: 'Ship it', status: 'approved', decidedBy: 'lead',
  })
  assert.equal(response.status, 200)
  assert.equal(response.payload.conclusion.status, 'approved')
  const detail = await call(
    routes.get(`${base}/experiment`),
    'GET',
    `${base}/experiment?root=${encodeURIComponent(ledgerRoot)}&id=${experimentId}`,
  )
  assert.equal(detail.payload.experiment.conclusion.text, 'Ship it')
  assert.equal(detail.payload.experiment.conclusion.history.length, 1)
})

test('panel review routes list drafts and batch approve them', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-review-route-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')
  const ids = []
  for (const name of ['Route review A', 'Route review B']) {
    const defined = await tools.get('exp_define').execute({ name, metrics: ['score'] }, exec)
    const id = defined.match(/Experiment (exp-[\w-]+)/)[1]
    ids.push(id)
    await tools.get('exp_conclude').execute({ experimentId: id, text: `${name} text`, status: 'draft' }, exec)
  }
  const queue = await call(
    routes.get(`${base}/reviews`),
    'GET',
    `${base}/reviews?root=${encodeURIComponent(ledgerRoot)}&status=draft`,
  )
  assert.equal(queue.status, 200)
  assert.equal(queue.payload.reviews.length, 2)

  const reviewed = await call(routes.get(`${base}/review`), 'POST', `${base}/review`, {
    root: ledgerRoot, experimentIds: ids, status: 'approved', decidedBy: 'lead', role: 'maintainer',
  })
  assert.equal(reviewed.status, 200)
  assert.equal(reviewed.payload.done.length, 2)
  const approved = await call(
    routes.get(`${base}/reviews`),
    'GET',
    `${base}/reviews?root=${encodeURIComponent(ledgerRoot)}&status=approved`,
  )
  assert.equal(approved.payload.reviews.length, 2)
  assert.equal(approved.payload.reviews[0].conclusion.role, 'maintainer')
})

test('panel clone route copies factors and metrics without runs', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-clone-route-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')
  const defined = await tools.get('exp_define').execute({
    name: 'Clone route', factors: ['lr'], metrics: ['score'],
  }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  const cloned = await call(routes.get(`${base}/clone`), 'POST', `${base}/clone`, {
    root: ledgerRoot, experimentId,
  })
  assert.equal(cloned.status, 200)
  assert.match(cloned.payload.experiment.name, /clone/)
  const detail = await call(
    routes.get(`${base}/experiment`),
    'GET',
    `${base}/experiment?root=${encodeURIComponent(ledgerRoot)}&id=${cloned.payload.experiment.id}`,
  )
  assert.equal(detail.payload.experiment.factors[0].key, 'lr')
  assert.equal(detail.payload.experiment.runs.length, 0)
})

test('panel update routes manage experiment metadata and runs', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-update-route-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'
  const ledgerRoot = join(dir, '.experiments')
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"m\": 1}')\n", 'utf8')

  const defined = await tools.get('exp_define').execute({ name: 'Update route', metrics: ['m'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  const ran = await tools.get('exp_run').execute({
    experimentId, command: `"${process.execPath}" "${script}"`,
  }, exec)
  const runId = ran.match(/Run (run-[\w-]+)/)[1]

  const updated = await call(routes.get(`${base}/update`), 'POST', `${base}/update`, {
    root: ledgerRoot,
    experimentId,
    name: 'Renamed route',
    description: 'changed',
    tags: ['alpha', 'beta'],
    archived: true,
  })
  assert.equal(updated.status, 200)
  const detail = await call(
    routes.get(`${base}/experiment`),
    'GET',
    `${base}/experiment?root=${encodeURIComponent(ledgerRoot)}&id=${experimentId}`,
  )
  assert.equal(detail.payload.experiment.name, 'Renamed route')
  assert.deepEqual(detail.payload.experiment.tags, ['alpha', 'beta'])
  assert.equal(detail.payload.experiment.archived, true)

  const noted = await call(routes.get(`${base}/run/update`), 'POST', `${base}/run/update`, {
    root: ledgerRoot, experimentId, runId, notes: 'route note',
  })
  assert.equal(noted.status, 200)
  assert.equal(noted.payload.run.notes, 'route note')

  const refused = await call(routes.get(`${base}/run/delete`), 'POST', `${base}/run/delete`, {
    root: ledgerRoot, experimentId, runId, confirm: false,
  })
  assert.equal(refused.status, 400)
  const deleted = await call(routes.get(`${base}/run/delete`), 'POST', `${base}/run/delete`, {
    root: ledgerRoot, experimentId, runId, confirm: true,
  })
  assert.equal(deleted.status, 200)
  assert.equal(deleted.payload.runs, 0)
})

test('panel opens folders, imports uploaded files and serves agent open requests', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-ux-route-'))
  const { tools, routes } = await mount()
  const exec = execAt(dir)
  const base = '/plugin-experiment-ledger'

  const project = join(dir, 'project')
  await fsp.mkdir(project, { recursive: true })
  const opened = await call(routes.get(`${base}/roots`), 'POST', `${base}/roots`, { path: project, create: true })
  assert.equal(opened.status, 200)
  assert.equal(opened.payload.created, true)
  assert.equal(opened.payload.root, join(project, '.experiments'))

  const browsed = await call(routes.get(`${base}/browse`), 'GET', `${base}/browse?dir=${encodeURIComponent(project)}`)
  assert.equal(browsed.status, 200)
  assert.equal(browsed.payload.dir, project)
  assert.ok(browsed.payload.entries.some((entry) => entry.name === '.experiments' && entry.ledger === true))

  const defined = await tools.get('exp_define').execute({ name: 'Upload lab', metrics: ['m'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  const bundleFile = join(dir, 'upload.bundle.json')
  await tools.get('exp_export').execute({ path: bundleFile, format: 'json' }, exec)
  const data = (await fsp.readFile(bundleFile)).toString('base64')
  const target = join(dir, 'target')
  await fsp.mkdir(target, { recursive: true })
  const targetRoot = join(target, '.experiments')
  await tools.get('exp_define').execute({ name: 'Target', root: targetRoot }, exec)
  const imported = await call(routes.get(`${base}/import`), 'POST', `${base}/import`, {
    root: targetRoot,
    data,
    filename: 'upload.bundle.json',
  })
  assert.equal(imported.status, 200)
  assert.equal(imported.payload.summary.experimentsAdded, 1)

  const extra = await tools.get('exp_define').execute({ name: 'Delete me', root: targetRoot }, exec)
  const extraId = extra.match(/Experiment (exp-[\w-]+)/)[1]
  const refusedDelete = await call(routes.get(`${base}/experiment/delete`), 'POST', `${base}/experiment/delete`, {
    root: targetRoot, experimentId: extraId, confirm: false,
  })
  assert.equal(refusedDelete.status, 400)
  const deleted = await call(routes.get(`${base}/experiment/delete`), 'POST', `${base}/experiment/delete`, {
    root: targetRoot, experimentId: extraId, confirm: true,
  })
  assert.equal(deleted.status, 200)
  assert.equal(deleted.payload.filesKept, true)
  const listed = await call(routes.get(`${base}/list`), 'GET', `${base}/list?root=${encodeURIComponent(targetRoot)}`)
  assert.ok(!listed.payload.experiments.some((entry) => entry.id === extraId))

  await tools.get('exp_open').execute({ root: targetRoot, experimentId }, exec)
  const request = await call(routes.get(`${base}/panel-request`), 'GET', `${base}/panel-request`)
  assert.equal(request.status, 200)
  assert.equal(request.payload.request.root, targetRoot)
  assert.equal(request.payload.request.experimentId, experimentId)
  assert.equal(request.payload.request.mode, 'sidebar')
})

