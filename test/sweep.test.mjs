/**
 * Tests for the passive recorder, event wiring, promotion and sweeps.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = await fsp.mkdtemp(join(tmpdir(), 'exp-m4-home-'))

import { apply } from '../index.js'
import { listCandidates } from '../lib/recorder.js'

/**
 * Mount the plugin with a fake context that captures tool and event handlers.
 * @returns {Promise<{tools: Map<string, object>, listeners: Map<string, Function[]>}>} the harness.
 */
async function mount() {
  const tools = new Map()
  const listeners = new Map()
  const ctx = {
    effect: (fn) => fn(),
    on: (name, listener) => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {}
    },
    tools: { register: (definition) => tools.set(definition.name, definition) },
    webServer: { register: () => () => {} },
    logger: { warn: () => {} },
  }
  apply(ctx, { scheduler: false })
  return { tools, listeners }
}

/**
 * @param cwd - session working directory.
 * @returns {object} a minimal tool execution context.
 */
function execAt(cwd) {
  return { agent: { session: { header: { cwd, id: 'session-test' } } } }
}

/**
 * @param ms - wait time.
 * @returns {Promise<void>} resolution after the wait.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('recorder captures a command from tool events and promotion turns it into a run', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-m4-'))
  const { tools, listeners } = await mount()
  const exec = execAt(dir)
  const call = {
    callId: 'call-1',
    name: 'bash',
    arguments: { command: 'python train.py --model a' },
    agent: { session: { header: { cwd: dir, id: 'session-test' } } },
  }
  const pre = listeners.get('tools/pre-execute')[0]
  assert.deepEqual(pre(call, () => ({ kind: 'allow' })), { kind: 'allow' })
  listeners.get('tools/result')[0](call, { isError: false })
  await sleep(100)

  const candidates = await listCandidates(5)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].command, 'python train.py --model a')
  assert.equal(candidates[0].tool, 'bash')
  assert.equal(candidates[0].status, 'ok')

  const defined = await tools.get('exp_define').execute({ name: 'Promoted', metrics: ['acc'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  const promoted = await tools.get('exp_promote').execute({
    experimentId,
    candidateId: candidates[0].id,
    params: { lr: 0.1 },
    metrics: { acc: 0.91 },
    label: 'promoted run',
  }, exec)
  assert.match(promoted, /Run run-.* recorded/)
  assert.match(promoted, /acc=0\.91/)
  assert.equal((await listCandidates(5)).length, 0)

  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].runs.length, 1)
  assert.equal(ledger.experiments[0].runs[0].executor.kind, 'tool')
  assert.equal(ledger.experiments[0].runs[0].command, 'python train.py --model a')
})

test('exp_sweep plans and runs a grid', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-m4-'))
  const { tools } = await mount()
  const exec = execAt(dir)
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, [
    "console.log('EXP_METRICS: {\"m\": ' + Number(process.env.EXP_PARAM_KP) + '}')",
    '',
  ].join('\n'), 'utf8')

  const defined = await tools.get('exp_define').execute({
    name: 'Sweep',
    factors: ['kp'],
    metrics: [{ key: 'm', direction: 'max' }],
  }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]

  const plan = await tools.get('exp_sweep').execute({
    experimentId,
    command: `"${process.execPath}" "${script}"`,
    grid: { kp: [1, 2, 3] },
    dryRun: true,
  }, exec)
  assert.match(plan, /3 run\(s\)/)
  assert.match(plan, /kp=1/)

  const result = await tools.get('exp_sweep').execute({
    experimentId,
    command: `"${process.execPath}" "${script}"`,
    grid: { kp: [1, 2, 3] },
    label: 'kp run',
  }, exec)
  assert.match(result, /Sweep exp-.*: 3\/3 runs/)
  assert.match(result, /best: m → run-/)

  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].runs.length, 3)
  assert.deepEqual(ledger.experiments[0].runs.map((run) => run.metrics.m), [1, 2, 3])
  assert.deepEqual(ledger.experiments[0].runs.map((run) => run.params.kp), [1, 2, 3])
  assert.ok(ledger.experiments[0].runs.every((run) => run.label.startsWith('kp run')))
})

test('exp_sweep rejects an over-cap grid and stops on a failed run with failFast', async () => {  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-m4-'))
  const { tools } = await mount()
  const exec = execAt(dir)
  const defined = await tools.get('exp_define').execute({ name: 'Cap' }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]

  await assert.rejects(() => tools.get('exp_sweep').execute({
    experimentId,
    command: 'echo hi',
    grid: { a: Array.from({ length: 101 }, (_, index) => index) },
  }, exec), /more than 100|raise maxRuns/)

  const failed = await tools.get('exp_sweep').execute({
    experimentId,
    command: `"${process.execPath}" -e "process.exit(1)"`,
    grid: { a: [1, 2] },
    maxParallel: 1,
    failFast: true,
  }, exec)
  assert.match(failed, /1\/2 runs/)
  assert.match(failed, /failed/)
})

test('exp_presets stores a preset and exp_sweep runs it', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-m4-'))
  const { tools } = await mount()
  const exec = execAt(dir)
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, [
    "console.log('EXP_METRICS: {\"m\": ' + Number(process.env.EXP_PARAM_K) + '}')",
    '',
  ].join('\n'), 'utf8')
  const defined = await tools.get('exp_define').execute({
    name: 'Preset sweep',
    factors: ['k'],
    metrics: [{ key: 'm', direction: 'max' }],
  }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]

  const saved = await tools.get('exp_presets').execute({
    experimentId,
    action: 'save',
    name: 'quick',
    command: `"${process.execPath}" "${script}"`,
    grid: { k: [1, 2] },
    maxParallel: 1,
  }, exec)
  assert.match(saved, /quick/)

  const plan = await tools.get('exp_sweep').execute({ experimentId, preset: 'quick', dryRun: true }, exec)
  assert.match(plan, /2 run\(s\)/)

  const result = await tools.get('exp_sweep').execute({ experimentId, preset: 'quick' }, exec)
  assert.match(result, /2\/2 runs/)

  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].runs.length, 2)
  assert.deepEqual(ledger.experiments[0].runs.map((run) => run.params.k), [1, 2])
  assert.deepEqual(ledger.experiments[0].runs.map((run) => run.metrics.m), [1, 2])
})

