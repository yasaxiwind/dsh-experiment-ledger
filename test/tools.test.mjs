/**
 * Tool-level smoke test: mount the Host half with a fake context and call the
 * five `exp_*` tools end to end (define → run → list → show).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Keep the test runs from writing their temporary roots into the real
// `$DSH_HOME/experiment-ledger/roots.json` registry.
process.env.DSH_HOME = await fsp.mkdtemp(join(tmpdir(), 'exp-home-'))

import { apply } from '../index.js'
import { readZip, createZip } from '../lib/zip.js'

/**
 * Mount the plugin against a fake Cordis context and return its tools.
 * @returns {Promise<Map<string, object>>} registered tools.
 */
async function mount() {
  const tools = new Map()
  const ctx = {
    effect: (fn) => fn(),
    on: () => () => {},
    tools: { register: (definition) => tools.set(definition.name, definition) },
    webServer: { register: () => () => {} },
    logger: { warn: () => {} },
  }
  apply(ctx, { scheduler: false })
  return tools
}

/**
 * @param cwd - session working directory.
 * @returns {object} a minimal tool execution context.
 */
function execAt(cwd) {
  return { agent: { session: { header: { cwd } } } }
}

test('exp_define, exp_run, exp_list and exp_show work end to end', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-tools-'))
  const tools = await mount()
  const exec = execAt(dir)

  const defined = await tools.get('exp_define').execute({
    name: 'Sweep demo',
    description: 'test the ledger',
    factors: ['kp'],
    metrics: [{ key: 'gain', unit: 'x', direction: 'max' }],
  }, exec)
  assert.match(defined, /Experiment exp-/)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]

  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, [
    "console.log('EXP_METRICS: {\"gain\": 3.5}')",
    "console.log('hello from the run')",
    '',
  ].join('\n'), 'utf8')
  const dataFile = join(dir, 'data.csv')
  await fsp.writeFile(dataFile, 'a,b\n1,2\n3,4\n', 'utf8')

  const ran = await tools.get('exp_run').execute({
    experimentId,
    command: `"${process.execPath}" "${script}"`,
    params: { kp: 1.5 },
    label: 'kp=1.5',
    datasets: [dataFile],
  }, exec)
  assert.match(ran, /Run run-.* recorded/)
  assert.match(ran, /gain=3\.5/)
  assert.match(ran, /datasets: .*data\.csv \(2×2\)/)

  const ran2 = await tools.get('exp_run').execute({
    experimentId,
    command: `"${process.execPath}" "${script}"`,
    params: { kp: 2.0 },
    label: 'kp=2.0',
  }, exec)
  const secondRunId = ran2.match(/Run (run-[\w-]+)/)[1]

  const diffed = await tools.get('exp_diff').execute({ experimentId, runId: secondRunId }, exec)
  assert.match(diffed, /Diff:/)
  assert.match(diffed, /kp: 1\.5 → 2/)

  const listed = await tools.get('exp_list').execute({}, exec)
  assert.match(listed, /Sweep demo/)
  assert.match(listed, /2 runs/)

  const shown = await tools.get('exp_show').execute({ experimentId }, exec)
  assert.match(shown, /kp=1\.5/)
  assert.match(shown, /gain=3\.5/)

  const compared = await tools.get('exp_compare').execute({ experimentId }, exec)
  assert.match(compared, /Comparison/)
  assert.match(compared, /best:/)

  const report = await tools.get('exp_report').execute({ experimentId }, exec)
  assert.match(report, /Report written/)
  const reportPath = report.split('\n')[0].replace(/^Report written for exp-[\w-]+: /, '')
  const reportText = await fsp.readFile(reportPath, 'utf8')
  assert.match(reportText, /# Sweep demo/)
  assert.match(reportText, /## Comparison/)

  const ledgerText = await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8')
  const ledger = JSON.parse(ledgerText)
  assert.equal(ledger.experiments.length, 1)
  assert.equal(ledger.experiments[0].runs.length, 2)
  assert.equal(ledger.experiments[0].reports.length, 1)
  assert.equal(ledger.experiments[0].runs[0].status, 'ok')
  assert.equal(ledger.experiments[0].runs[0].metrics.gain, 3.5)
  assert.equal(ledger.experiments[0].runs[0].params.kp, 1.5)
  assert.equal(ledger.experiments[0].runs[0].datasets[0].rows, 2)
  assert.equal(ledger.experiments[0].runs[0].datasets[0].cols, 2)
  assert.match(ledger.experiments[0].runs[0].stdoutTail, /hello from the run/)
})

