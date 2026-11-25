/**
 * Seed a demo ledger for verification (not part of the plugin).
 * Usage: node scripts/seed-demo.mjs <root>
 */
import { promises as fsp } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadLedger, saveLedger, rememberRoot } from '../lib/store.js'
import { newId, normalizeFactors, normalizeMetricDefs } from '../lib/model.js'

const root = resolve(process.argv[2] ?? join(process.cwd(), '.experiments-demo'))
await fsp.mkdir(root, { recursive: true })
const ledger = await loadLedger(root)
const now = Date.now()
const experiment = {
  id: newId('exp'),
  name: 'PID tuning (demo)',
  description: 'Find a Kp/Ki pair that keeps overshoot under 5% with a short settling time.',
  factors: normalizeFactors([
    { key: 'kp', label: 'Kp' },
    { key: 'ki', label: 'Ki', unit: '1/s' },
  ]),
  metrics: normalizeMetricDefs([
    { key: 'overshoot', label: 'Overshoot', unit: '%', direction: 'min' },
    { key: 'settling', label: 'Settling time', unit: 's', direction: 'min' },
  ]),
  createdAt: now,
  updatedAt: now,
  runs: [],
}
ledger.experiments.push(experiment)

const cases = [
  { kp: 0.8, ki: 0.2, overshoot: 12.4, settling: 3.2, status: 'ok' },
  { kp: 1.2, ki: 0.3, overshoot: 6.1, settling: 2.1, status: 'ok' },
  { kp: 1.8, ki: 0.45, overshoot: 4.2, settling: 2.8, status: 'ok' },
  { kp: 2.4, ki: 0.6, overshoot: 2.9, settling: 4.1, status: 'failed' },
]

for (const item of cases) {
  const runId = newId('run')
  const runDir = join(root, 'runs', runId)
  await fsp.mkdir(runDir, { recursive: true })
  const stdout = [
    `kp=${item.kp} ki=${item.ki}`,
    `EXP_METRICS: ${JSON.stringify({ overshoot: item.overshoot, settling: item.settling })}`,
    'done',
    '',
  ].join('\n')
  await fsp.writeFile(join(runDir, 'stdout.log'), stdout, 'utf8')
  await fsp.writeFile(join(runDir, 'stderr.log'), '', 'utf8')
  const startedAt = now - (cases.length - experiment.runs.length) * 90_000
  experiment.runs.push({
    id: runId,
    label: `kp=${item.kp} ki=${item.ki}`,
    status: item.status,
    params: { kp: item.kp, ki: item.ki },
    metrics: { overshoot: item.overshoot, settling: item.settling },
    artifacts: [{ path: join(runDir, 'step.png'), sha256: '9f'.repeat(32), bytes: 18_442 }],
    command: 'python tune.py --kp {kp} --ki {ki}',
    cwd: process.cwd(),
    startedAt,
    endedAt: startedAt + 1200,
    durationMs: 1200,
    exitCode: item.status === 'ok' ? 0 : 1,
    signal: null,
    stdout: `runs/${runId}/stdout.log`,
    stderr: `runs/${runId}/stderr.log`,
    stdoutTail: stdout.slice(-2000),
    stderrTail: '',
    notes: item.status === 'failed' ? 'Controller unstable at this gain; kept for comparison.' : '',
    executor: { kind: 'command' },
  })
}
experiment.updatedAt = Date.now()
await saveLedger(root, ledger)
await rememberRoot(root)
console.log(JSON.stringify({ root, experiment: experiment.id, runs: experiment.runs.length }))