test('exp_run computes a SQL metric from a CSV dataset', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-tools-'))
  const tools = await mount()
  const exec = execAt(dir)
  const csv = join(dir, 'data.csv')
  await fsp.writeFile(csv, 'x,y\n1,1\n2,3\n', 'utf8')

  const defined = await tools.get('exp_define').execute({
    name: 'SQL metrics',
    metrics: [{ key: 'avg_y', sql: 'SELECT avg(y) AS v FROM data', dataset: 'data.csv', direction: 'min' }],
  }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]

  const ran = await tools.get('exp_run').execute({
    experimentId,
    command: `"${process.execPath}" -e "console.log('ran')"`,
  }, exec)
  assert.match(ran, /avg_y=2/)

  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].runs[0].metrics.avg_y, 2)
  assert.equal(ledger.experiments[0].runs[0].datasets[0].path, csv)
  assert.equal(ledger.experiments[0].runs[0].metricErrors, undefined)

  const overridden = await tools.get('exp_run').execute({
    experimentId,
    command: `"${process.execPath}" -e "console.log('ran')"`,
    metrics: { avg_y: 99 },
  }, exec)
  assert.match(overridden, /avg_y=99/)

  const missing = await tools.get('exp_define').execute({
    name: 'Missing dataset',
    metrics: [{ key: 'v', sql: 'SELECT 1 AS v', dataset: 'missing.csv' }],
  }, exec)
  const missingId = missing.match(/Experiment (exp-[\w-]+)/)[1]
  const failedMetric = await tools.get('exp_run').execute({
    experimentId: missingId,
    command: `"${process.execPath}" -e "console.log('ran')"`,
  }, exec)
  assert.match(failedMetric, /metric errors: v: .*dataset not found/)
})

test('exp_search and exp_reproduce reuse recorded runs', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-search-'))
  const tools = await mount()
  const exec = execAt(dir)
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"m\": ' + Number(process.env.EXP_PARAM_K) + '}')\n", 'utf8')

  const defined = await tools.get('exp_define').execute({
    name: 'Search demo', factors: ['k'], metrics: [{ key: 'm', direction: 'max' }],
  }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_run').execute({
    experimentId, command: `"${process.execPath}" "${script}"`, params: { k: 1 },
  }, exec)
  const second = await tools.get('exp_run').execute({
    experimentId, command: `"${process.execPath}" "${script}"`, params: { k: 2 },
  }, exec)
  assert.match(second, /ok/)

  const shown = await tools.get('exp_show').execute({
    experimentId,
    runId: JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8')).experiments[0].runs[0].id,
  }, exec)
  assert.match(shown, /toolchain: node/)

  const found = await tools.get('exp_search').execute({
    experimentId,
    paramFilters: [{ key: 'k', op: 'gte', value: 2 }],
  }, exec)
  assert.match(found, /Matching runs: 1/)
  assert.match(found, /k=2/)
  assert.doesNotMatch(found, /k=1/)

  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  const source = ledger.experiments[0].runs[0]
  const dry = await tools.get('exp_reproduce').execute({
    experimentId, runId: source.id, confirm: false,
  }, exec)
  assert.match(dry, /Dry run/)

  const reproduced = await tools.get('exp_reproduce').execute({
    experimentId, runId: source.id, confirm: true,
  }, exec)
  assert.match(reproduced, new RegExp(`reproducedFrom: ${source.id}`))
  const after = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(after.experiments[0].runs.length, 3)
  assert.equal(after.experiments[0].runs[2].reproducedFrom, source.id)
  assert.equal(typeof after.experiments[0].runs[2].manifest?.toolchain?.node, 'string')
})

test('exp_reproduce keeps the exact command and manifest env, and reports failures', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-repro-'))
  const tools = await mount()
  const exec = execAt(dir)
  const script = join(dir, 'echo.mjs')
  await fsp.writeFile(script, [
    "console.log('EXP_METRICS: {\"m\": 1}')",
    'console.log(`arg=${process.argv[2]}`)',
    'console.log(`manifestEnv=${process.env.EXP_REPRO ?? \'missing\'}`)',
    '',
  ].join('\n'), 'utf8')

  const defined = await tools.get('exp_define').execute({ name: 'Repro', factors: ['v'], metrics: ['m'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  process.env.EXP_REPRO = 'kept'
  await tools.get('exp_run').execute({
    experimentId,
    command: `"${process.execPath}" "${script}" "{v}"`,
    params: { v: '{k}', k: 7 },
  }, exec)
  delete process.env.EXP_REPRO

  let ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  const source = ledger.experiments[0].runs[0]
  assert.equal(source.status, 'ok')
  assert.match(source.stdoutTail, /arg=\{k\}/)

  const reproduced = await tools.get('exp_reproduce').execute({
    experimentId, runId: source.id, confirm: true,
  }, exec)
  assert.match(reproduced, /reproducedFrom/)
  ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  const newRun = ledger.experiments[0].runs[1]
  assert.equal(newRun.status, 'ok')
  assert.match(newRun.stdoutTail, /arg=\{k\}/)
  assert.match(newRun.stdoutTail, /manifestEnv=kept/)
  assert.equal(typeof newRun.timeoutMs, 'number')

  const failing = join(dir, 'fail.mjs')
  await fsp.writeFile(failing, "console.error('boom'); process.exit(3)\n", 'utf8')
  await tools.get('exp_run').execute({
    experimentId, command: `"${process.execPath}" "${failing}"`,
  }, exec)
  ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  const broken = ledger.experiments[0].runs[2]
  const failedAgain = await tools.get('exp_reproduce').execute({
    experimentId, runId: broken.id, confirm: true,
  }, exec)
  assert.match(failedAgain, /reproduce FAILED/)
  assert.match(failedAgain, /exit 3/)
  assert.match(failedAgain, /boom/)

  const work = join(dir, 'gone')
  await fsp.mkdir(work, { recursive: true })
  await tools.get('exp_run').execute({
    experimentId,
    command: `"${process.execPath}" "${script}" "x"`,
    cwd: work,
  }, exec)
  ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  const missing = ledger.experiments[0].runs[4]
  assert.equal(missing.manifest.cwd, work)
  await fsp.rm(work, { recursive: true, force: true })
  await assert.rejects(
    tools.get('exp_reproduce').execute({ experimentId, runId: missing.id, confirm: true }, exec),
    /working directory is missing/,
  )

  await tools.get('exp_run').execute({
    experimentId,
    command: `"${process.execPath}" "${script}" "y"`,
  }, exec)
  ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  const scripted = ledger.experiments[0].runs[ledger.experiments[0].runs.length - 1]
  await fsp.rm(script)
  await assert.rejects(
    tools.get('exp_reproduce').execute({ experimentId, runId: scripted.id, confirm: true }, exec),
    /command file not found/,
  )
})

test('exp_reproduce substitutes params for legacy runs without a manifest', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-legacy-'))
  const tools = await mount()
  const exec = execAt(dir)
  const script = join(dir, 'arg.mjs')
  await fsp.writeFile(script, "console.log(`arg=${process.argv[2]}`)\n", 'utf8')

  const defined = await tools.get('exp_define').execute({ name: 'Legacy', factors: ['v'], metrics: ['m'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_run').execute({
    experimentId, command: `"${process.execPath}" "${script}" "{v}"`, params: { v: 'x' },
  }, exec)

  const ledgerFile = join(dir, '.experiments', 'ledger.json')
  const ledger = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'))
  const source = ledger.experiments[0].runs[0]
  delete source.manifest
  source.command = `"${process.execPath}" "${script}" "{v}"`
  await fsp.writeFile(ledgerFile, JSON.stringify(ledger, null, 2), 'utf8')

  await tools.get('exp_reproduce').execute({ experimentId, runId: source.id, confirm: true }, exec)
  const after = JSON.parse(await fsp.readFile(ledgerFile, 'utf8'))
  const reproduced = after.experiments[0].runs[1]
  assert.equal(reproduced.status, 'ok')
  assert.match(reproduced.stdoutTail, /arg=x/)
})

test('exp_record records a manual run and exp_show shows it', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-tools-'))
  const tools = await mount()
  const exec = execAt(dir)

  const defined = await tools.get('exp_define').execute({ name: 'Bench run', metrics: ['yield'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]

  const recorded = await tools.get('exp_record').execute({
    experimentId,
    label: 'sample-A',
    params: { temperature: 80 },
    metrics: { yield: 0.92 },
    notes: 'triplicate',
  }, exec)
  assert.match(recorded, /recorded/)
  assert.match(recorded, /yield=0\.92/)

  const shown = await tools.get('exp_show').execute({ experimentId }, exec)
  assert.match(shown, /sample-A/)
  assert.match(shown, /recorded/)

  const detail = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(detail.experiments[0].runs[0].executor.kind, 'manual')
  assert.equal(detail.experiments[0].runs[0].notes, 'triplicate')
})

test('exp_report_compare format html writes a multi-experiment HTML report', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-html-compare-'))
  const tools = await mount()
  const exec = execAt(dir)
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"score\": 3}')\n", 'utf8')
  const ids = []
  for (const name of ['A', 'B']) {
    const defined = await tools.get('exp_define').execute({ name, metrics: ['score'] }, exec)
    const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
    ids.push(experimentId)
    await tools.get('exp_run').execute({ experimentId, command: `"${process.execPath}" "${script}"` }, exec)
  }

  const report = await tools.get('exp_report_compare').execute({
    experimentIds: ids, format: 'html',
  }, exec)
  assert.match(report, /HTML comparison report/)
  assert.match(report, /report\.html/)
  const file = report.match(/: (.+report\.html)/)[1]
  const html = await fsp.readFile(file, 'utf8')
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /Multi-experiment comparison/)
  assert.match(html, /score/)
  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.compareReports.at(-1).format, 'html')
})

test('exp_export and exp_import round-trip a ledger and merge idempotently', async () => {
  const sourceDir = await fsp.mkdtemp(join(tmpdir(), 'exp-export-src-'))
  const targetDir = await fsp.mkdtemp(join(tmpdir(), 'exp-export-dst-'))
  const tools = await mount()
  const sourceExec = execAt(sourceDir)
  const targetExec = execAt(targetDir)
  const script = join(sourceDir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"score\": 5}')\n", 'utf8')
  const csv = join(sourceDir, 'data.csv')
  await fsp.writeFile(csv, 'x,y\n1,2\n', 'utf8')

  const defined = await tools.get('exp_define').execute({ name: 'Exported', metrics: ['score'] }, sourceExec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_dataset').execute({ path: csv }, sourceExec)
  await tools.get('exp_run').execute({ experimentId, command: `"${process.execPath}" "${script}"` }, sourceExec)

  const bundleFile = join(sourceDir, 'bundle.json')
  const exported = await tools.get('exp_export').execute({ path: bundleFile }, sourceExec)
  assert.match(exported, /Ledger bundle written/)
  assert.match(exported, /experiments: 1 · runs: 1 · datasets: 1/)
  const bundle = JSON.parse(await fsp.readFile(bundleFile, 'utf8'))
  assert.equal(bundle.format, 'dsh-experiment-ledger-bundle')
  assert.equal(bundle.version, 1)
  assert.equal(bundle.experiments[0].runs[0].metrics.score, 5)

  const imported = await tools.get('exp_import').execute({ path: bundleFile }, targetExec)
  assert.match(imported, /experiments \+1/)
  assert.match(imported, /runs \+1/)
  assert.match(imported, /datasets \+1/)
  const targetLedger = JSON.parse(await fsp.readFile(join(targetDir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(targetLedger.experiments.length, 1)
  assert.equal(targetLedger.experiments[0].runs.length, 1)
  assert.equal(targetLedger.datasets.length, 1)

  const dry = await tools.get('exp_import').execute({ path: bundleFile, dryRun: true }, targetExec)
  assert.match(dry, /Dry run/)
  assert.match(dry, /runs \+0 \(1 kept\)/)
  const again = await tools.get('exp_import').execute({ path: bundleFile }, targetExec)
  assert.match(again, /runs \+0 \(1 kept\)/)
  const after = JSON.parse(await fsp.readFile(join(targetDir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(after.experiments[0].runs.length, 1)
})

test('zip packages include and restore dataset files', async () => {
  const sourceDir = await fsp.mkdtemp(join(tmpdir(), 'exp-pack-data-src-'))
  const targetDir = await fsp.mkdtemp(join(tmpdir(), 'exp-pack-data-dst-'))
  const tools = await mount()
  const sourceExec = execAt(sourceDir)
  const targetExec = execAt(targetDir)
  const csv = join(sourceDir, 'measure.csv')
  await fsp.writeFile(csv, 'y\n2\n4\n', 'utf8')
  const script = join(sourceDir, 'job.mjs')
  await fsp.writeFile(script, "console.log('done')\n", 'utf8')
  const registered = await tools.get('exp_dataset').execute({ path: csv }, sourceExec)
  const datasetId = registered.match(/ds-[a-f0-9]{10}/)[0]
  const defined = await tools.get('exp_define').execute({
    name: 'Packed dataset',
    metrics: [{ key: 'mean_y', sql: 'SELECT avg(y) AS value FROM data', datasetId }],
  }, sourceExec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_run').execute({ experimentId, command: `"${process.execPath}" "${script}"` }, sourceExec)

  const zipFile = join(sourceDir, 'package.zip')
  const exported = await tools.get('exp_export').execute({ path: zipFile, format: 'zip' }, sourceExec)
  assert.match(exported, /datasets: 1/)
  const files = readZip(await fsp.readFile(zipFile))
  assert.ok([...files.keys()].some((name) => name.startsWith('datasets/')))
  const manifest = JSON.parse(files.get('manifest.json').toString('utf8'))
  assert.equal(manifest.datasets.length, 1)

  const imported = await tools.get('exp_import').execute({ path: zipFile }, targetExec)
  assert.match(imported, /datasets restored: 1/)
  const ledger = JSON.parse(await fsp.readFile(join(targetDir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.datasets.length, 1)
  assert.ok(ledger.datasets[0].path.startsWith(join(targetDir, '.experiments', 'datasets')))
  assert.equal(ledger.experiments[0].runs[0].metrics.mean_y, 3)
})

test('trusted keys gate package import and decisions are signed', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-trust-'))
  const tools = await mount()
  const exec = execAt(dir)
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('done')\n", 'utf8')
  const defined = await tools.get('exp_define').execute({ name: 'Trust lab', metrics: ['score'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_run').execute({ experimentId, command: `"${process.execPath}" "${script}"` }, exec)
  const concluded = await tools.get('exp_conclude').execute({
    experimentId, text: 'Signed decision', status: 'approved', decidedBy: 'lead', role: 'maintainer',
  }, exec)
  assert.match(concluded, /signed by/)
  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].conclusion.signature.algorithm, 'ed25519')
  const shown = await tools.get('exp_show').execute({ experimentId }, exec)
  assert.match(shown, /decision signature: ed25519/)
  const decisionAudit = await tools.get('exp_audit').execute({ limit: 10 }, exec)
  assert.match(decisionAudit, /decision\.approved/)

  const zipFile = join(dir, 'package.zip')
  await tools.get('exp_export').execute({ path: zipFile, format: 'zip', signer: 'lead' }, exec)
  const otherHome = await fsp.mkdtemp(join(tmpdir(), 'exp-trust-home-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = otherHome
  try {
    const untrusted = await tools.get('exp_import').execute({ path: zipFile }, exec)
    assert.match(untrusted, /trust: untrusted/)
    await assert.rejects(
      tools.get('exp_import').execute({ path: zipFile, requireTrusted: true }, exec),
      /signing key is not trusted/,
    )
    const trusted = await tools.get('exp_trust_key').execute({ path: zipFile, label: 'lead' }, exec)
    assert.match(trusted, /Trusted key/)
    const oldKeyId = trusted.match(/Trusted key (\w+)/)[1]
    const listed = await tools.get('exp_trust_key').execute({ list: true }, exec)
    assert.match(listed, /lead/)
    const accepted = await tools.get('exp_import').execute({ path: zipFile, requireTrusted: true }, exec)
    assert.match(accepted, /trust: trusted/)

    const revoked = await tools.get('exp_trust_key').execute({ revoke: oldKeyId }, exec)
    assert.match(revoked, /Revoked trusted key/)
    const oldPackage = await tools.get('exp_import').execute({ path: zipFile, requireTrusted: true }, exec)
    assert.match(oldPackage, /signed-before-revocation/)

    const rotated = await tools.get('exp_trust_key').execute({ rotate: true }, exec)
    assert.match(rotated, /Rotated signing key/)
    const audit = await tools.get('exp_audit').execute({ verify: true }, exec)
    assert.match(audit, /Audit chain: ok/)
    const auditLog = await tools.get('exp_audit').execute({ limit: 10 }, exec)
    assert.match(auditLog, /package\.import/)
    assert.match(auditLog, /trust\.rotate/)
    assert.match(auditLog, /trust\.revoke/)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('exp_reviews lists drafts and exp_review batch approves them', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-reviews-'))
  const tools = await mount()
  const exec = execAt(dir)
  const ids = []
  for (const name of ['Review A', 'Review B']) {
    const defined = await tools.get('exp_define').execute({ name, metrics: ['score'] }, exec)
    const id = defined.match(/Experiment (exp-[\w-]+)/)[1]
    ids.push(id)
    await tools.get('exp_conclude').execute({ experimentId: id, text: `${name} conclusion`, status: 'draft' }, exec)
  }
  const queue = await tools.get('exp_reviews').execute({}, exec)
  assert.match(queue, /2 experiment\(s\)/)
  assert.match(queue, /Review A/)
  const filtered = await tools.get('exp_reviews').execute({ reviewer: 'maintainer' }, exec)
  assert.match(filtered, /No experiments/)

  const reviewed = await tools.get('exp_review').execute({
    experimentIds: ids, status: 'approved', decidedBy: 'lead', role: 'maintainer',
  }, exec)
  assert.match(reviewed, /Reviewed 2\/2/)
  const approved = await tools.get('exp_reviews').execute({ status: 'approved' }, exec)
  assert.match(approved, /2 experiment\(s\)/)
  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].conclusion.role, 'maintainer')
})

test('exp_export zip packages logs and reports and can be imported', async () => {
  const sourceDir = await fsp.mkdtemp(join(tmpdir(), 'exp-zip-src-'))
  const targetDir = await fsp.mkdtemp(join(tmpdir(), 'exp-zip-dst-'))
  const tools = await mount()
  const sourceExec = execAt(sourceDir)
  const targetExec = execAt(targetDir)
  const script = join(sourceDir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"score\": 4}')\n", 'utf8')
  const defined = await tools.get('exp_define').execute({ name: 'Zip export', metrics: ['score'] }, sourceExec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_run').execute({ experimentId, command: `"${process.execPath}" "${script}"` }, sourceExec)
  await tools.get('exp_conclude').execute({
    experimentId, text: 'Zip decision', status: 'approved', decidedBy: 'lead',
  }, sourceExec)
  const ledger = JSON.parse(await fsp.readFile(join(sourceDir, '.experiments', 'ledger.json'), 'utf8'))
  const runId = ledger.experiments[0].runs[0].id

  const zipFile = join(sourceDir, 'package.zip')
  const exported = await tools.get('exp_export').execute({ path: zipFile, format: 'zip' }, sourceExec)
  assert.match(exported, /Ledger package written/)
  assert.match(exported, /files:/)
  const files = readZip(await fsp.readFile(zipFile))
  assert.ok(files.has('ledger.json'))
  assert.ok(files.has('manifest.json'))
  assert.ok(files.has('summary.md'))
  assert.ok(files.has('audit.ndjson'))
  assert.ok(files.has(`runs/${runId}/stdout.log`))
  const manifest = JSON.parse(files.get('manifest.json').toString('utf8'))
  assert.equal(manifest.format, 'dsh-experiment-ledger-package')
  assert.equal(manifest.counts.experiments, 1)
  assert.equal(manifest.compression, 'deflate')
  assert.equal(typeof manifest.bundleSha256, 'string')
  assert.equal(manifest.bundleSha256.length, 64)
  assert.equal(manifest.signature.algorithm, 'ed25519')
  assert.equal(manifest.signature.scope, 'bundleSha256+auditHead')
  assert.equal(typeof manifest.signature.signature, 'string')
  assert.equal(typeof manifest.audit.headHash, 'string')

  const imported = await tools.get('exp_import').execute({ path: zipFile }, targetExec)
  assert.match(imported, /package/)
  assert.match(imported, /integrity: verified/)
  assert.match(imported, /signature: verified/)
  assert.match(imported, /audit mirror: ok/)
  assert.match(imported, /experiments \+1/)
  const targetLedger = JSON.parse(await fsp.readFile(join(targetDir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(targetLedger.experiments[0].runs[0].metrics.score, 4)

  const tampered = new Map(files)
  tampered.set('ledger.json', Buffer.from(JSON.stringify({ ...JSON.parse(tampered.get('ledger.json').toString('utf8')), exportedAt: 'tampered' }), 'utf8'))
  const tamperedFile = join(sourceDir, 'tampered.zip')
  await fsp.writeFile(tamperedFile, createZip([...tampered].map(([name, data]) => ({ name, data }))))
  await assert.rejects(
    tools.get('exp_import').execute({ path: tamperedFile }, targetExec),
    /integrity check failed/,
  )

  const forged = new Map(files)
  const forgedLedger = Buffer.from(JSON.stringify({ ...JSON.parse(forged.get('ledger.json').toString('utf8')), exportedAt: 'forged' }), 'utf8')
  forged.set('ledger.json', forgedLedger)
  forged.set('manifest.json', Buffer.from(JSON.stringify({
    ...manifest,
    bundleSha256: createHash('sha256').update(forgedLedger).digest('hex'),
  }), 'utf8'))
  const forgedFile = join(sourceDir, 'forged.zip')
  await fsp.writeFile(forgedFile, createZip([...forged].map(([name, data]) => ({ name, data }))))
  await assert.rejects(
    tools.get('exp_import').execute({ path: forgedFile }, targetExec),
    /signature verification failed/,
  )

  const auditTampered = new Map(files)
  const auditLines = auditTampered.get('audit.ndjson').toString('utf8').trim().split('\n')
  const auditEntry = JSON.parse(auditLines[0])
  auditEntry.action = 'tampered'
  auditLines[0] = JSON.stringify(auditEntry)
  auditTampered.set('audit.ndjson', Buffer.from(`${auditLines.join('\n')}\n`, 'utf8'))
  const auditFile = join(sourceDir, 'audit-tampered.zip')
  await fsp.writeFile(auditFile, createZip([...auditTampered].map(([name, data]) => ({ name, data }))))
  await assert.rejects(
    tools.get('exp_import').execute({ path: auditFile }, targetExec),
    /audit chain is broken/,
  )
})

test('exp_conclude records a decision history and reports it', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-conclude-'))
  const tools = await mount()
  const exec = execAt(dir)
  const defined = await tools.get('exp_define').execute({ name: 'Conclusion', metrics: ['score'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]

  await tools.get('exp_conclude').execute({
    experimentId, text: 'Try a wider grid', status: 'draft',
  }, exec)
  const approved = await tools.get('exp_conclude').execute({
    experimentId, text: 'Kp=1.8 wins', status: 'approved', note: 'reviewed', decidedBy: 'lead', role: 'maintainer',
  }, exec)
  assert.match(approved, /\[approved\]/)
  assert.match(approved, /2 decision entries/)
  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].conclusion.status, 'approved')
  assert.equal(ledger.experiments[0].conclusion.text, 'Kp=1.8 wins')
  assert.equal(ledger.experiments[0].conclusion.role, 'maintainer')
  assert.equal(ledger.experiments[0].conclusion.history.length, 2)
  const shown = await tools.get('exp_show').execute({ experimentId }, exec)
  assert.match(shown, /conclusion \[approved\] · by lead \(maintainer\)/)
  const report = await tools.get('exp_report').execute({ experimentId }, exec)
  assert.match(report, /Report written/)
  const reportFile = report.match(/: (.+report\.md)/)[1]
  const markdown = await fsp.readFile(reportFile, 'utf8')
  assert.match(markdown, /## Conclusion \(approved\)/)
  assert.match(markdown, /Kp=1\.8 wins/)
})

test('exp_clone copies a template and exp_batch records parameter rows', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-clone-'))
  const tools = await mount()
  const exec = execAt(dir)
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"score\": ' + Number(process.argv[2]) + '}')\n", 'utf8')

  const defined = await tools.get('exp_define').execute({
    name: 'Template', factors: ['lr'], metrics: ['score'],
  }, exec)
  const sourceId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  const cloned = await tools.get('exp_clone').execute({ experimentId: sourceId }, exec)
  assert.match(cloned, /Cloned/)
  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  const clone = ledger.experiments.find((experiment) => experiment.name === 'Template (clone)')
  assert.equal(clone.factors[0].key, 'lr')
  assert.equal(clone.metrics[0].key, 'score')
  assert.equal(clone.runs.length, 0)

  const batch = await tools.get('exp_batch').execute({
    experimentId: clone.id,
    command: `"${process.execPath}" "${script}" "{lr}"`,
    rows: [{ lr: 0.1 }, { lr: 0.2 }],
  }, exec)
  assert.match(batch, /2\/2 ok/)
  const after = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  const runs = after.experiments.find((experiment) => experiment.id === clone.id).runs
  assert.equal(runs.length, 2)
  assert.deepEqual(runs.map((run) => run.metrics.score), [0.1, 0.2])
})

test('exp_dataset registers files, imports the data console, and feeds datasetId SQL metrics', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-dataset-'))
  const tools = await mount()
  const exec = execAt(dir)
  const csv = join(dir, 'measurements.csv')
  await fsp.writeFile(csv, 'x,y\n1,2\n3,4\n', 'utf8')
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('done')\n", 'utf8')

  const registered = await tools.get('exp_dataset').execute({ path: csv }, exec)
  assert.match(registered, /ds-[a-f0-9]{10}/)
  const datasetId = registered.match(/ds-[a-f0-9]{10}/)[0]
  const listed = await tools.get('exp_dataset').execute({ list: true }, exec)
  assert.match(listed, new RegExp(datasetId))
  assert.match(listed, /measurements\.csv/)

  const defined = await tools.get('exp_define').execute({
    name: 'Dataset metric',
    metrics: [{ key: 'mean_y', sql: 'SELECT avg(y) AS value FROM data', datasetId, direction: 'max' }],
  }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_run').execute({ experimentId, command: `"${process.execPath}" "${script}"` }, exec)
  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].metrics[0].datasetId, datasetId)
  assert.equal(ledger.experiments[0].runs[0].metrics.mean_y, 3)

  const home = await fsp.mkdtemp(join(tmpdir(), 'exp-dchome-'))
  await fsp.mkdir(join(home, 'data-console'), { recursive: true })
  await fsp.writeFile(join(home, 'data-console', 'datasets.json'), JSON.stringify({
    open: [{ path: csv, name: 'imported.csv' }],
    recent: [],
  }), 'utf8')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const imported = await tools.get('exp_dataset').execute({ dataConsole: true, root: join(dir, 'imported-ledger') }, exec)
    assert.match(imported, /data-console/)
    assert.match(imported, /ds-/)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

test('exp_report format html writes a self-contained HTML report', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-html-'))
  const tools = await mount()
  const exec = execAt(dir)
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"score\": 2}')\n", 'utf8')
  const defined = await tools.get('exp_define').execute({
    name: 'HTML <report>', metrics: [{ key: 'score', direction: 'max' }],
  }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_run').execute({
    experimentId, command: `"${process.execPath}" "${script}"`, params: { lr: 0.1 },
  }, exec)

  const report = await tools.get('exp_report').execute({ experimentId, format: 'html' }, exec)
  assert.match(report, /HTML report/)
  assert.match(report, /report\.html/)
  const file = report.match(/: (.+report\.html)/)[1]
  const html = await fsp.readFile(file, 'utf8')
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<style>/)
  assert.match(html, /<svg/)
  assert.match(html, /charts-grid/)
  assert.match(html, /HTML &lt;report&gt;/)
  assert.match(html, /score/)
  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].reports.at(-1).format, 'html')
})

test('exp_update, exp_update_run and exp_delete_run manage the lifecycle', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-lifecycle-'))
  const tools = await mount()
  const exec = execAt(dir)
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"m\": 1}')\n", 'utf8')

  const defined = await tools.get('exp_define').execute({ name: 'Lifecycle', metrics: ['m'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_run').execute({ experimentId, command: `"${process.execPath}" "${script}"` }, exec)

  const updated = await tools.get('exp_update').execute({
    experimentId, name: 'Renamed', description: 'new description', tags: ['alpha', 'beta'], archived: true,
  }, exec)
  assert.match(updated, /Renamed/)
  assert.match(updated, /archived/)

  const listed = await tools.get('exp_list').execute({}, exec)
  assert.doesNotMatch(listed, /Renamed/)
  const all = await tools.get('exp_list').execute({ includeArchived: true }, exec)
  assert.match(all, /Renamed/)
  assert.match(all, /alpha, beta/)
  assert.match(all, /archived/)

  await tools.get('exp_update').execute({ experimentId, archived: false }, exec)
  const runId = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8')).experiments[0].runs[0].id
  await tools.get('exp_update_run').execute({ experimentId, runId, notes: 'keep this' }, exec)
  const shown = await tools.get('exp_show').execute({ experimentId, runId }, exec)
  assert.match(shown, /keep this/)

  await assert.rejects(
    tools.get('exp_delete_run').execute({ experimentId, runId, confirm: false }, exec),
    /confirm=true/,
  )
  await tools.get('exp_delete_run').execute({ experimentId, runId, confirm: true }, exec)
  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].runs.length, 0)
  assert.equal(ledger.experiments[0].archived, false)
})

test('exp_anchor writes and verifies an external file anchor', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-anchor-'))
  const tools = await mount()
  const exec = execAt(dir)
  const defined = await tools.get('exp_define').execute({ name: 'Anchor lab', metrics: ['score'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_conclude').execute({ experimentId, text: 'Anchor it', status: 'approved', decidedBy: 'lead' }, exec)

  const anchorFile = join(dir, 'anchor.json')
  const anchored = await tools.get('exp_anchor').execute({ mode: 'file', path: anchorFile, note: 'release' }, exec)
  assert.match(anchored, /Anchored audit head/)
  const anchor = JSON.parse(await fsp.readFile(anchorFile, 'utf8'))
  assert.equal(anchor.note, 'release')
  assert.ok(anchor.count >= 1)
  assert.equal(typeof anchor.headHash, 'string')
  const audit = await tools.get('exp_audit').execute({ verify: true }, exec)
  assert.match(audit, /1\/1 anchors valid/)
  const verified = await tools.get('exp_verify_anchor').execute({ mode: 'file', path: anchorFile }, exec)
  assert.match(verified, /Anchor verified/)

  await fsp.writeFile(anchorFile, JSON.stringify({ ...anchor, headHash: 'f'.repeat(64) }), 'utf8')
  await assert.rejects(
    tools.get('exp_verify_anchor').execute({ mode: 'file', path: anchorFile }, exec),
    /does not match the local audit chain/,
  )
})

test('exp_report format print writes a print-optimised report', async () => {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'exp-print-'))
  const tools = await mount()
  const exec = execAt(dir)
  const script = join(dir, 'job.mjs')
  await fsp.writeFile(script, "console.log('EXP_METRICS: {\"score\": 1}')\n", 'utf8')
  const defined = await tools.get('exp_define').execute({ name: 'Print report', metrics: ['score'] }, exec)
  const experimentId = defined.match(/Experiment (exp-[\w-]+)/)[1]
  await tools.get('exp_run').execute({ experimentId, command: `"${process.execPath}" "${script}"` }, exec)
  const report = await tools.get('exp_report').execute({ experimentId, format: 'print' }, exec)
  assert.match(report, /Print report/)
  assert.match(report, /report-print\.html/)
  const file = report.match(/: (.+report-print\.html)/)[1]
  const html = await fsp.readFile(file, 'utf8')
  assert.match(html, /@media print/)
  assert.match(html, /charts-grid/)
  const ledger = JSON.parse(await fsp.readFile(join(dir, '.experiments', 'ledger.json'), 'utf8'))
  assert.equal(ledger.experiments[0].reports.at(-1).format, 'print')
})

