/**
 * Host half of the Experiment ledger bundle.
 *
 * Registers the model-facing tools over a project-local ledger
 * (`<cwd>/.experiments/ledger.json` by default) and the routes the browser
 * panel calls. The panel promotes candidates, runs background sweeps and
 * writes reports through those routes; the tools reuse the same helpers.
 *
 * @module dsh-experiment-ledger
 */
import { existsSync, promises as fsp } from 'node:fs'
import { spawn, execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { isAbsolute, dirname, join, relative, resolve, sep, basename } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { loadLedger, saveLedger, resolveRoot, rememberRoot, listRoots } from './lib/store.js'
import {
  newId,
  normalizeFactors,
  normalizeMetricDefs,
  normalizeParams,
  normalizeMetrics,
  parseMetricsText,
  mergeMetrics,
  summarizeExperiment,
  formatExperimentDetail,
  formatRunDetail,
  formatDuration,
  formatValue,
  truncate,
} from './lib/model.js'
import { runCommand, hashFile } from './lib/runner.js'
import { compareRuns, formatComparison, formatNumber, varyingFactors } from './lib/compare.js'
import { writeReport } from './lib/report.js'
import { writeHtmlReport } from './lib/html-report.js'
import { createZip, readZip, looksLikeZip } from './lib/zip.js'
import { signBytes, verifyBytes, signingKey, keyId as keyFingerprint, rotateSigningKey } from './lib/signing.js'
import { isTrustedKey, removeTrustedKey, trustKey, trustedKeys, revokeKey, trustStatus } from './lib/trust.js'
import { appendAudit, auditAnchor, auditEntries, parseAuditLines, verifyAudit, verifyAuditEntries } from './lib/audit.js'
import { appendAnchor, listAnchors, verifyAnchors } from './lib/anchors.js'
import { collectDatasets } from './lib/datasets.js'
import { diffRuns, formatDiff } from './lib/diff.js'
import { recordCandidate, listCandidates, findCandidate, removeCandidate } from './lib/recorder.js'
import { computeSqlMetrics } from './lib/sql.js'

/** Route prefix owned by this package; nothing else claims it. */
const ROUTE_BASE = '/plugin-experiment-ledger'
/** Package-private request header; a custom header forces a CORS preflight. */
const REQUEST_HEADER = 'x-dsh-experiment-ledger'
/** Default command timeout: half an hour. */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
/** Inline output kept in the ledger; full logs stay in the run directory. */
const INLINE_STDOUT = 2000
const INLINE_STDERR = 1000
/** Bounded request body for future write routes. */
const BODY_LIMIT = 64 * 1024

/** Host services this plugin needs. */
export const inject = ['tools', 'webServer']

/**
 * Run git and return stdout.
 * @param {string[]} args - git arguments.
 * @param {string} cwd - repository/work directory.
 * @returns {Promise<string>} stdout.
 */
function gitExec(args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error !== null) rejectPromise(new Error(String(stderr || error.message).trim() || 'git failed'))
      else resolvePromise(String(stdout).trim())
    })
  })
}

/**
 * Sign one approve/reject decision with the local key.
 * @param {string} experimentId - experiment id.
 * @param {{status: string, text: string, decidedBy: string|null, role: string|null, at: number}} decision - decision.
 * @returns {object|null} signature block, or null for a draft.
 */
function decisionSignature(experimentId, decision) {
  if (decision.status !== 'approved' && decision.status !== 'rejected') return null
  const canonical = JSON.stringify({
    experimentId,
    status: decision.status,
    text: decision.text,
    decidedBy: decision.decidedBy ?? null,
    role: decision.role ?? null,
    at: decision.at,
  })
  const signature = signBytes(Buffer.from(canonical), { signer: decision.decidedBy ?? null })
  trustKey({ keyId: signature.keyId, publicKey: signature.publicKey, label: signature.signer ?? 'local' })
  appendAudit({
    action: `decision.${decision.status}`,
    actor: decision.decidedBy ?? null,
    detail: { experimentId, status: decision.status, keyId: signature.keyId, at: decision.at },
  })
  return signature
}

/**
 * Local tool-definition helper: a linked workspace plugin cannot import the
 * shipped `defineTool` by bare specifier, so the registry-ready shape is
 * produced directly.
 * @param {object} options - definition fields.
 * @returns {object} the registry-ready definition.
 */
function defineTool(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    output: options.output,
    async execute(args, exec) {
      return await options.execute(args, exec)
    },
  }
}

/**
 * @param {object} exec - tool execution context.
 * @returns {string} the session working directory.
 */
function cwdOf(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

/**
 * Resolve the ledger directory for one tool call.
 * @param {object} exec - tool execution context.
 * @param {{root?: string}} args - tool arguments.
 * @returns {string} absolute ledger directory.
 */
function ledgerRoot(exec, args) {
  return resolveRoot(args?.root, cwdOf(exec))
}

/**
 * @param {{experiments: object[]}} ledger - one ledger.
 * @param {string} id - experiment id.
 * @returns {object | undefined} the experiment.
 */
function findExperiment(ledger, id) {
  return ledger.experiments.find((experiment) => experiment.id === id)
}

/**
 * @param {{experiments: object[]}} ledger - one ledger.
 * @param {string} id - experiment id.
 * @returns {object} the experiment.
 */
function requireExperiment(ledger, id) {
  const experiment = findExperiment(ledger, id)
  if (experiment === undefined) {
    throw new Error(`experiment not found: ${id}. Use exp_list to see available ids.`)
  }
  return experiment
}

/**
 * Replace `{param}` placeholders with values. Shell syntax such as `${VAR}` and
 * JSON object literals are left untouched because their first character is not
 * a letter.
 * @param {string} command - command template.
 * @param {Record<string, string | number | boolean>} params - parameter values.
 * @returns {string} the command to run.
 */
function substitute(command, params) {
  return command.replace(/\{([A-Za-z][A-Za-z0-9_.-]*)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  })
}

/**
 * Environment variables exposing each parameter to the command.
 * @param {Record<string, string | number | boolean>} params - parameters.
 * @returns {Record<string, string>} environment additions.
 */
function paramEnv(params) {
  const env = {}
  for (const [key, value] of Object.entries(params)) {
    env[`EXP_PARAM_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] = String(value)
  }
  return env
}

/**
 * Hash every declared artifact, keeping missing paths as findings.
 * @param {unknown} paths - declared artifact paths.
 * @param {string} cwd - base directory for relative paths.
 * @returns {Promise<object[]>} artifact records.
 */
async function collectArtifacts(paths, cwd) {
  if (paths === undefined || paths === null) return []
  if (!Array.isArray(paths)) throw new Error('artifacts must be an array of paths')
  const artifacts = []
  for (const raw of paths) {
    if (typeof raw !== 'string' || raw.trim() === '') throw new Error('each artifact must be a non-empty path')
    const target = isAbsolute(raw) ? raw : resolve(cwd, raw)
    try {
      const stat = await fsp.stat(target)
      if (!stat.isFile()) {
        artifacts.push({ path: target, missing: true, reason: 'not a file' })
        continue
      }
      const digest = await hashFile(target)
      artifacts.push({ path: target, sha256: digest.sha256, bytes: digest.bytes })
    } catch {
      artifacts.push({ path: target, missing: true })
    }
  }
  return artifacts
}

/**
 * Read a run's `metrics.json` file, when the command wrote one.
 * @param {string} runDir - run directory.
 * @returns {Promise<Record<string, string | number>>} parsed metrics.
 */
async function readMetricsFile(runDir) {
  try {
    const text = await fsp.readFile(join(runDir, 'metrics.json'), 'utf8')
    const parsed = JSON.parse(text)
    return normalizeMetrics(parsed)
  } catch {
    return {}
  }
}

/**
 * Resolve DSH's home directory, where the data console stores its state.
 * @returns {string} DSH home.
 */
function dshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  if (process.env.DSH_PROFILE_DIR) return dirname(dirname(process.env.DSH_PROFILE_DIR))
  return join(homedir(), '.dsh')
}

/**
 * Return the ledger's dataset registry, creating it when absent.
 * @param {object} ledger - ledger.
 * @returns {object[]} registry records.
 */
function datasetRegistry(ledger) {
  if (!Array.isArray(ledger.datasets)) ledger.datasets = []
  return ledger.datasets
}

/**
 * Add one file to the registry by content hash (idempotent).
 * @param {object} ledger - ledger.
 * @param {string} file - absolute file path.
 * @param {{name?: string, source?: string}} options - display name and source.
 * @returns {Promise<{record: object, created: boolean}>} registry record.
 */
async function addDatasetRecord(ledger, file, options = {}) {
  if (!existsSync(file)) throw new Error(`dataset file not found: ${file}`)
  const digest = await hashFile(file)
  const registry = datasetRegistry(ledger)
  const existing = registry.find((record) => record.sha256 === digest.sha256)
  if (existing !== undefined) {
    if (options.source === 'data-console') existing.source = 'data-console'
    return { record: existing, created: false }
  }
  let id = `ds-${digest.sha256.slice(0, 10)}`
  let suffix = 2
  while (registry.some((record) => record.id === id)) {
    id = `ds-${digest.sha256.slice(0, 10)}-${suffix}`
    suffix += 1
  }
  const record = {
    id,
    name: typeof options.name === 'string' && options.name.trim() !== '' ? options.name.trim() : basename(file),
    path: resolve(file),
    sha256: digest.sha256,
    bytes: digest.bytes,
    source: typeof options.source === 'string' && options.source !== '' ? options.source : 'file',
    createdAt: Date.now(),
  }
  registry.push(record)
  return { record, created: true }
}

/**
 * Format the dataset registry for a tool result.
 * @param {string} root - ledger directory.
 * @param {object} ledger - ledger.
 * @returns {string} text.
 */
function formatDatasetRegistry(root, ledger) {
  const registry = datasetRegistry(ledger)
  if (registry.length === 0) return `No datasets registered in ${root}. Use exp_dataset path="…" or dataConsole=true.`
  const lines = [`${registry.length} dataset(s) in ${root}:`]
  for (const record of registry) {
    const size = record.bytes < 1024 ? `${record.bytes} B` : `${(record.bytes / 1024).toFixed(1)} KB`
    lines.push(`- ${record.id} · ${record.name} · ${record.path} · ${size} · sha256 ${record.sha256.slice(0, 12)}… · ${record.source}`)
  }
  return lines.join('\n')
}

/**
 * Read the data console's open/recent file list and register those files.
 * @param {object} ledger - ledger.
 * @returns {Promise<object[]>} registry records imported.
 */
async function importDataConsoleDatasets(ledger) {
  const stateFile = join(dshHome(), 'data-console', 'datasets.json')
  if (!existsSync(stateFile)) throw new Error(`data console state not found: ${stateFile}`)
  let state
  try {
    state = JSON.parse(await fsp.readFile(stateFile, 'utf8'))
  } catch {
    throw new Error(`data console state is not valid JSON: ${stateFile}`)
  }
  const entries = [...(Array.isArray(state.open) ? state.open : []), ...(Array.isArray(state.recent) ? state.recent : [])]
  const byPath = new Map()
  for (const entry of entries) {
    if (entry !== null && typeof entry === 'object' && typeof entry.path === 'string' && entry.path !== '') {
      if (!byPath.has(entry.path)) byPath.set(entry.path, entry)
    }
  }
  const records = []
  for (const [path, entry] of byPath) {
    if (!existsSync(path)) continue
    const added = await addDatasetRecord(ledger, path, {
      name: typeof entry.name === 'string' ? entry.name : basename(path),
      source: 'data-console',
    })
    records.push(added.record)
  }
  return records
}

/** Portable ledger bundle format marker. */
const BUNDLE_FORMAT = 'dsh-experiment-ledger-bundle'
/** Supported bundle schema version. */
const BUNDLE_VERSION = 1
/** Largest import bundle read into memory. */
const BUNDLE_LIMIT = 50 * 1024 * 1024

/**
 * Build the portable bundle object (without writing it).
 * @param {string} root - source ledger directory.
 * @param {object} ledger - loaded ledger.
 * @param {{experimentId?: string}} options - export options.
 * @returns {object} bundle.
 */
function buildLedgerBundle(root, ledger, options = {}) {
  const experiments = typeof options.experimentId === 'string' && options.experimentId !== ''
    ? [requireExperiment(ledger, options.experimentId)]
    : ledger.experiments
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    source: { root, ledgerVersion: ledger.version ?? 1 },
    counts: {
      experiments: experiments.length,
      runs: experiments.reduce((sum, experiment) => sum + (experiment.runs?.length ?? 0), 0),
      datasets: Array.isArray(ledger.datasets) ? ledger.datasets.length : 0,
      compareReports: Array.isArray(ledger.compareReports) ? ledger.compareReports.length : 0,
    },
    experiments,
    datasets: Array.isArray(ledger.datasets) ? ledger.datasets : [],
    compareReports: Array.isArray(ledger.compareReports) ? ledger.compareReports : [],
    audit: auditAnchor(),
  }
}

/**
 * Build and write a portable ledger bundle.
 * @param {string} root - source ledger directory.
 * @param {object} ledger - loaded ledger.
 * @param {{path?: string, cwd?: string, experimentId?: string}} options - export options.
 * @returns {Promise<object>} written bundle metadata.
 */
async function exportLedgerBundle(root, ledger, options = {}) {
  const bundle = buildLedgerBundle(root, ledger, options)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = typeof options.path === 'string' && options.path.trim() !== ''
    ? resolve(options.cwd ?? process.cwd(), options.path.trim())
    : join(root, 'exports', `ledger-${stamp}.json`)
  await fsp.mkdir(dirname(file), { recursive: true })
  await fsp.writeFile(file, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
  const digest = await hashFile(file)
  return {
    path: file,
    relative: relative(root, file),
    bytes: digest.bytes,
    sha256: digest.sha256,
    counts: bundle.counts,
  }
}

/**
 * Collect files under one directory into zip entries.
 * @param {string} directory - absolute directory.
 * @param {string} prefix - zip path prefix.
 * @param {object[]} entries - output entries.
 * @param {string[]} missing - output skipped files.
 * @returns {Promise<void>} resolution after walking.
 */
async function collectPackageFiles(directory, prefix, entries, missing) {
  if (!existsSync(directory)) return
  let items
  try {
    items = await fsp.readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const item of items) {
    if (entries.length >= 300) return
    const absolute = join(directory, item.name)
    const name = `${prefix}/${item.name}`
    if (item.isDirectory()) {
      await collectPackageFiles(absolute, name, entries, missing)
      continue
    }
    if (!item.isFile()) continue
    try {
      const stat = await fsp.stat(absolute)
      if (stat.size > 5 * 1024 * 1024) {
        missing.push(`${name} (larger than 5 MB)`)
        continue
      }
      entries.push({ name, data: await fsp.readFile(absolute) })
    } catch {
      missing.push(name)
    }
  }
}

/**
 * Build a short Markdown summary for a share package.
 * @param {object} bundle - ledger bundle.
 * @returns {string} Markdown.
 */
function packageSummary(bundle) {
  const lines = ['# Experiment ledger package', '', `Generated: ${bundle.exportedAt}`, '']
  for (const experiment of bundle.experiments) {
    const conclusion = experiment.conclusion
    lines.push(`## ${experiment.name}`)
    lines.push('')
    lines.push(`- id: \`${experiment.id}\``)
    lines.push(`- runs: ${Array.isArray(experiment.runs) ? experiment.runs.length : 0}`)
    if (conclusion !== undefined && conclusion !== null) {
      lines.push(`- conclusion: **${conclusion.status ?? 'draft'}** — ${conclusion.text ?? '—'}`)
      if (conclusion.decidedBy) lines.push(`- decided by: ${conclusion.decidedBy}${conclusion.role ? ` (${conclusion.role})` : ''}`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

/**
 * Collect dataset files referenced by the ledger or exported runs.
 * @param {object} ledger - ledger.
 * @param {object} bundle - exported bundle.
 * @returns {Array<{sha256: string, name: string, path: string}>} unique existing files.
 */
function packageDatasetCandidates(ledger, bundle) {
  const records = new Map()
  const add = (record) => {
    if (record === null || typeof record !== 'object' || typeof record.path !== 'string' || typeof record.sha256 !== 'string') return
    if (!existsSync(record.path) || records.has(record.sha256)) return
    records.set(record.sha256, { sha256: record.sha256, name: record.name || basename(record.path), path: record.path })
  }
  for (const record of Array.isArray(ledger.datasets) ? ledger.datasets : []) add(record)
  for (const experiment of bundle.experiments) {
    for (const run of Array.isArray(experiment.runs) ? experiment.runs : []) {
      for (const record of Array.isArray(run.datasets) ? run.datasets : []) add(record)
    }
  }
  return [...records.values()]
}

/**
 * Build and write a portable zip package: bundle + run logs + reports.
 * @param {string} root - source ledger directory.
 * @param {object} ledger - loaded ledger.
 * @param {{path?: string, cwd?: string, experimentId?: string}} options - export options.
 * @returns {Promise<object>} written package metadata.
 */
async function exportLedgerPackage(root, ledger, options = {}) {
  const bundle = buildLedgerBundle(root, ledger, options)
  const ledgerText = `${JSON.stringify(bundle, null, 2)}\n`
  const bundleSha256 = createHash('sha256').update(ledgerText).digest('hex')
  const audit = bundle.audit ?? auditAnchor()
  const signature = options.sign === false
    ? null
    : (() => {
      const block = signBytes(Buffer.from(`${bundleSha256}\n${audit.headHash}`), { signer: options.signer })
      block.scope = 'bundleSha256+auditHead'
      return block
    })()
  if (signature !== null) {
    trustKey({ keyId: signature.keyId, publicKey: signature.publicKey, label: signature.signer ?? 'local' })
  }
  const entries = [{ name: 'ledger.json', data: ledgerText }]
  const missing = []
  for (const experiment of bundle.experiments) {
    for (const run of Array.isArray(experiment.runs) ? experiment.runs : []) {
      for (const file of ['stdout.log', 'stderr.log', 'metrics.json', 'command.txt']) {
        const absolute = join(root, 'runs', run.id, file)
        if (!existsSync(absolute)) continue
        try {
          const stat = await fsp.stat(absolute)
          if (stat.size > 5 * 1024 * 1024) {
            missing.push(`runs/${run.id}/${file} (larger than 5 MB)`)
            continue
          }
          entries.push({ name: `runs/${run.id}/${file}`, data: await fsp.readFile(absolute) })
        } catch {
          missing.push(`runs/${run.id}/${file}`)
        }
      }
    }
  }
  await collectPackageFiles(join(root, 'reports'), 'reports', entries, missing)
  const packedDatasets = []
  if (options.datasets !== false) {
    let total = 0
    for (const record of packageDatasetCandidates(ledger, bundle)) {
      try {
        const stat = await fsp.stat(record.path)
        if (stat.size > 30 * 1024 * 1024 || total + stat.size > 100 * 1024 * 1024) {
          missing.push(`dataset ${record.name} (too large for the package)`)
          continue
        }
        total += stat.size
        const safeName = record.name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'dataset.csv'
        const entry = `datasets/${record.sha256.slice(0, 16)}/${safeName}`
        entries.push({ name: entry, data: await fsp.readFile(record.path) })
        packedDatasets.push({ sha256: record.sha256, name: record.name, entry, originalPath: record.path, bytes: stat.size })
      } catch {
        missing.push(`dataset ${record.name}`)
      }
    }
  }
  entries.push({ name: 'summary.md', data: packageSummary(bundle) })
  const auditList = auditEntries()
  entries.push({
    name: 'audit.ndjson',
    data: auditList.map((entry) => JSON.stringify(entry)).join('\n') + (auditList.length > 0 ? '\n' : ''),
  })
  const manifest = {
    format: 'dsh-experiment-ledger-package',
    version: 1,
    exportedAt: bundle.exportedAt,
    bundle: 'ledger.json',
    bundleSha256,
    compression: 'deflate',
    signature,
    audit: { ...audit, file: 'audit.ndjson' },
    datasets: packedDatasets,
    counts: {
      ...bundle.counts,
      files: entries.length + 1,
      missing: missing.length,
      conclusions: bundle.experiments.filter((experiment) => experiment.conclusion !== undefined && experiment.conclusion !== null).length,
      datasetsPacked: packedDatasets.length,
    },
    missing,
  }
  entries.push({ name: 'manifest.json', data: `${JSON.stringify(manifest, null, 2)}\n` })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = typeof options.path === 'string' && options.path.trim() !== ''
    ? resolve(options.cwd ?? process.cwd(), options.path.trim())
    : join(root, 'exports', `ledger-${stamp}.zip`)
  await fsp.mkdir(dirname(file), { recursive: true })
  const archive = createZip(entries)
  await fsp.writeFile(file, archive)
  const digest = await hashFile(file)
  return {
    path: file,
    relative: relative(root, file),
    bytes: digest.bytes,
    sha256: digest.sha256,
    format: 'zip',
    signature: signature === null ? null : { keyId: signature.keyId, signer: signature.signer },
    counts: manifest.counts,
  }
}

/**
 * Read a bundle JSON file or the ledger.json inside a package zip.
 * @param {string} file - absolute file path.
 * @returns {Promise<{bundle: object, kind: 'json' | 'zip'}>} parsed bundle.
 */
async function readLedgerBundleFile(file) {
  if (!existsSync(file)) throw new Error(`bundle not found: ${file}`)
  const size = (await fsp.stat(file)).size
  if (size > BUNDLE_LIMIT) throw new Error(`bundle is larger than ${BUNDLE_LIMIT / 1024 / 1024} MB: ${file}`)
  const raw = await fsp.readFile(file)
  if (looksLikeZip(raw)) {
    let files
    try {
      files = readZip(raw)
    } catch (error) {
      throw new Error(`package zip is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    const entry = files.get('ledger.json') ?? files.get('bundle.json')
    if (entry === undefined) throw new Error('package does not contain ledger.json')
    const manifestEntry = files.get('manifest.json')
    let verified = false
    let manifest = null
    if (manifestEntry !== undefined) {
      try {
        manifest = JSON.parse(manifestEntry.toString('utf8'))
      } catch {
        throw new Error('package manifest.json is not valid JSON')
      }
      if (typeof manifest.bundleSha256 === 'string' && manifest.bundleSha256 !== '') {
        const digest = createHash('sha256').update(entry).digest('hex')
        if (digest !== manifest.bundleSha256) throw new Error('package integrity check failed: ledger.json does not match manifest')
        verified = true
      }
      if (manifest.signature !== undefined && manifest.signature !== null) {
        const signedMessage = manifest.signature.scope === 'bundleSha256+auditHead'
          ? Buffer.from(`${manifest.bundleSha256}\n${manifest.audit?.headHash ?? ''}`)
          : entry
        if (!verifyBytes(signedMessage, manifest.signature)) throw new Error('package signature verification failed')
      }
    }
    const signature = manifest?.signature === undefined || manifest.signature === null
      ? null
      : (() => {
        const status = trustStatus(manifest.signature.keyId, manifest.signature.signedAt)
        return {
          verified: true,
          keyId: manifest.signature.keyId,
          signer: manifest.signature.signer ?? null,
          signedAt: manifest.signature.signedAt,
          trusted: status.trusted,
          trustReason: status.reason,
        }
      })()
    const auditMirror = (() => {
      if (!(typeof manifest?.audit?.file === 'string')) return null
      const file = files.get(manifest.audit.file)
      if (file === undefined) throw new Error('package audit file is missing')
      const list = parseAuditLines(file.toString('utf8'))
      const check = verifyAuditEntries(list)
      if (!check.ok) throw new Error(`package audit chain is broken at entry ${check.brokenAt}`)
      const headHash = list.length > 0 ? list[list.length - 1].hash : 'genesis'
      if (typeof manifest.audit.headHash === 'string' && headHash !== manifest.audit.headHash) {
        throw new Error('package audit head does not match manifest')
      }
      return { ok: true, count: list.length, headHash }
    })()
    const packageDatasets = (Array.isArray(manifest?.datasets) ? manifest.datasets : [])
      .filter((record) => record !== null && typeof record === 'object' && typeof record.entry === 'string')
      .map((record) => ({ ...record, data: files.get(record.entry) }))
      .filter((record) => Buffer.isBuffer(record.data))
    try {
      return { bundle: JSON.parse(entry.toString('utf8')), kind: 'zip', verified, signature, auditMirror, packageDatasets }
    } catch {
      throw new Error('package ledger.json is not valid JSON')
    }
  }
  try {
    return { bundle: JSON.parse(raw.toString('utf8')), kind: 'json', verified: false, signature: null, auditMirror: null, packageDatasets: [] }
  } catch {
    throw new Error(`bundle is not valid JSON: ${file}`)
  }
}

/**
 * Extract packed datasets under the destination ledger and rewrite bundle paths/ids.
 * @param {string} root - destination ledger directory.
 * @param {object} ledger - destination ledger.
 * @param {object} bundle - bundle to rewrite.
 * @param {Array<object>} packageDatasets - manifest records with `data` buffers.
 * @returns {Promise<{restored: number, remapped: number}>} counts.
 */
async function restorePackageDatasets(root, ledger, bundle, packageDatasets) {
  if (!Array.isArray(packageDatasets) || packageDatasets.length === 0) return { restored: 0, remapped: 0 }
  if (!Array.isArray(bundle.datasets)) bundle.datasets = []
  const existingBySha = new Map((Array.isArray(ledger.datasets) ? ledger.datasets : []).map((record) => [record.sha256, record]))
  const remap = new Map()
  const pathMap = new Map()
  for (const packed of packageDatasets) {
    if (typeof packed.sha256 !== 'string' || !Buffer.isBuffer(packed.data)) continue
    const safeName = String(packed.name ?? 'dataset.csv').replace(/[^A-Za-z0-9._-]+/g, '_') || 'dataset.csv'
    const directory = join(root, 'datasets', packed.sha256.slice(0, 16))
    const target = join(directory, safeName)
    await fsp.mkdir(directory, { recursive: true })
    await fsp.writeFile(target, packed.data)
    let record = bundle.datasets.find((entry) => entry.sha256 === packed.sha256)
    if (record === undefined) {
      record = {
        id: `ds-${packed.sha256.slice(0, 10)}`,
        name: safeName,
        path: target,
        sha256: packed.sha256,
        bytes: packed.data.length,
        source: 'package',
        createdAt: Date.now(),
      }
      bundle.datasets.push(record)
    } else {
      record.path = target
      record.source = 'package'
      record.bytes = packed.data.length
    }
    if (typeof packed.originalPath === 'string') pathMap.set(packed.originalPath, target)
    const existing = existingBySha.get(packed.sha256)
    if (existing !== undefined && existing.id !== record.id) remap.set(record.id, existing.id)
  }
  for (const experiment of Array.isArray(bundle.experiments) ? bundle.experiments : []) {
    for (const metric of Array.isArray(experiment.metrics) ? experiment.metrics : []) {
      if (typeof metric.datasetId === 'string' && remap.has(metric.datasetId)) metric.datasetId = remap.get(metric.datasetId)
      if (typeof metric.dataset === 'string' && pathMap.has(metric.dataset)) metric.dataset = pathMap.get(metric.dataset)
    }
    for (const run of Array.isArray(experiment.runs) ? experiment.runs : []) {
      for (const dataset of Array.isArray(run.datasets) ? run.datasets : []) {
        if (dataset !== null && typeof dataset === 'object' && typeof dataset.path === 'string' && pathMap.has(dataset.path)) {
          dataset.path = pathMap.get(dataset.path)
        }
      }
    }
  }
  return { restored: packageDatasets.length, remapped: remap.size }
}

/**
 * Validate and merge one imported bundle into a ledger (pure; caller saves).
 * @param {object} ledger - destination ledger.
 * @param {object} bundle - parsed bundle.
 * @param {'local' | 'incoming'} prefer - metadata/run conflict preference.
 * @returns {object} merge summary.
 */
function mergeLedgerBundle(ledger, bundle, prefer = 'local') {
  if (bundle === null || typeof bundle !== 'object' || bundle.format !== BUNDLE_FORMAT) {
    throw new Error(`not a ${BUNDLE_FORMAT} file`)
  }
  if (bundle.version !== BUNDLE_VERSION) throw new Error(`unsupported bundle version: ${bundle.version}`)
  if (!Array.isArray(bundle.experiments)) throw new Error('bundle experiments must be an array')
  const summary = {
    experimentsAdded: 0,
    experimentsMerged: 0,
    runsAdded: 0,
    runsSkipped: 0,
    datasetsAdded: 0,
    datasetsSkipped: 0,
    compareReportsAdded: 0,
  }
  const byId = new Map(ledger.experiments.map((experiment) => [experiment.id, experiment]))
  const names = new Set(ledger.experiments.map((experiment) => experiment.name))
  for (const incoming of bundle.experiments) {
    if (incoming === null || typeof incoming !== 'object' || typeof incoming.id !== 'string' || typeof incoming.name !== 'string') {
      throw new Error('bundle has an experiment without id/name')
    }
    const incomingRuns = Array.isArray(incoming.runs) ? incoming.runs : []
    const target = byId.get(incoming.id)
    if (target === undefined) {
      const copy = JSON.parse(JSON.stringify(incoming))
      copy.runs = incomingRuns
      if (names.has(copy.name)) copy.name = `${copy.name} (imported)`
      names.add(copy.name)
      ledger.experiments.push(copy)
      byId.set(copy.id, copy)
      summary.experimentsAdded += 1
      summary.runsAdded += incomingRuns.length
      continue
    }
    summary.experimentsMerged += 1
    if (prefer === 'incoming') {
      target.name = incoming.name
      names.add(target.name)
      target.description = incoming.description ?? target.description
      target.tags = Array.isArray(incoming.tags) ? incoming.tags : target.tags
      target.archived = incoming.archived === true
    }
    const mergeDefs = (key) => {
      if (!Array.isArray(incoming[key])) return
      const existing = Array.isArray(target[key]) ? target[key] : []
      const index = new Map(existing.map((entry) => [entry.key, entry]))
      for (const entry of incoming[key]) {
        if (entry === null || typeof entry !== 'object' || typeof entry.key !== 'string') continue
        if (prefer === 'incoming' || !index.has(entry.key)) index.set(entry.key, entry)
      }
      target[key] = [...index.values()]
    }
    mergeDefs('factors')
    mergeDefs('metrics')
    const runs = Array.isArray(target.runs) ? target.runs : []
    const runIndex = new Map(runs.map((run) => [run.id, run]))
    for (const run of incomingRuns) {
      if (run === null || typeof run !== 'object' || typeof run.id !== 'string') continue
      if (runIndex.has(run.id)) {
        if (prefer === 'incoming') {
          const index = runs.findIndex((entry) => entry.id === run.id)
          runs[index] = run
        } else {
          summary.runsSkipped += 1
        }
        continue
      }
      runs.push(run)
      runIndex.set(run.id, run)
      summary.runsAdded += 1
    }
    target.runs = runs
    const reports = Array.isArray(target.reports) ? target.reports : []
    const reportKeys = new Set(reports.map((report) => report.sha256 ?? report.path))
    for (const report of Array.isArray(incoming.reports) ? incoming.reports : []) {
      const key = report?.sha256 ?? report?.path
      if (key === undefined || reportKeys.has(key)) continue
      reports.push(report)
      reportKeys.add(key)
    }
    target.reports = reports
    target.updatedAt = Math.max(target.updatedAt ?? 0, incoming.updatedAt ?? 0, Date.now())
  }
  const datasets = datasetRegistry(ledger)
  const datasetKeys = new Set(datasets.map((record) => record.sha256))
  for (const record of Array.isArray(bundle.datasets) ? bundle.datasets : []) {
    if (record === null || typeof record !== 'object' || typeof record.sha256 !== 'string') continue
    if (datasetKeys.has(record.sha256)) {
      summary.datasetsSkipped += 1
      continue
    }
    datasets.push(record)
    datasetKeys.add(record.sha256)
    summary.datasetsAdded += 1
  }
  const reports = Array.isArray(ledger.compareReports) ? ledger.compareReports : []
  const reportKeys = new Set(reports.map((report) => report.sha256 ?? report.path))
  for (const report of Array.isArray(bundle.compareReports) ? bundle.compareReports : []) {
    const key = report?.sha256 ?? report?.path
    if (key === undefined || reportKeys.has(key)) continue
    reports.push(report)
    reportKeys.add(key)
    summary.compareReportsAdded += 1
  }
  ledger.compareReports = reports.slice(-20)
  ledger.updatedAt = Date.now()
  return summary
}

/**
 * Format list of experiments.
 * @param {object} ledger - one ledger.
 * @param {string} root - ledger directory.
 * @param {boolean} includeArchived - include archived experiments.
 * @returns {string} the `exp_list` text.
 */
function formatList(ledger, root, includeArchived = false) {
  const experiments = includeArchived
    ? ledger.experiments
    : ledger.experiments.filter((experiment) => experiment.archived !== true)
  if (experiments.length === 0) {
    return `No experiments in ${root} yet. Create one with exp_define.`
  }
  const lines = [`${experiments.length} experiment(s) in ${root}:`]
  const sorted = [...experiments].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
  for (const experiment of sorted) {
    const summary = summarizeExperiment(experiment)
    const last = summary.lastStatus === '' ? 'no runs' : `last ${summary.lastStatus}`
    const tags = Array.isArray(experiment.tags) && experiment.tags.length > 0 ? ` · [${experiment.tags.join(', ')}]` : ''
    const archived = experiment.archived === true ? ' · archived' : ''
    lines.push(`- ${experiment.id} · ${experiment.name} · ${summary.runs} runs · ${last}${archived}${tags} · ${new Date(summary.updatedAt || 0).toISOString()}`)
  }
  return lines.join('\n')
}

/**
 * Build the payload of one tool call: append the run and persist the ledger.
 * @param {string} root - ledger directory.
 * @param {object} ledger - ledger to update.
 * @param {object} experiment - owner experiment.
 * @param {object} run - the run record.
 * @returns {Promise<void>} resolution after the write.
 */
async function appendRun(root, ledger, experiment, run) {
  if (!Array.isArray(experiment.runs)) experiment.runs = []
  experiment.runs.push(run)
  experiment.updatedAt = Date.now()
  await saveLedger(root, ledger)
  await rememberRoot(root)
}

/**
 * One-line summary of a recorded run.
 * @param {object} run - run record.
 * @param {string} root - ledger directory.
 * @param {object} experiment - owner experiment.
 * @returns {string} text for the model.
 */
function runSummary(run, root, experiment) {
  const params = Object.entries(run.params ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')
  const metrics = Object.entries(run.metrics ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')
  const lines = [
    `Run ${run.id} recorded in ${experiment.id}: ${run.status} · ${formatDuration(run.durationMs)}${typeof run.exitCode === 'number' ? ` · exit ${run.exitCode}` : ''}`,
    `params: ${params || '—'}`,
    `metrics: ${metrics || '— (print EXP_METRICS: {json}, write metrics.json, or pass metrics)'}`,
  ]
  if (Array.isArray(run.metricErrors) && run.metricErrors.length > 0) {
    lines.push(`metric errors: ${run.metricErrors.map((entry) => `${entry.key}: ${entry.error}`).join('; ')}`)
  }
  if (Array.isArray(run.artifacts) && run.artifacts.length > 0) {
    lines.push(`artifacts: ${run.artifacts.map((artifact) => artifact.path).join(', ')}`)
  }
  if (Array.isArray(run.datasets) && run.datasets.length > 0) {
    lines.push(`datasets: ${run.datasets.map((dataset) => `${dataset.path}${typeof dataset.rows === 'number' ? ` (${dataset.rows}×${dataset.cols})` : ''}`).join(', ')}`)
  }
  if (run.stdout) lines.push(`stdout: ${join(root, run.stdout)}`)
  if (run.stderr) lines.push(`stderr: ${join(root, run.stderr)}`)
  if (run.error) lines.push(`error: ${run.error}`)
  lines.push(`Inspect with exp_show experimentId="${experiment.id}" runId="${run.id}".`)
  return lines.join('\n')
}

/**
 * Execute one command and build its run record without touching the ledger.
 * `exp_run` appends the result once; `exp_sweep` appends each result as it
 * finishes so an interrupted sweep keeps everything completed so far.
 * @param {object} options - root, experiment, command template, params and run metadata.
 * @returns {Promise<object>} the run record.
 */
async function performRun(options) {
  const { root, experiment, commandTemplate, params, label, cwd, timeoutMs, metrics, artifacts, datasets, notes } = options
  const normalized = normalizeParams(params)
  const command = typeof options.resolvedCommand === 'string' && options.resolvedCommand !== ''
    ? options.resolvedCommand
    : substitute(commandTemplate, normalized)
  const limit = typeof timeoutMs === 'number' && timeoutMs > 0
    ? Math.min(timeoutMs, 4 * 60 * 60 * 1000)
    : DEFAULT_TIMEOUT_MS
  const manifest = await captureManifest(cwd, command, limit)
  const runId = newId('run')
  const runDir = join(root, 'runs', runId)
  const startedAt = Date.now()
  const result = await runCommand({
    command,
    cwd,
    timeoutMs: limit,
    runDir,
    env: {
      ...(options.manifestEnv ?? {}),
      EXP_RUN_ID: runId,
      EXP_RUN_DIR: runDir,
      EXP_LEDGER_ROOT: root,
      EXP_EXPERIMENT_ID: experiment.id,
      ...paramEnv(normalized),
    },
  })
  const fromStdout = parseMetricsText(result.stdoutTail)
  const fromFile = await readMetricsFile(runDir)
  const explicit = normalizeMetrics(metrics)
  const sqlMetrics = await computeSqlMetrics(experiment, { cwd, root })
  const merged = mergeMetrics(sqlMetrics.values, fromStdout, fromFile, explicit)
  const artifactRecords = await collectArtifacts(artifacts, cwd)
  const declared = Array.isArray(datasets) ? datasets : []
  const datasetRecords = await collectDatasets([
    ...declared,
    ...sqlMetrics.datasets.map((file) => ({ path: file })),
  ], cwd)
  return {
    id: runId,
    label: typeof label === 'string' && label.trim() !== '' ? label.trim() : truncate(command, 80),
    status: result.status,
    params: normalized,
    metrics: merged,
    artifacts: artifactRecords,
    datasets: datasetRecords,
    ...(sqlMetrics.errors.length > 0 ? { metricErrors: sqlMetrics.errors } : {}),
    command: truncate(command, 2000),
    cwd,
    startedAt,
    endedAt: startedAt + result.durationMs,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: relative(root, result.stdoutPath),
    stderr: relative(root, result.stderrPath),
    stdoutTail: truncate(result.stdoutTail, INLINE_STDOUT),
    stderrTail: truncate(result.stderrTail, INLINE_STDERR),
    notes: typeof notes === 'string' ? truncate(notes, 1000) : '',
    executor: { kind: 'command' },
    timeoutMs: limit,
    manifest,
    ...(result.error === undefined ? {} : { error: result.error }),
  }
}

/**
 * Write a report and record it on the experiment (shared by the tool and the panel route).
 * @param {string} root - ledger directory.
 * @param {object} ledger - loaded ledger.
 * @param {object} experiment - target experiment.
 * @param {{groupBy?: string[], maxRuns?: number, format?: 'markdown' | 'html'}} options - report options.
 * @returns {Promise<object>} the written report.
 */
async function generateReportFor(root, ledger, experiment, options = {}) {
  const format = options.format === 'print' ? 'print' : options.format === 'html' ? 'html' : 'markdown'
  const report = format === 'markdown'
    ? await writeReport(root, experiment, options)
    : await writeHtmlReport(root, experiment, { ...options, print: format === 'print' })
  const record = {
    path: report.relative,
    format,
    sha256: report.sha256,
    bytes: report.bytes,
    createdAt: Date.now(),
    runs: report.summary.runs,
    charts: report.summary.charts,
  }
  experiment.reports = [...(experiment.reports ?? []), record].slice(-20)
  experiment.updatedAt = Date.now()
  await saveLedger(root, ledger)
  await rememberRoot(root)
  return report
}

/**
 * Normalize the baseline list, migrating a legacy single `baseline`.
 * @param {object} experiment - target experiment.
 * @returns {object[]} the mutable baseline list.
 */
function ensureBaselines(experiment) {
  if (!Array.isArray(experiment.baselines)) experiment.baselines = []
  const legacy = experiment.baseline
  if (legacy !== null && typeof legacy === 'object') {
    if (!experiment.baselines.some((entry) => entry.experimentId === legacy.experimentId && entry.runId === legacy.runId)) {
      experiment.baselines.unshift({ id: 'baseline-legacy', name: 'baseline', ...legacy })
    }
    delete experiment.baseline
  }
  return experiment.baselines
}

/**
 * Add, replace or clear one of an experiment's baselines.
 * @param {object} ledger - loaded ledger.
 * @param {object} experiment - target experiment.
 * @param {{clear?: boolean, baselineId?: string, name?: string, baselineExperimentId?: string, baselineRunId?: string}} options - selection.
 * @returns {object[]} the resulting baseline list.
 */
function applyBaselines(ledger, experiment, options) {
  const baselines = ensureBaselines(experiment)
  if (options.clear === true) {
    if (typeof options.baselineId === 'string' && options.baselineId !== '') {
      const index = baselines.findIndex((entry) => entry.id === options.baselineId)
      if (index < 0) throw new Error(`baseline not found: ${options.baselineId}`)
      baselines.splice(index, 1)
    } else if (typeof options.name === 'string' && options.name.trim() !== '') {
      const name = options.name.trim()
      const index = baselines.findIndex((entry) => entry.name === name)
      if (index < 0) throw new Error(`baseline not found: ${name}`)
      baselines.splice(index, 1)
    } else {
      baselines.length = 0
    }
    experiment.updatedAt = Date.now()
    return baselines
  }
  if (typeof options.baselineExperimentId !== 'string' || options.baselineExperimentId === '') {
    throw new Error('baselineExperimentId is required')
  }
  const baselineExperiment = findExperiment(ledger, options.baselineExperimentId)
  if (baselineExperiment === undefined) throw new Error(`baseline experiment not found: ${options.baselineExperimentId}`)
  const runs = Array.isArray(baselineExperiment.runs) ? baselineExperiment.runs : []
  let run
  if (typeof options.baselineRunId === 'string' && options.baselineRunId !== '') {
    run = runs.find((entry) => entry.id === options.baselineRunId)
    if (run === undefined) throw new Error(`baseline run not found: ${options.baselineRunId}`)
  } else {
    run = [...runs].reverse().find((entry) => Object.keys(entry.metrics ?? {}).length > 0) ?? runs[runs.length - 1]
    if (run === undefined) throw new Error(`baseline experiment has no runs: ${baselineExperiment.id}`)
  }
  const name = typeof options.name === 'string' && options.name.trim() !== ''
    ? options.name.trim()
    : `${baselineExperiment.name} / ${run.label ?? run.id}`
  const previous = baselines.find((entry) => entry.name === name)
  const snapshot = {
    id: previous?.id ?? `base-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name,
    experimentId: baselineExperiment.id,
    experimentName: baselineExperiment.name,
    runId: run.id,
    label: run.label ?? run.id,
    metrics: { ...(run.metrics ?? {}) },
    params: { ...(run.params ?? {}) },
    setAt: Date.now(),
  }
  const index = baselines.findIndex((entry) => entry.name === name)
  if (index >= 0) baselines[index] = snapshot
  else baselines.unshift(snapshot)
  while (baselines.length > 5) baselines.pop()
  experiment.updatedAt = Date.now()
  return baselines
}

/**
 * List, save or delete sweep presets on an experiment.
 * @param {object} experiment - target experiment.
 * @param {{action?: string, name?: string, command?: string, grid?: object, rows?: object[], maxParallel?: number, failFast?: boolean, timeoutMs?: number, presetId?: string}} options - operation.
 * @returns {object[]} the resulting presets.
 */
function applyPreset(experiment, options) {
  if (!Array.isArray(experiment.sweepPresets)) experiment.sweepPresets = []
  if (options.action === 'delete') {
    const index = experiment.sweepPresets.findIndex((entry) =>
      (typeof options.presetId === 'string' && entry.id === options.presetId) ||
      (typeof options.name === 'string' && entry.name === options.name))
    if (index < 0) throw new Error('preset not found')
    experiment.sweepPresets.splice(index, 1)
    experiment.updatedAt = Date.now()
    return experiment.sweepPresets
  }
  if (options.action === 'list') return experiment.sweepPresets
  const name = typeof options.name === 'string' ? options.name.trim() : ''
  if (name === '') throw new Error('preset name is required')
  if (typeof options.command !== 'string' || options.command.trim() === '') throw new Error('preset command is required')
  const existing = experiment.sweepPresets.find((entry) => entry.name === name)
  const preset = {
    id: existing?.id ?? `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name,
    command: options.command.trim(),
    grid: options.grid !== null && typeof options.grid === 'object' && !Array.isArray(options.grid) ? options.grid : {},
    ...(Array.isArray(options.rows) ? { rows: options.rows } : {}),
    maxParallel: typeof options.maxParallel === 'number' ? Math.min(Math.max(1, Math.round(options.maxParallel)), 4) : 1,
    failFast: options.failFast === true,
    ...(typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? { timeoutMs: options.timeoutMs } : {}),
    createdAt: Date.now(),
  }
  if (existing !== undefined) {
    experiment.sweepPresets[experiment.sweepPresets.indexOf(existing)] = preset
  } else {
    experiment.sweepPresets.unshift(preset)
  }
  while (experiment.sweepPresets.length > 10) experiment.sweepPresets.pop()
  experiment.updatedAt = Date.now()
  return experiment.sweepPresets
}

/**
 * Turn one recorded candidate into a run (shared by the tool and the panel route).
 * @param {object} options - root, ledger, experiment, candidate, cwd and optional values.
 * @returns {Promise<object>} the appended run.
 */
async function promoteCandidateRun(options) {
  const { root, ledger, experiment, candidate, cwd, params, metrics, label, notes, artifacts, datasets } = options
  const normalizedParams = normalizeParams(params)
  const sqlMetrics = await computeSqlMetrics(experiment, { cwd, root })
  const mergedMetrics = mergeMetrics(sqlMetrics.values, normalizeMetrics(metrics))
  const artifactRecords = await collectArtifacts(artifacts, cwd)
  const declared = Array.isArray(datasets) ? datasets : []
  const datasetRecords = await collectDatasets([
    ...declared,
    ...sqlMetrics.datasets.map((file) => ({ path: file })),
  ], cwd)
  const startedAt = typeof candidate.at === 'number' ? candidate.at : Date.now()
  const durationMs = typeof candidate.durationMs === 'number' ? candidate.durationMs : 0
  const run = {
    id: newId('run'),
    label: typeof label === 'string' && label.trim() !== '' ? label.trim() : truncate(candidate.command, 80),
    status: candidate.status === 'failed' ? 'failed' : 'ok',
    params: normalizedParams,
    metrics: mergedMetrics,
    artifacts: artifactRecords,
    datasets: datasetRecords,
    ...(sqlMetrics.errors.length > 0 ? { metricErrors: sqlMetrics.errors } : {}),
    command: truncate(candidate.command, 2000),
    cwd,
    startedAt,
    endedAt: startedAt + durationMs,
    durationMs,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    stdoutTail: '',
    stderrTail: '',
    notes: typeof notes === 'string' ? truncate(notes, 1000) : `recorded from ${candidate.tool} call`,
    executor: { kind: 'tool', tool: candidate.tool, candidateId: candidate.id },
  }
  await appendRun(root, ledger, experiment, run)
  await removeCandidate(candidate.id)
  return run
}

/**
 * Expand a sweep declaration into concrete parameter rows.
 * @param {{grid?: object, rows?: object[]}} args - tool arguments.
 * @returns {object[]} parameter rows.
 */
function sweepCombos(args) {
  if (Array.isArray(args.rows)) {
    if (args.rows.length === 0) throw new Error('rows must not be empty')
    return args.rows.map((row) => normalizeParams(row))
  }
  const grid = args.grid
  if (grid === null || typeof grid !== 'object' || Array.isArray(grid)) {
    throw new Error('pass grid {factor: values} or rows [{...}]')
  }
  const keys = Object.keys(grid)
  if (keys.length === 0) throw new Error('grid must declare at least one factor')
  let combos = [{}]
  for (const key of keys) {
    const values = Array.isArray(grid[key]) ? grid[key] : [grid[key]]
    if (values.length === 0) throw new Error(`grid.${key} must not be empty`)
    combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [key]: value })))
    if (combos.length > 100) throw new Error('grid expands to more than 100 runs; narrow it or use rows')
  }
  return combos.map((combo) => normalizeParams(combo))
}

/**
 * Execute a sweep's runs, reporting each completion as it happens.
 * @param {object} options - sweep inputs (root, ledger, experiment, combos and run defaults).
 * @param {(event: {index: number, run?: object, error?: string}) => void} [onResult] - progress sink.
 * @returns {Promise<{results: Array<object|{error: string}>, stopped: boolean}>} results by index.
 */
async function executeSweep(options, onResult) {
  const {
    root, ledger, experiment, combos, commandTemplate, label, cwd, timeoutMs,
    artifacts, datasets, notes, maxParallel, failFast, shouldStop,
  } = options
  const results = new Array(combos.length)
  let cursor = 0
  let stopped = false
  const parallel = Math.min(Math.max(1, Math.floor(maxParallel ?? 1)), 4, combos.length)
  const worker = async () => {
    while (true) {
      if (stopped || shouldStop?.() === true) {
        stopped = true
        return
      }
      const index = cursor
      cursor += 1
      if (index >= combos.length) return
      try {
        const run = await performRun({
          root,
          experiment,
          commandTemplate,
          params: combos[index],
          label: typeof label === 'string' && label !== '' ? `${label} #${index + 1}` : undefined,
          cwd,
          timeoutMs,
          metrics: undefined,
          artifacts,
          datasets,
          notes,
        })
        await appendRun(root, ledger, experiment, run)
        results[index] = run
        onResult?.({ index, run })
        if (failFast === true && run.status !== 'ok') stopped = true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        results[index] = { error: message }
        onResult?.({ index, error: message })
        if (failFast === true) stopped = true
      }
    }
  }
  await Promise.all(Array.from({ length: parallel }, worker))
  return { results, stopped }
}

/**
 * @param {object} exec - tool execution context.
 * @returns {string | null} the command to record, when this call is one.
 */
function recordedCommand(exec) {
  const args = exec?.arguments
  if (args === null || typeof args !== 'object') return null
  const command = typeof args.command === 'string' ? args.command.trim() : ''
  if (command === '') return null
  if (typeof exec.name === 'string' && exec.name.startsWith('exp_')) return null
  return command
}

/**
 * Observe tool results and keep the bounded candidate ring buffer.
 * @param {object} ctx - plugin context.
 */
function registerRecorder(ctx) {
  const starts = new Map()

  ctx.effect(() => ctx.on('tools/pre-execute', (exec, next) => {
    const callId = exec?.callId
    if (typeof callId === 'string') {
      starts.set(callId, Date.now())
      if (starts.size > 200) starts.delete(starts.keys().next().value)
    }
    return typeof next === 'function' ? next() : { kind: 'allow' }
  }), 'experiment-ledger: recorder start')

  ctx.effect(() => ctx.on('tools/result', (exec, result) => {
    const callId = exec?.callId
    const startedAt = typeof callId === 'string' ? starts.get(callId) : undefined
    if (typeof callId === 'string') starts.delete(callId)
    const command = recordedCommand(exec)
    if (command === null) return
    const failed = result?.isError === true || result?.error !== undefined
    void recordCandidate({
      tool: typeof exec.name === 'string' && exec.name !== '' ? exec.name : 'tool',
      command,
      cwd: exec.agent?.session?.header?.cwd ?? '',
      sessionId: exec.agent?.session?.header?.id ?? '',
      status: failed ? 'failed' : 'ok',
      durationMs: typeof startedAt === 'number' ? Math.max(0, Date.now() - startedAt) : 0,
      at: Date.now(),
    }).catch((error) => {
      ctx.logger?.warn?.('experiment-ledger: candidate record failed: %s', String(error))
    })
  }), 'experiment-ledger: recorder result')
}

/**
 * Register the model-facing tools.
 * @param {object} ctx - plugin context.
 */
function registerTools(ctx) {
  ctx.tools.register(defineTool({
    name: 'exp_define',
    description: 'Create or update an experiment ledger entry: a named research direction with declared factors and metrics. A metric may declare sql plus dataset (CSV/TSV path) or datasetId (registered by exp_dataset) to be computed from a table named data. Runs recorded later belong to this experiment. The ledger lives in <cwd>/.experiments unless root is given.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Experiment name, e.g. "PID tuning"' },
        description: { type: 'string', description: 'What the experiment is trying to find out' },
        factors: {
          type: 'array',
          description: 'Parameters varied between runs: strings or {key,label?,unit?}',
          items: { type: ['string', 'object'] },
        },
        metrics: {
          type: 'array',
          description: 'Metrics measured per run: strings or {key,label?,unit?,direction?}; add sql + dataset (CSV/TSV) or datasetId and optional column to compute the value from data',
          items: { type: ['string', 'object'] },
        },
        experimentId: { type: 'string', description: 'Update an existing experiment instead of creating one' },
        root: { type: 'string', description: 'Ledger directory (absolute or relative to the session cwd); defaults to .experiments' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const now = Date.now()
      let experiment
      if (typeof args.experimentId === 'string' && args.experimentId !== '') {
        experiment = requireExperiment(ledger, args.experimentId)
        experiment.updatedAt = now
      } else {
        experiment = {
          id: newId('exp'),
          name: args.name.trim(),
          description: typeof args.description === 'string' ? args.description.trim() : '',
          factors: [],
          metrics: [],
          createdAt: now,
          updatedAt: now,
          runs: [],
        }
        ledger.experiments.push(experiment)
      }
      if (typeof args.name === 'string' && args.name.trim() !== '') experiment.name = args.name.trim()
      if (typeof args.description === 'string') experiment.description = args.description.trim()
      if (args.factors !== undefined) experiment.factors = normalizeFactors(args.factors)
      if (args.metrics !== undefined) experiment.metrics = normalizeMetricDefs(args.metrics)
      await saveLedger(root, ledger)
      await rememberRoot(root)
      const lines = [
        `Experiment ${experiment.id} ready: ${experiment.name}`,
        `root: ${root}`,
        `factors: ${(experiment.factors ?? []).map((factor) => factor.key).join(', ') || '—'}`,
        `metrics: ${(experiment.metrics ?? []).map((metric) => metric.key).join(', ') || '—'}`,
        `Next: exp_run experimentId="${experiment.id}" command="..." params={...}`,
      ]
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_dataset',
    description: 'Register a dataset under a stable id (ds-…) for SQL metrics, or list the registry. `dataConsole=true` imports the files currently open/recent in the DSH data console.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'CSV/TSV file to register; relative paths resolve against the session cwd' },
        name: { type: 'string', description: 'Display name (defaults to the file name)' },
        dataConsole: { type: 'boolean', description: 'Import open/recent data-console datasets' },
        list: { type: 'boolean', description: 'List registered datasets instead of adding one' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      if (args.list === true || (typeof args.path !== 'string' && args.dataConsole !== true)) {
        return formatDatasetRegistry(root, ledger)
      }
      const added = []
      let importedCount = 0
      if (args.dataConsole === true) {
        const imported = await importDataConsoleDatasets(ledger)
        importedCount = imported.length
        added.push(...imported)
      }
      let registeredPath = null
      if (typeof args.path === 'string' && args.path.trim() !== '') {
        const file = resolve(cwdOf(exec), args.path.trim())
        const result = await addDatasetRecord(ledger, file, { name: args.name, source: 'file' })
        registeredPath = result.record
        added.push(result.record)
      }
      if (added.length === 0) throw new Error('no dataset to register; pass path or dataConsole=true')
      await saveLedger(root, ledger)
      await rememberRoot(root)
      const ids = [...new Set(added.map((record) => record.id))]
      const lines = []
      if (importedCount > 0) lines.push(`Imported ${importedCount} data-console dataset(s).`)
      if (registeredPath !== null) lines.push(`Registered ${registeredPath.id} (${registeredPath.name}).`)
      lines.push(`Registry in ${root}: ${ids.join(', ')}`)
      lines.push(...added.map((record) => `- ${record.id} · ${record.name} · ${record.path} · ${record.source}`))
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_export',
    description: 'Export the whole ledger (or one experiment) to a portable bundle: experiments, runs, dataset registry and comparison reports. `format="json"` (default) writes one JSON file; `format="zip"` packages the bundle plus run logs and report files. Returns the file path and SHA-256.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Output file; defaults to <root>/exports/ledger-<stamp>.json or .zip' },
        format: { type: 'string', enum: ['json', 'zip'], description: 'json bundle (default) or zip package' },
        sign: { type: 'boolean', description: 'Sign the zip package with the local Ed25519 key (default true)' },
        signer: { type: 'string', description: 'Optional signer label stored in the signature' },
        experimentId: { type: 'string', description: 'Export only this experiment instead of the whole ledger' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const zip = args.format === 'zip'
      const bundle = zip
        ? await exportLedgerPackage(root, ledger, {
          path: args.path,
          cwd: cwdOf(exec),
          experimentId: args.experimentId,
          sign: args.sign !== false,
          signer: args.signer,
        })
        : await exportLedgerBundle(root, ledger, { path: args.path, cwd: cwdOf(exec), experimentId: args.experimentId })
      await rememberRoot(root)
      appendAudit({
        action: 'package.export',
        actor: bundle.signature?.signer ?? null,
        detail: { path: bundle.path, format: zip ? 'zip' : 'json', keyId: bundle.signature?.keyId ?? null },
      })
      const size = bundle.bytes < 1024 ? `${bundle.bytes} B` : `${(bundle.bytes / 1024).toFixed(1)} KB`
      return [
        `${zip ? 'Ledger package' : 'Ledger bundle'} written: ${bundle.path}`,
        `size: ${size} · sha256: ${bundle.sha256.slice(0, 16)}… · experiments: ${bundle.counts.experiments} · runs: ${bundle.counts.runs} · datasets: ${bundle.counts.datasets} · comparison reports: ${bundle.counts.compareReports}${zip ? ` · files: ${bundle.counts.files}` : ''}`,
        ...(zip && bundle.signature ? [`signature: ed25519 · key ${bundle.signature.keyId}${bundle.signature.signer ? ` · ${bundle.signature.signer}` : ''}`] : []),
        'Import it with exp_import path="…"; the default merge keeps local conflicts.',
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_import',
    description: 'Import a ledger bundle or zip package written by exp_export and merge it into a ledger. Experiments merge by id, runs by id, datasets by SHA-256 and comparison reports by digest; `prefer="incoming"` lets imported metadata/duplicate runs win. Use dryRun=true to preview counts first.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Bundle JSON file or package zip' },
        prefer: { type: 'string', enum: ['local', 'incoming'], description: 'Conflict preference (default local)' },
        requireTrusted: { type: 'boolean', description: 'Require a trusted signing key (unsigned/untrusted packages are rejected)' },
        dryRun: { type: 'boolean', description: 'Only report what would be merged' },
        root: { type: 'string', description: 'Destination ledger directory; defaults to .experiments' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const file = resolve(cwdOf(exec), args.path)
      const { bundle, kind, verified, packageDatasets, signature, auditMirror } = await readLedgerBundleFile(file)
      if (args.requireTrusted === true) {
        if (signature === null) throw new Error('package is unsigned; requireTrusted needs a signed zip')
        if (!signature.trusted) throw new Error(`package signing key is not trusted: ${signature.keyId}`)
      }
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const prefer = args.prefer === 'incoming' ? 'incoming' : 'local'
      let datasetsRestored = 0
      if (args.dryRun !== true && packageDatasets.length > 0) {
        datasetsRestored = (await restorePackageDatasets(root, ledger, bundle, packageDatasets)).restored
      }
      if (args.dryRun === true) {
        const preview = JSON.parse(JSON.stringify(ledger))
        const summary = mergeLedgerBundle(preview, bundle, prefer)
        return [
          `Dry run: ${kind === 'zip' ? 'package' : 'bundle'} ${file} → ${root} (prefer ${prefer})`,
          `experiments +${summary.experimentsAdded} · merged ${summary.experimentsMerged} · runs +${summary.runsAdded} (${summary.runsSkipped} kept) · datasets +${summary.datasetsAdded} · comparison reports +${summary.compareReportsAdded}`,
          'Nothing was written. Run again without dryRun to import.',
        ].join('\n')
      }
      const summary = mergeLedgerBundle(ledger, bundle, prefer)
      await saveLedger(root, ledger)
      await rememberRoot(root)
      appendAudit({
        action: 'package.import',
        actor: signature?.signer ?? null,
        detail: { path: file, kind, keyId: signature?.keyId ?? null, trust: signature?.trusted ? signature.trustReason : 'untrusted' },
      })
      return [
        `Imported ${kind === 'zip' ? 'package' : 'bundle'} ${file} into ${root} (prefer ${prefer}).`,
        `${kind === 'zip' ? `integrity: ${verified ? 'verified' : 'no manifest digest'}${signature ? ` · signature: verified (${signature.keyId}${signature.signer ? `/${signature.signer}` : ''}) · trust: ${signature.trusted ? signature.trustReason : 'untrusted'}` : ' · unsigned'}${auditMirror ? ` · audit mirror: ok (${auditMirror.count} entries)` : ''} · ` : ''}${datasetsRestored > 0 ? `datasets restored: ${datasetsRestored} · ` : ''}experiments +${summary.experimentsAdded} · merged ${summary.experimentsMerged} · runs +${summary.runsAdded} (${summary.runsSkipped} kept) · datasets +${summary.datasetsAdded} (${summary.datasetsSkipped} kept) · comparison reports +${summary.compareReportsAdded}`,
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_trust_key',
    description: 'List, add or remove trusted package signing keys. Add the local key, a package\'s embedded key (path=…), or a PEM public key; imports can then require a trusted signature.',
    parameters: {
      type: 'object',
      properties: {
        list: { type: 'boolean', description: 'List trusted keys' },
        path: { type: 'string', description: 'Trust the signing key embedded in this zip package' },
        publicKey: { type: 'string', description: 'Trust this PEM public key' },
        label: { type: 'string', description: 'Display label for the key' },
        rotate: { type: 'boolean', description: 'Rotate the local signing key and revoke the previous one' },
        revoke: { type: 'string', description: 'Revoke this keyId (keeps it for verifying old signatures)' },
        expiresInDays: { type: 'number', description: 'Optional expiry in days for the added key' },
        remove: { type: 'string', description: 'Remove this keyId' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (typeof args.revoke === 'string' && args.revoke !== '') {
        const revoked = revokeKey(args.revoke)
        if (revoked) appendAudit({ action: 'trust.revoke', actor: null, detail: { keyId: revoked.keyId } })
        return revoked ? `Revoked trusted key ${revoked.keyId}; signatures made before ${new Date(revoked.revokedAt).toISOString()} still count as trusted.` : `No trusted key ${args.revoke}.`
      }
      if (args.rotate === true) {
        const rotation = rotateSigningKey()
        if (rotation.oldKeyId) revokeKey(rotation.oldKeyId)
        const entry = trustKey({ keyId: rotation.newKeyId, publicKey: rotation.publicKey, label: args.label ?? 'local', rotatedFrom: rotation.oldKeyId })
        appendAudit({ action: 'trust.rotate', actor: null, detail: { oldKeyId: rotation.oldKeyId, newKeyId: entry.keyId } })
        return `Rotated signing key: ${rotation.oldKeyId ?? '—'} → ${entry.keyId} (old key revoked; old signatures still verify).`
      }
      if (typeof args.remove === 'string' && args.remove !== '') {
        const removed = removeTrustedKey(args.remove)
        if (removed) appendAudit({ action: 'trust.remove', actor: null, detail: { keyId: args.remove } })
        return removed ? `Removed trusted key ${args.remove}.` : `No trusted key ${args.remove}.`
      }
      if (args.list === true || (typeof args.path !== 'string' && typeof args.publicKey !== 'string')) {
        const keys = trustedKeys()
        if (keys.length === 0) return 'No trusted signing keys. Use exp_trust_key (local key), path=… or publicKey=… .'
        return [`${keys.length} trusted key(s):`, ...keys.map((entry) => {
          const state = entry.revokedAt ? `revoked ${new Date(entry.revokedAt).toISOString()}` : 'active'
          const expiry = entry.expiresAt ? ` · expires ${new Date(entry.expiresAt).toISOString()}` : ''
          return `- ${entry.keyId} · ${entry.label} · ${state}${expiry}`
        })].join('\n')
      }
      let publicKey = null
      let keyId = null
      let label = args.label
      if (typeof args.path === 'string' && args.path !== '') {
        const file = resolve(cwdOf(exec), args.path)
        if (!existsSync(file)) throw new Error(`package not found: ${file}`)
        const raw = await fsp.readFile(file)
        if (!looksLikeZip(raw)) throw new Error('trust path must be a signed zip package')
        const files = readZip(raw)
        const manifestEntry = files.get('manifest.json')
        if (manifestEntry === undefined) throw new Error('package has no manifest.json')
        const manifest = JSON.parse(manifestEntry.toString('utf8'))
        if (manifest.signature === undefined || manifest.signature === null) throw new Error('package is not signed')
        publicKey = manifest.signature.publicKey
        keyId = manifest.signature.keyId
        label = label ?? (manifest.signature.signer ?? 'package')
      } else if (typeof args.publicKey === 'string' && args.publicKey.trim() !== '') {
        publicKey = args.publicKey.trim()
        keyId = keyFingerprint(publicKey)
      } else {
        const pair = signingKey()
        publicKey = pair.publicKey
        keyId = keyFingerprint(publicKey)
        label = label ?? 'local'
      }
      if (typeof publicKey !== 'string' || publicKey === '' || typeof keyId !== 'string') throw new Error('could not determine a public key')
      const expiresAt = typeof args.expiresInDays === 'number' && args.expiresInDays > 0
        ? Date.now() + args.expiresInDays * 86_400_000
        : undefined
      const entry = trustKey({ keyId, publicKey, label, expiresAt })
      appendAudit({ action: 'trust.add', actor: null, detail: { keyId: entry.keyId, label: entry.label } })
      return `Trusted key ${entry.keyId} · ${entry.label}${entry.expiresAt ? ` · expires ${new Date(entry.expiresAt).toISOString()}` : ''}.`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_audit',
    description: 'Show the append-only audit log (hash-chained decisions, imports/exports and key changes) and verify its integrity.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many recent entries to show (default 20, max 200)' },
        verify: { type: 'boolean', description: 'Only report chain verification' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const verification = verifyAudit()
      const anchors = verifyAnchors(auditEntries())
      const anchorText = anchors.total === 0 ? 'no external anchors' : `${anchors.valid}/${anchors.total} anchors valid`
      if (args.verify === true) {
        return `Audit chain: ${verification.ok ? 'ok' : `broken at entry ${verification.brokenAt}`} · ${verification.count} entries · ${anchorText}.`
      }
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.round(args.limit), 200) : 20
      const entries = auditEntries().slice(-limit)
      const lines = [`Audit chain: ${verification.ok ? 'ok' : `broken at entry ${verification.brokenAt}`} · showing ${entries.length}/${verification.count} entries · ${anchorText}.`]
      for (const entry of entries) {
        const actor = entry.actor ? ` · ${entry.actor}` : ''
        lines.push(`- ${new Date(entry.at).toISOString()} · ${entry.action}${actor} · ${truncate(JSON.stringify(entry.detail ?? {}), 300)}`)
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_anchor',
    description: 'Anchor the current audit head externally: append it to a JSON file, commit it in a git repository, or POST it to an HTTP endpoint. A local anchor record is kept for later verification.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['file', 'git', 'http'], description: 'Anchor target (default file)' },
        path: { type: 'string', description: 'File mode: output path; defaults to <root>/audit-anchor.json' },
        repo: { type: 'string', description: 'Git mode: repository path (default session cwd)' },
        url: { type: 'string', description: 'HTTP mode: endpoint URL' },
        token: { type: 'string', description: 'HTTP mode: optional bearer token' },
        note: { type: 'string', description: 'Optional note stored with the anchor' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const anchor = auditAnchor()
      const mode = args.mode ?? 'file'
      let ref = null
      if (mode === 'file') {
        const file = resolve(cwdOf(exec), typeof args.path === 'string' && args.path !== '' ? args.path : join(root, 'audit-anchor.json'))
        await fsp.mkdir(dirname(file), { recursive: true })
        await fsp.writeFile(file, `${JSON.stringify({ ...anchor, note: args.note ?? null }, null, 2)}\n`, 'utf8')
        ref = file
      } else if (mode === 'git') {
        const repo = resolve(cwdOf(exec), typeof args.repo === 'string' && args.repo !== '' ? args.repo : '.')
        const top = await gitExec(['rev-parse', '--show-toplevel'], repo)
        const file = join(top, 'audit-anchor.json')
        await fsp.writeFile(file, `${JSON.stringify({ ...anchor, note: args.note ?? null }, null, 2)}\n`, 'utf8')
        await gitExec(['add', 'audit-anchor.json'], top)
        await gitExec(['commit', '-m', `experiment ledger audit anchor ${anchor.headHash.slice(0, 12)}`], top)
        const commit = await gitExec(['rev-parse', 'HEAD'], top)
        ref = `${top}@${commit}`
      } else if (mode === 'http') {
        if (typeof args.url !== 'string' || !/^https?:\/\//.test(args.url)) throw new Error('http mode needs an http(s) url')
        const response = await fetch(args.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(typeof args.token === 'string' && args.token !== '' ? { authorization: `Bearer ${args.token}` } : {}),
          },
          body: JSON.stringify({ ...anchor, note: args.note ?? null }),
        })
        if (!response.ok) throw new Error(`anchor endpoint returned ${response.status}`)
        ref = `${args.url} (${response.status})`
      } else {
        throw new Error('mode must be file, git or http')
      }
      const record = appendAnchor({ ...anchor, mode, ref, note: args.note ?? null })
      appendAudit({ action: 'audit.anchor', actor: null, detail: { mode, ref, headHash: anchor.headHash, count: anchor.count } })
      return [
        `Anchored audit head ${anchor.headHash.slice(0, 16)}… (${anchor.count} entries) · ${mode}`,
        `ref: ${ref}`,
        `local anchor record: ${new Date(record.at).toISOString()}`,
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_verify_anchor',
    description: 'Read an external audit-anchor copy (file, git working tree, or HTTP GET) and check its head/count against the local audit chain and anchor registry.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['file', 'git', 'http'], description: 'Anchor source (default file)' },
        path: { type: 'string', description: 'File mode: anchor JSON path' },
        repo: { type: 'string', description: 'Git mode: repository path (default session cwd)' },
        url: { type: 'string', description: 'HTTP mode: anchor URL' },
        token: { type: 'string', description: 'HTTP mode: optional bearer token' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const mode = args.mode ?? 'file'
      let external = null
      let source = null
      if (mode === 'file') {
        if (typeof args.path !== 'string' || args.path === '') throw new Error('file mode needs path')
        const file = resolve(cwdOf(exec), args.path)
        external = JSON.parse(await fsp.readFile(file, 'utf8'))
        source = file
      } else if (mode === 'git') {
        const repo = resolve(cwdOf(exec), typeof args.repo === 'string' && args.repo !== '' ? args.repo : '.')
        const top = await gitExec(['rev-parse', '--show-toplevel'], repo)
        const file = join(top, 'audit-anchor.json')
        external = JSON.parse(await fsp.readFile(file, 'utf8'))
        source = `${top}/audit-anchor.json`
      } else if (mode === 'http') {
        if (typeof args.url !== 'string' || !/^https?:\/\//.test(args.url)) throw new Error('http mode needs an http(s) url')
        const response = await fetch(args.url, {
          headers: { ...(typeof args.token === 'string' && args.token !== '' ? { authorization: `Bearer ${args.token}` } : {}) },
        })
        if (!response.ok) throw new Error(`anchor endpoint returned ${response.status}`)
        external = await response.json()
        source = `${args.url} (${response.status})`
      } else {
        throw new Error('mode must be file, git or http')
      }
      if (external === null || typeof external.headHash !== 'string' || typeof external.count !== 'number') {
        throw new Error('external anchor is malformed')
      }
      const entries = auditEntries()
      const entry = entries[external.count - 1]
      const chainMatch = entry !== undefined && entry.hash === external.headHash
      const local = listAnchors().find((anchor) => anchor.headHash === external.headHash && anchor.count === external.count)
      if (!chainMatch) {
        throw new Error(`external anchor does not match the local audit chain at entry ${external.count}`)
      }
      if (local === undefined) {
        throw new Error('external anchor has no matching local anchor record')
      }
      return [
        `Anchor verified from ${source}.`,
        `head: ${external.headHash} · entry ${external.count}/${entries.length} · local record ${new Date(local.at).toISOString()}`,
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_open',
    description: 'Open the ledger panel in the DSH sidebar, optionally on a ledger folder and experiment (the panel polls this request and selects it).',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
        experimentId: { type: 'string', description: 'Experiment to select' },
        mode: { type: 'string', enum: ['sidebar', 'dialog'], description: 'Panel layout (default sidebar)' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      if (typeof args.experimentId === 'string' && findExperiment(ledger, args.experimentId) === undefined) {
        throw new Error(`experiment not found: ${args.experimentId}`)
      }
      panelOpenRequest = {
        at: Date.now(),
        root,
        experimentId: typeof args.experimentId === 'string' ? args.experimentId : null,
        mode: args.mode === 'dialog' ? 'dialog' : 'sidebar',
      }
      return `Panel open requested: ${root}${args.experimentId ? ` · ${args.experimentId}` : ''} (${panelOpenRequest.mode}).`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_clone',
    description: 'Clone an experiment as a template: copies factors, metrics, description and tags, but not runs or reports. Useful before a new sweep or batch.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Source experiment id' },
        name: { type: 'string', description: 'New name (defaults to "<name> (clone)")' },
        description: { type: 'string', description: 'New description; defaults to the source description' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the clone' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const source = requireExperiment(ledger, args.experimentId)
      const requested = typeof args.name === 'string' && args.name.trim() !== '' ? args.name.trim() : `${source.name} (clone)`
      if (ledger.experiments.some((experiment) => experiment.name === requested)) {
        throw new Error(`experiment name already exists: ${requested}`)
      }
      const clone = {
        id: newId('exp'),
        name: requested,
        description: typeof args.description === 'string' ? args.description : (source.description ?? ''),
        factors: JSON.parse(JSON.stringify(source.factors ?? [])),
        metrics: JSON.parse(JSON.stringify(source.metrics ?? [])),
        tags: Array.isArray(args.tags) ? args.tags : JSON.parse(JSON.stringify(source.tags ?? [])),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        runs: [],
        reports: [],
      }
      ledger.experiments.push(clone)
      await saveLedger(root, ledger)
      await rememberRoot(root)
      return `Cloned ${source.id} → ${clone.id} · ${clone.name} · factors: ${clone.factors.length} · metrics: ${clone.metrics.length} · runs: 0`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_batch',
    description: 'Run one command template over explicit parameter rows in one experiment, recording each run. Up to 50 rows; sequential, with optional stopOnError. For a background grid use exp_sweep instead.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        command: { type: 'string', description: 'Command template with {param} placeholders' },
        rows: {
          type: 'array',
          items: { type: 'object' },
          description: 'Parameter rows, e.g. [{"lr":0.1},{"lr":0.2}]',
        },
        cwd: { type: 'string', description: 'Working directory; defaults to the session cwd' },
        timeoutMs: { type: 'number', description: 'Per-run timeout (default 30 min, max 4 h)' },
        stopOnError: { type: 'boolean', description: 'Stop after the first failed run' },
        label: { type: 'string', description: 'Label prefix (default "batch")' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId', 'command', 'rows'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (!Array.isArray(args.rows) || args.rows.length === 0) throw new Error('rows must be a non-empty array')
      if (args.rows.length > 50) throw new Error('at most 50 rows per batch')
      if (args.rows.some((row) => row === null || typeof row !== 'object' || Array.isArray(row))) {
        throw new Error('each row must be a parameter object')
      }
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const baseCwd = cwdOf(exec)
      const cwd = typeof args.cwd === 'string' && args.cwd.trim() !== '' ? resolve(baseCwd, args.cwd.trim()) : baseCwd
      const prefix = typeof args.label === 'string' && args.label.trim() !== '' ? args.label.trim() : 'batch'
      const recorded = []
      for (let index = 0; index < args.rows.length; index += 1) {
        const row = args.rows[index]
        const run = await performRun({
          root,
          experiment,
          commandTemplate: args.command,
          params: row,
          label: `${prefix} ${index + 1}/${args.rows.length}`,
          cwd,
          timeoutMs: args.timeoutMs,
          notes: `batch row ${index + 1}`,
        })
        await appendRun(root, ledger, experiment, run)
        recorded.push(run)
        if (run.status !== 'ok' && args.stopOnError === true) break
      }
      const ok = recorded.filter((run) => run.status === 'ok').length
      const failures = recorded.filter((run) => run.status !== 'ok')
      return [
        `Batch finished: ${ok}/${recorded.length} ok${failures.length > 0 ? ` · ${failures.length} failed` : ''}`,
        ...recorded.map((run) => `- ${run.id} · ${run.label} · ${run.status}${run.exitCode !== undefined ? ` (exit ${run.exitCode})` : ''}`),
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_run',
    description: 'Run one command as an experiment run: substitutes {param} placeholders, captures stdout/stderr, records exit status, duration, parameters, metrics and artifact hashes. Metrics come from an "EXP_METRICS: {json}" stdout line, a metrics.json file written in the run directory, or the metrics argument.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id from exp_define or exp_list' },
        command: { type: 'string', description: 'Shell command; {param} placeholders are replaced from params' },
        params: { type: 'object', description: 'Parameters for this run (string, number or boolean values)' },
        label: { type: 'string', description: 'Short human label for this run' },
        metrics: { type: 'object', description: 'Metrics to record directly (overrides parsed ones)' },
        artifacts: { type: 'array', items: { type: 'string' }, description: 'File paths to hash and attach' },
        datasets: {
          type: 'array',
          items: { type: ['string', 'object'] },
          description: 'Input data files this run consumes; each is recorded with size and SHA-256 (text tables also get rows × columns)',
        },
        cwd: { type: 'string', description: 'Working directory; defaults to the session cwd' },
        timeoutMs: { type: 'number', description: 'Command timeout in milliseconds (default 30 minutes)' },
        notes: { type: 'string', description: 'Free-form note stored with the run' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId', 'command'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const baseCwd = cwdOf(exec)
      const cwd = typeof args.cwd === 'string' && args.cwd.trim() !== '' ? resolve(baseCwd, args.cwd.trim()) : baseCwd
      const run = await performRun({
        root,
        experiment,
        commandTemplate: args.command,
        params: args.params,
        label: args.label,
        cwd,
        timeoutMs: args.timeoutMs,
        metrics: args.metrics,
        artifacts: args.artifacts,
        datasets: args.datasets,
        notes: args.notes,
      })
      await appendRun(root, ledger, experiment, run)
      return runSummary(run, root, experiment)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_record',
    description: 'Record an experiment run that already happened (bench work, an external instrument, a manual trial) without executing anything: parameters, metrics, artifacts and notes.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        label: { type: 'string', description: 'Short human label, e.g. sample id or condition' },
        params: { type: 'object', description: 'Parameters for this run' },
        metrics: { type: 'object', description: 'Measured metric values' },
        artifacts: { type: 'array', items: { type: 'string' }, description: 'File paths to hash and attach' },
        datasets: {
          type: 'array',
          items: { type: ['string', 'object'] },
          description: 'Input data files this run consumed; each is recorded with size and SHA-256',
        },
        notes: { type: 'string', description: 'Free-form note' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const cwd = cwdOf(exec)
      const params = normalizeParams(args.params)
      const sqlMetrics = await computeSqlMetrics(experiment, { cwd, root })
      const metrics = mergeMetrics(sqlMetrics.values, normalizeMetrics(args.metrics))
      const artifacts = await collectArtifacts(args.artifacts, cwd)
      const declared = Array.isArray(args.datasets) ? args.datasets : []
      const datasets = await collectDatasets([
        ...declared,
        ...sqlMetrics.datasets.map((file) => ({ path: file })),
      ], cwd)
      const now = Date.now()
      const run = {
        id: newId('run'),
        label: typeof args.label === 'string' && args.label.trim() !== '' ? args.label.trim() : 'recorded',
        status: 'recorded',
        params,
        metrics,
        artifacts,
        datasets,
        ...(sqlMetrics.errors.length > 0 ? { metricErrors: sqlMetrics.errors } : {}),
        command: '',
        cwd,
        startedAt: now,
        endedAt: now,
        durationMs: 0,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTail: '',
        stderrTail: '',
        notes: typeof args.notes === 'string' ? truncate(args.notes, 1000) : '',
        executor: { kind: 'manual' },
        manifest: await captureManifest(cwd, ''),
      }
      await appendRun(root, ledger, experiment, run)
      return runSummary(run, root, experiment)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_sweep',
    description: 'Run a parameter sweep as many experiment runs: expand a grid {factor: values} (or explicit rows) into runs of one command, with bounded concurrency, per-run records and metric parsing. Use dryRun to see the plan first.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        command: { type: 'string', description: 'Command template; {factor} placeholders are replaced per run' },
        preset: { type: 'string', description: 'Use a saved sweep preset by name instead of command/grid' },
        grid: {
          type: 'object',
          description: 'Factor values to expand, e.g. {"kp": [0.8, 1.2], "ki": [0.2, 0.3]}',
          additionalProperties: true,
        },
        rows: { type: 'array', items: { type: 'object' }, description: 'Explicit parameter rows instead of a grid' },
        label: { type: 'string', description: 'Label prefix for the runs' },
        maxRuns: { type: 'number', description: 'Maximum planned runs (default 50, hard cap 100)' },
        maxParallel: { type: 'number', description: 'Concurrent commands (default 1, cap 4)' },
        failFast: { type: 'boolean', description: 'Stop scheduling after the first failed run' },
        timeoutMs: { type: 'number', description: 'Timeout per command in milliseconds' },
        artifacts: { type: 'array', items: { type: 'string' }, description: 'Artifact paths to hash for every run' },
        datasets: { type: 'array', items: { type: ['string', 'object'] }, description: 'Input data files for every run' },
        notes: { type: 'string', description: 'Note stored on every run' },
        cwd: { type: 'string', description: 'Working directory; defaults to the session cwd' },
        dryRun: { type: 'boolean', description: 'Only list the planned runs' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      let effective = {
        command: args.command,
        grid: args.grid,
        rows: args.rows,
        label: args.label,
        maxParallel: args.maxParallel,
        failFast: args.failFast,
        timeoutMs: args.timeoutMs,
      }
      if (typeof args.preset === 'string' && args.preset !== '') {
        const preset = (Array.isArray(experiment.sweepPresets) ? experiment.sweepPresets : [])
          .find((entry) => entry.name === args.preset)
        if (preset === undefined) throw new Error(`preset not found: ${args.preset}`)
        effective = {
          command: effective.command ?? preset.command,
          grid: effective.grid ?? preset.grid,
          rows: effective.rows ?? preset.rows,
          label: effective.label ?? preset.name,
          maxParallel: effective.maxParallel ?? preset.maxParallel,
          failFast: effective.failFast ?? preset.failFast,
          timeoutMs: effective.timeoutMs ?? preset.timeoutMs,
        }
      }
      if (typeof effective.command !== 'string' || effective.command.trim() === '') {
        throw new Error('command is required unless a preset is given')
      }
      const combos = sweepCombos(effective)
      const maxRuns = typeof args.maxRuns === 'number' ? Math.min(Math.max(1, Math.round(args.maxRuns)), 100) : 50
      if (combos.length > maxRuns) {
        throw new Error(`sweep has ${combos.length} runs; raise maxRuns (max 100) or narrow the grid`)
      }
      const baseCwd = cwdOf(exec)
      const cwd = typeof args.cwd === 'string' && args.cwd.trim() !== '' ? resolve(baseCwd, args.cwd.trim()) : baseCwd
      const baseLabel = typeof effective.label === 'string' ? effective.label.trim() : ''

      if (args.dryRun === true) {
        const lines = [`Sweep plan for ${experiment.id}: ${combos.length} run(s)`]
        for (const [index, combo] of combos.entries()) {
          const command = substitute(effective.command, combo)
          lines.push(`#${index + 1} ${Object.entries(combo).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')} → ${truncate(command, 120)}`)
        }
        lines.push('Call again without dryRun to execute.')
        return lines.join('\n')
      }

      const startedAt = Date.now()
      const { results } = await executeSweep({
        root,
        ledger,
        experiment,
        combos,
        commandTemplate: effective.command,
        label: baseLabel,
        cwd,
        timeoutMs: effective.timeoutMs,
        artifacts: args.artifacts,
        datasets: args.datasets,
        notes: args.notes,
        maxParallel: effective.maxParallel,
        failFast: effective.failFast,
      })

      const runs = results.filter((entry) => entry !== undefined && typeof entry.id === 'string')
      const failures = results
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry !== undefined && typeof entry.error === 'string')
      const elapsed = Date.now() - startedAt
      const lines = [`Sweep ${experiment.id}: ${runs.length}/${combos.length} runs in ${formatDuration(elapsed)}${failures.length > 0 ? ` · ${failures.length} error(s)` : ''}`]
      for (const failure of failures.slice(0, 3)) {
        const combo = combos[failure.index] ?? {}
        lines.push(`  #${failure.index + 1} ${Object.entries(combo).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')}: ${truncate(failure.entry.error, 200)}`)
      }
      const keys = combos.length === 0 ? [] : Object.keys(combos[0])
      const shown = runs.slice(0, 20)
      for (const run of shown) {
        const params = keys.map((key) => `${key}=${formatValue(run.params?.[key])}`).join(', ')
        const metrics = Object.entries(run.metrics ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')
        lines.push(`${run.id} | ${params || '—'} | ${run.status} | ${formatDuration(run.durationMs)} | ${metrics || 'no metrics'}`)
      }
      if (runs.length > shown.length) lines.push(`…and ${runs.length - shown.length} more runs.`)
      if (runs.length > 0) {
        const comparison = compareRuns({ runs, metrics: experiment.metrics ?? [] }, { groupBy: [] })
        if (comparison.best.length > 0) {
          lines.push(`best: ${comparison.best.map((winner) => `${winner.metric} → ${winner.runId} (${formatValue(winner.value)})`).join('; ')}`)
        }
      }
      if (runs.length > 0) lines.push(`Next: exp_compare experimentId="${experiment.id}" or exp_report experimentId="${experiment.id}".`)
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_presets',
    description: 'List, save or delete saved sweep presets for an experiment. A preset stores the command template, grid or rows and parallelism; exp_sweep can run one by name.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        action: { type: 'string', description: 'list (default), save or delete' },
        name: { type: 'string', description: 'Preset name; a same-named preset is replaced' },
        command: { type: 'string', description: 'Command template for save' },
        grid: { type: 'object', description: 'Grid for save', additionalProperties: true },
        rows: { type: 'array', items: { type: 'object' }, description: 'Explicit rows for save' },
        maxParallel: { type: 'number', description: 'Concurrency stored with the preset' },
        failFast: { type: 'boolean', description: 'Fail-fast stored with the preset' },
        timeoutMs: { type: 'number', description: 'Timeout stored with the preset' },
        presetId: { type: 'string', description: 'Preset id for delete' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const action = typeof args.action === 'string' && args.action !== '' ? args.action : 'list'
      if (action !== 'list' && action !== 'save' && action !== 'delete') {
        throw new Error('action must be list, save or delete')
      }
      let presets
      try {
        presets = applyPreset(experiment, {
          action,
          name: args.name,
          command: args.command,
          grid: args.grid,
          rows: args.rows,
          maxParallel: args.maxParallel,
          failFast: args.failFast,
          timeoutMs: args.timeoutMs,
          presetId: args.presetId,
        })
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error))
      }
      if (action !== 'list') {
        await saveLedger(root, ledger)
        await rememberRoot(root)
      }
      if (presets.length === 0) return `No sweep presets for ${experiment.id}.`
      const lines = [`Sweep presets for ${experiment.id}: ${presets.length}`]
      for (const preset of presets) {
        const grid = preset.grid !== undefined && Object.keys(preset.grid).length > 0 ? JSON.stringify(preset.grid) : '—'
        lines.push(`- ${preset.id} · ${preset.name}: ${truncate(preset.command, 100)} · grid ${grid} · parallel ${preset.maxParallel}${preset.failFast ? ' · failFast' : ''}`)
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_schedule',
    description: 'List, save, delete, toggle or run scheduled sweeps. A schedule runs a saved sweep preset every N minutes while the desktop app is open; runs are recorded like any other sweep.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        action: { type: 'string', description: 'list (default), save, delete, toggle or run' },
        scheduleId: { type: 'string', description: 'Schedule id for delete/toggle/run' },
        name: { type: 'string', description: 'Schedule name (or lookup name)' },
        preset: { type: 'string', description: 'Sweep preset name for save' },
        intervalMinutes: { type: 'number', description: 'Interval in minutes (1-10080) for save' },
        enabled: { type: 'boolean', description: 'Enable on save/toggle' },
        retryLimit: { type: 'number', description: 'Retries after a failed scheduled run (0-5)' },
        retryDelayMs: { type: 'number', description: 'Base retry delay in ms (10000-3600000)' },
        failureLimit: { type: 'number', description: 'Pause after N consecutive failures (0-10)' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const action = typeof args.action === 'string' && args.action !== '' ? args.action : 'list'
      if (action === 'report') {
        const schedules = Array.isArray(experiment.schedules) ? experiment.schedules : []
        const schedule = schedules.find((entry) =>
          (typeof args.scheduleId === 'string' && entry.id === args.scheduleId) ||
          (typeof args.name === 'string' && entry.name === args.name))
        if (schedule === undefined) throw new Error('schedule not found')
        const report = await writeScheduleReport(root, experiment, schedule)
        await saveLedger(root, ledger)
        await rememberRoot(root)
        return [
          `Schedule report written: ${report.path}`,
          `runs: ${report.summary.runs} · ok: ${report.summary.ok} · failed: ${report.summary.failed} · avg: ${report.summary.averageDurationMs ?? '—'} ms`,
        ].join('\n')
      }
      if (action === 'run' || action === 'resume-run') {
        const schedules = Array.isArray(experiment.schedules) ? experiment.schedules : []
        const schedule = schedules.find((entry) =>
          (typeof args.scheduleId === 'string' && entry.id === args.scheduleId) ||
          (typeof args.name === 'string' && entry.name === args.name))
        if (schedule === undefined) throw new Error('schedule not found')
        if (action === 'resume-run') {
          schedule.enabled = true
          schedule.failureCount = 0
        }
        schedule.retryCount = 0
        let job
        try {
          job = runScheduleNow(root, ledger, experiment, schedule)
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : String(error))
        }
        await saveLedger(root, ledger)
        await rememberRoot(root)
        return `Schedule "${schedule.name}" started job ${job.id} (${job.total} runs).`
      }
      let schedules
      try {
        schedules = applySchedule(experiment, {
          action,
          scheduleId: args.scheduleId,
          name: args.name,
          preset: args.preset,
          intervalMinutes: args.intervalMinutes,
          enabled: args.enabled,
          retryLimit: args.retryLimit,
          retryDelayMs: args.retryDelayMs,
          failureLimit: args.failureLimit,
        })
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error))
      }
      if (action !== 'list') {
        await saveLedger(root, ledger)
        await rememberRoot(root)
      }
      if (schedules.length === 0) return `No scheduled sweeps for ${experiment.id}.`
      const lines = [`Scheduled sweeps for ${experiment.id}: ${schedules.length}`]
      for (const schedule of schedules) {
        const minutes = Math.round((schedule.intervalMs ?? 0) / 60000)
        lines.push(`- ${schedule.id} · ${schedule.name}: preset ${schedule.preset} every ${minutes}m · ${schedule.enabled === false ? 'paused' : 'enabled'}${schedule.lastStatus ? ` · last ${schedule.lastStatus}` : ''}${schedule.lastError ? ` · error ${schedule.lastError}` : ''}`)
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_candidates',
    description: 'List commands recorded passively by the plugin (shell/MCP calls with a command). Promote one with exp_promote to turn it into an experiment run without re-running it.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many recent candidates to show (default 20)' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.round(args.limit), 50) : 20
      const candidates = await listCandidates(limit)
      if (candidates.length === 0) {
        return 'No candidates recorded yet. The recorder captures commands from tools that ran after the plugin loaded; run something with bash, or turn the recorder on in the plugin config.'
      }
      const lines = [`${candidates.length} recent candidate(s):`]
      for (const candidate of candidates) {
        const age = Math.max(0, Date.now() - candidate.at)
        lines.push(`${candidate.id} · ${candidate.tool} · ${candidate.status} · ${formatDuration(candidate.durationMs)} · ${formatDuration(age)} ago · ${truncate(candidate.command, 120)}`)
      }
      lines.push('Promote one: exp_promote experimentId="exp-…" candidateId="cand-…" (add metrics/params/notes as needed).')
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_promote',
    description: 'Turn a recorded candidate into an experiment run without executing it again: keeps the command, working directory, status and duration, and accepts the parameters, metrics, notes and artifacts to attach.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        candidateId: { type: 'string', description: 'Candidate id from exp_candidates' },
        params: { type: 'object', description: 'Parameters for this run' },
        metrics: { type: 'object', description: 'Metrics measured for this run' },
        label: { type: 'string', description: 'Short human label' },
        notes: { type: 'string', description: 'Free-form note' },
        artifacts: { type: 'array', items: { type: 'string' }, description: 'File paths to hash and attach' },
        datasets: { type: 'array', items: { type: ['string', 'object'] }, description: 'Input data files for this run' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId', 'candidateId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const candidate = await findCandidate(args.candidateId)
      if (candidate === undefined) throw new Error(`candidate not found: ${args.candidateId}. Use exp_candidates to see recent ids.`)
      const cwd = typeof candidate.cwd === 'string' && candidate.cwd !== '' ? candidate.cwd : cwdOf(exec)
      const run = await promoteCandidateRun({
        root,
        ledger,
        experiment,
        candidate,
        cwd,
        params: args.params,
        metrics: args.metrics,
        label: args.label,
        notes: args.notes,
        artifacts: args.artifacts,
        datasets: args.datasets,
      })
      return runSummary(run, root, experiment)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_report_compare',
    description: 'Write a standalone multi-experiment comparison report (2-4 experiments, optionally from different ledger roots): one table per metric, grouped by shared factors. Markdown by default; format="html" writes one self-contained HTML file. The report is saved under the destination ledger and its SHA-256 returned.',
    parameters: {
      type: 'object',
      properties: {
        experimentIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Experiment ids in the destination ledger (2-4)',
        },
        refs: {
          type: 'array',
          items: { type: 'object' },
          description: 'Cross-project refs: {experimentId, root?}; root defaults to the destination ledger',
        },
        groupBy: {
          type: 'array',
          items: { type: 'string' },
          description: 'Factor keys shared by the experiments; defaults to no grouping',
        },
        format: { type: 'string', enum: ['markdown', 'html'], description: 'Report format (default markdown)' },
        root: { type: 'string', description: 'Destination ledger directory; defaults to .experiments' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      let refs = []
      if (Array.isArray(args.refs) && args.refs.length > 0) {
        refs = normalizeCompareRefs(args.refs.map((entry) => ({
          root: typeof entry?.root === 'string' && entry.root !== '' ? entry.root : root,
          experimentId: entry?.experimentId,
        })))
      } else if (Array.isArray(args.experimentIds)) {
        refs = normalizeCompareRefs(args.experimentIds.map((id) => ({ root, experimentId: id })))
      }
      if (refs.length < 2 || refs.length > 4) throw new Error('pass 2-4 experiments (experimentIds or refs)')
      const entries = await loadCompareEntries(refs)
      const groupBy = Array.isArray(args.groupBy) ? args.groupBy.filter((value) => typeof value === 'string') : []
      const report = args.format === 'html'
        ? await writeCompareHtmlReport(root, entries, groupBy)
        : await writeCompareReport(root, entries, groupBy)
      const ledger = await loadLedger(root)
      archiveCompareReport(ledger, report, entries)
      await saveLedger(root, ledger)
      await rememberRoot(root)
      return [
        `${args.format === 'html' ? 'HTML comparison report' : 'Comparison report'} written: ${report.path}`,
        `sha256: ${report.sha256.slice(0, 16)}… · experiments: ${report.summary.experiments} · metrics: ${report.summary.metrics} · groups: ${report.summary.groups}`,
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_search',
    description: 'Search recorded runs across experiments by text, parameter or metric condition, status and date. Returns the newest matches (or ranked by a metric) so the agent can reuse what was already tried.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text over experiment name, run label/command/notes, params and metrics' },
        experimentId: { type: 'string', description: 'Restrict to one experiment' },
        status: { type: 'string', description: 'ok, failed, recorded, timeout or any' },
        since: { type: 'string', description: 'ISO timestamp; only newer runs' },
        paramFilters: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Conditions like {key:"kp", op:"gt", value:1.2}; op: eq, ne, gt, gte, lt, lte, contains',
        },
        metricFilters: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Metric conditions like {key:"overshoot", op:"lt", value:5}',
        },
        sortMetric: { type: 'string', description: 'Sort by this metric instead of recency' },
        direction: { type: 'string', description: 'min or max for sortMetric' },
        includeArchived: { type: 'boolean', description: 'Include archived experiments' },
        limit: { type: 'number', description: 'Maximum results (default 20, cap 50)' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const results = searchLedger(ledger, {
        query: args.query,
        experimentId: args.experimentId,
        status: args.status,
        since: args.since,
        paramFilters: Array.isArray(args.paramFilters) ? args.paramFilters : [],
        metricFilters: Array.isArray(args.metricFilters) ? args.metricFilters : [],
        sortMetric: args.sortMetric,
        direction: args.direction,
        includeArchived: args.includeArchived === true,
        limit: args.limit,
      })
      if (results.length === 0) return 'No matching runs.'
      const lines = [`Matching runs: ${results.length}`]
      for (const result of results) {
        const { run } = result
        const params = Object.entries(run.params ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ') || '—'
        const metrics = Object.entries(run.metrics ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ') || '—'
        const when = typeof run.startedAt === 'number' ? new Date(run.startedAt).toISOString() : '—'
        lines.push(`- ${result.experimentName} (${result.experimentId}) · ${run.id} · ${run.status} · ${when}`)
        lines.push(`  params: ${params}`)
        lines.push(`  metrics: ${metrics}`)
        if (run.command) lines.push(`  command: ${truncate(run.command, 160)}`)
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_reproduce',
    description: 'Rerun a recorded run with the same command and parameters and record a new run linked with reproducedFrom. Without confirm=true it only reports what would run.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        runId: { type: 'string', description: 'Run id to reproduce' },
        confirm: { type: 'boolean', description: 'Set true to actually execute the command' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId', 'runId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const source = (experiment.runs ?? []).find((run) => run.id === args.runId)
      if (source === undefined) throw new Error(`run not found: ${args.runId}`)
      const command = source.manifest?.command ?? source.command
      if (typeof command !== 'string' || command.trim() === '') throw new Error('run has no command to reproduce')
      if (args.confirm !== true) {
        const dryCwd = source.manifest?.cwd ?? source.cwd ?? process.cwd()
        const dryPreflight = preflightCommand(command, dryCwd)
        return [
          `Dry run: would rerun ${source.id} in ${dryCwd} with:`,
          `  ${truncate(command, 400)}`,
          `params: ${JSON.stringify(source.params ?? {})}`,
          `timeoutMs: ${source.timeoutMs ?? source.manifest?.timeoutMs ?? 'default'}`,
          `env keys: ${Object.keys(source.manifest?.env ?? {}).join(', ') || '—'}`,
          dryPreflight === null ? 'command file: ok' : `WARNING: ${dryPreflight}`,
          'Set confirm=true to execute.',
        ].join('\n')
      }
      const run = await reproduceRun(root, ledger, experiment, source)
      const summary = `${runSummary(run, root, experiment)}\nreproducedFrom: ${source.id}`
      if (run.status !== 'ok') {
        return `${summary}\nreproduce FAILED: exit ${run.exitCode ?? '—'}\n${truncate(run.stderrTail ?? run.error ?? '', 800)}`
      }
      return summary
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_update',
    description: 'Update experiment metadata without touching its runs: name, description, tags, or archived state.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        name: { type: 'string', description: 'New experiment name' },
        description: { type: 'string', description: 'New description' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replace tags (max 20, each 40 chars)' },
        archived: { type: 'boolean', description: 'Archive or restore the experiment' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      if (args.name !== undefined) {
        const name = typeof args.name === 'string' ? args.name.trim() : ''
        if (name === '') throw new Error('name must not be empty')
        if (ledger.experiments.some((entry) => entry.id !== experiment.id && entry.name === name)) {
          throw new Error(`experiment name already exists: ${name}`)
        }
        experiment.name = name
      }
      if (args.description !== undefined) {
        experiment.description = truncate(typeof args.description === 'string' ? args.description : '', 2000)
      }
      if (args.tags !== undefined) {
        if (!Array.isArray(args.tags)) throw new Error('tags must be an array of strings')
        const tags = [...new Set(args.tags.map((tag) => String(tag).trim()).filter((tag) => tag !== ''))]
        if (tags.length > 20) throw new Error('at most 20 tags are allowed')
        if (tags.some((tag) => tag.length > 40)) throw new Error('each tag must be at most 40 characters')
        experiment.tags = tags
      }
      if (args.archived !== undefined) experiment.archived = args.archived === true
      experiment.updatedAt = Date.now()
      await saveLedger(root, ledger)
      await rememberRoot(root)
      const tags = Array.isArray(experiment.tags) && experiment.tags.length > 0 ? ` · tags: ${experiment.tags.join(', ')}` : ''
      return `Experiment ${experiment.id} updated: ${experiment.name}${experiment.archived ? ' · archived' : ''}${tags}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_conclude',
    description: 'Record an experiment conclusion and decision status (draft/approved/rejected). Keeps a bounded history of decisions and shows the conclusion in exp_show and reports.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        text: { type: 'string', description: 'Conclusion text' },
        status: { type: 'string', enum: ['draft', 'approved', 'rejected'], description: 'Decision status' },
        note: { type: 'string', description: 'Optional decision note' },
        decidedBy: { type: 'string', description: 'Optional reviewer/author' },
        role: { type: 'string', description: 'Optional reviewer role, e.g. maintainer' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (args.text === undefined && args.status === undefined) throw new Error('pass text or status')
      if (args.status !== undefined && !['draft', 'approved', 'rejected'].includes(args.status)) {
        throw new Error('status must be draft, approved or rejected')
      }
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const previous = experiment.conclusion ?? {}
      const text = args.text !== undefined ? truncate(String(args.text), 2000) : (previous.text ?? '')
      const status = args.status ?? previous.status ?? 'draft'
      if ((status === 'approved' || status === 'rejected') && text.trim() === '') {
        throw new Error('approved/rejected conclusions need text')
      }
      const decidedBy = args.decidedBy ?? previous.decidedBy ?? null
      const role = args.role ?? previous.role ?? null
      const at = Date.now()
      const signature = decisionSignature(experiment.id, { status, text, decidedBy, role, at })
      const conclusion = {
        text,
        status,
        decidedBy,
        role,
        decidedAt: status === 'draft' ? null : at,
        updatedAt: at,
        signature,
        history: [
          ...(Array.isArray(previous.history) ? previous.history : []),
          { status, text, note: args.note ?? null, decidedBy: args.decidedBy ?? null, role: args.role ?? null, at, signature },
        ].slice(-50),
      }
      experiment.conclusion = conclusion
      experiment.updatedAt = Date.now()
      await saveLedger(root, ledger)
      await rememberRoot(root)
      return `Conclusion for ${experiment.id}: [${status}] ${truncate(text, 300) || '—'}${conclusion.history.length > 0 ? ` · ${conclusion.history.length} decision entries` : ''}${signature !== null ? ` · signed by ${signature.keyId}` : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_reviews',
    description: 'List the experiment review queue, filtered by conclusion status (draft by default) and optionally reviewer/role.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'approved', 'rejected', 'all'], description: 'Conclusion status filter (default draft)' },
        reviewer: { type: 'string', description: 'Filter by decidedBy or role substring' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const status = args.status ?? 'draft'
      const needle = typeof args.reviewer === 'string' ? args.reviewer.toLowerCase() : ''
      const entries = ledger.experiments.filter((experiment) => {
        const conclusion = experiment.conclusion
        if (conclusion === undefined || conclusion === null) return false
        if (status !== 'all' && (conclusion.status ?? 'draft') !== status) return false
        if (needle !== '') {
          const haystack = `${conclusion.decidedBy ?? ''} ${conclusion.role ?? ''}`.toLowerCase()
          if (!haystack.includes(needle)) return false
        }
        return true
      })
      if (entries.length === 0) return `No experiments with conclusion status ${status}${needle ? ` for "${args.reviewer}"` : ''}.`
      const lines = [`${entries.length} experiment(s) · conclusion status ${status}:`]
      for (const experiment of entries) {
        const conclusion = experiment.conclusion
        const by = conclusion.decidedBy ? ` · ${conclusion.decidedBy}${conclusion.role ? ` (${conclusion.role})` : ''}` : ''
        lines.push(`- ${experiment.id} · ${experiment.name} · ${experiment.runs?.length ?? 0} runs · [${conclusion.status ?? 'draft'}]${by} · ${truncate(conclusion.text ?? '', 200)}`)
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_review',
    description: 'Batch approve or reject the conclusions of up to 20 experiments. Each needs an existing conclusion text; decisions append to the conclusion history.',
    parameters: {
      type: 'object',
      properties: {
        experimentIds: { type: 'array', items: { type: 'string' }, description: 'Experiment ids (1-20)' },
        status: { type: 'string', enum: ['approved', 'rejected'], description: 'Decision for every listed experiment' },
        decidedBy: { type: 'string', description: 'Reviewer/author' },
        role: { type: 'string', description: 'Reviewer role' },
        note: { type: 'string', description: 'Optional decision note' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentIds', 'status'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (!Array.isArray(args.experimentIds) || args.experimentIds.length === 0) throw new Error('experimentIds must be a non-empty array')
      if (args.experimentIds.length > 20) throw new Error('at most 20 experiments per review')
      if (!['approved', 'rejected'].includes(args.status)) throw new Error('status must be approved or rejected')
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const done = []
      const skipped = []
      for (const id of args.experimentIds) {
        const experiment = findExperiment(ledger, id)
        if (experiment === undefined) {
          skipped.push(`${id}: not found`)
          continue
        }
        const conclusion = experiment.conclusion
        if (conclusion === undefined || conclusion === null || typeof conclusion.text !== 'string' || conclusion.text.trim() === '') {
          skipped.push(`${id}: no conclusion text`)
          continue
        }
        const history = Array.isArray(conclusion.history) ? conclusion.history : []
        const decidedBy = args.decidedBy ?? conclusion.decidedBy ?? null
        const role = args.role ?? conclusion.role ?? null
        const at = Date.now()
        const signature = decisionSignature(experiment.id, {
          status: args.status, text: conclusion.text, decidedBy, role, at,
        })
        experiment.conclusion = {
          ...conclusion,
          status: args.status,
          decidedBy,
          role,
          decidedAt: at,
          updatedAt: at,
          signature,
          history: [...history, {
            status: args.status,
            text: conclusion.text,
            note: args.note ?? null,
            decidedBy: args.decidedBy ?? null,
            role: args.role ?? null,
            at,
            signature,
          }].slice(-50),
        }
        experiment.updatedAt = Date.now()
        done.push(experiment.id)
      }
      if (done.length > 0) {
        await saveLedger(root, ledger)
        await rememberRoot(root)
      }
      return [
        `Reviewed ${done.length}/${args.experimentIds.length} experiment(s): ${args.status}${done.length > 0 ? ` · ${done.join(', ')}` : ''}`,
        ...(skipped.length > 0 ? [`skipped: ${skipped.join('; ')}`] : []),
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_list',
    description: 'List experiments in the ledger with their run counts and last status.',
    parameters: {
      type: 'object',
      properties: {
        includeArchived: { type: 'boolean', description: 'Include archived experiments' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      await rememberRoot(root).catch(() => {})
      return formatList(ledger, root, args.includeArchived === true)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_show',
    description: 'Show one experiment with its runs, or one run in detail (parameters, metrics, artifacts, output tail, notes).',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        runId: { type: 'string', description: 'Show this run in detail instead of the experiment' },
        limit: { type: 'number', description: 'How many recent runs to show (default 20)' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      if (typeof args.runId === 'string' && args.runId !== '') {
        const run = (experiment.runs ?? []).find((entry) => entry.id === args.runId)
        if (run === undefined) throw new Error(`run not found: ${args.runId}`)
        return formatRunDetail(run)
      }
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 100) : 20
      return formatExperimentDetail(experiment, limit)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_update_run',
    description: 'Update a recorded run\'s label or notes without touching its measurements.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        runId: { type: 'string', description: 'Run id' },
        label: { type: 'string', description: 'New short label' },
        notes: { type: 'string', description: 'New notes (up to 2000 chars)' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId', 'runId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (args.label === undefined && args.notes === undefined) throw new Error('pass label or notes')
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const run = (experiment.runs ?? []).find((entry) => entry.id === args.runId)
      if (run === undefined) throw new Error(`run not found: ${args.runId}`)
      if (args.label !== undefined) run.label = truncate(typeof args.label === 'string' ? args.label : '', 200)
      if (args.notes !== undefined) run.notes = truncate(typeof args.notes === 'string' ? args.notes : '', 2000)
      experiment.updatedAt = Date.now()
      await saveLedger(root, ledger)
      await rememberRoot(root)
      return `Run ${run.id} updated in ${experiment.id}.`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_delete_run',
    description: 'Delete one recorded run from an experiment. Requires confirm=true; the run directory on disk is left untouched.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        runId: { type: 'string', description: 'Run id' },
        confirm: { type: 'boolean', description: 'Set true to delete the run record' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId', 'runId', 'confirm'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (args.confirm !== true) throw new Error('confirm=true is required to delete a run')
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const index = (experiment.runs ?? []).findIndex((entry) => entry.id === args.runId)
      if (index < 0) throw new Error(`run not found: ${args.runId}`)
      experiment.runs.splice(index, 1)
      experiment.updatedAt = Date.now()
      await saveLedger(root, ledger)
      await rememberRoot(root)
      return `Deleted run ${args.runId} from ${experiment.id}; ${experiment.runs.length} run(s) remain.`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_compare',
    description: 'Compare the runs of one experiment: group by factor values, summarize each metric (mean, sd, min, max) and list the best run per metric direction. By default it groups by the factors that actually vary.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        groupBy: {
          type: 'array',
          items: { type: 'string' },
          description: 'Factor keys to group by; an empty array means all runs together. Default: the factors that vary',
        },
        metrics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Metric keys to include; defaults to every declared and observed metric',
        },
        compareGroups: {
          type: 'array',
          items: { type: 'string' },
          description: 'Two group labels (or keys) to compare pairwise: difference, 95% CI, Cohen d and Welch p',
        },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const groupBy = Array.isArray(args.groupBy) ? args.groupBy : varyingFactors(experiment)
      const comparison = compareRuns(experiment, {
        groupBy,
        metrics: args.metrics,
        compareGroups: args.compareGroups,
      })
      return formatComparison(experiment, comparison)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_diff',
    description: 'Compare one run with another run of the same experiment (default: the run recorded just before it): parameters, metrics and artifacts that changed.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        runId: { type: 'string', description: 'The run to inspect (the later side of the diff)' },
        compareToRunId: { type: 'string', description: 'Baseline run; defaults to the run recorded just before runId' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId', 'runId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const runs = Array.isArray(experiment.runs) ? experiment.runs : []
      const index = runs.findIndex((run) => run.id === args.runId)
      if (index < 0) throw new Error(`run not found: ${args.runId}`)
      const target = runs[index]
      let base
      if (typeof args.compareToRunId === 'string' && args.compareToRunId !== '') {
        base = runs.find((run) => run.id === args.compareToRunId)
        if (base === undefined) throw new Error(`run not found: ${args.compareToRunId}`)
      } else {
        base = runs[index - 1]
      }
      if (base === undefined) throw new Error('no earlier run to compare with; pass compareToRunId')
      return formatDiff(diffRuns(base, target))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_baseline',
    description: 'Add, replace or clear named baselines for an experiment: each baseline snapshots one run from another experiment (metrics and params), so comparison, run detail and reports show deltas. Without baselineRunId the latest run with metrics is used; clearing with baselineId/name removes one, otherwise all.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        baselineExperimentId: { type: 'string', description: 'Experiment providing the baseline run' },
        baselineRunId: { type: 'string', description: 'Run id; defaults to the latest run with metrics' },
        name: { type: 'string', description: 'Baseline name; defaults to "<experiment> / <run>" and replaces a same-named baseline' },
        clear: { type: 'boolean', description: 'Remove one baseline (with baselineId/name) or every baseline' },
        baselineId: { type: 'string', description: 'Remove this baseline id when clear is true' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      let baselines
      try {
        baselines = applyBaselines(ledger, experiment, {
          clear: args.clear === true,
          baselineId: args.baselineId,
          name: args.name,
          baselineExperimentId: args.baselineExperimentId,
          baselineRunId: args.baselineRunId,
        })
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error))
      }
      await saveLedger(root, ledger)
      await rememberRoot(root)
      if (baselines.length === 0) return `Baselines cleared for ${experiment.id}.`
      const lines = [`Baselines for ${experiment.id}: ${baselines.length}`]
      for (const baseline of baselines) {
        const metrics = Object.entries(baseline.metrics).map(([key, value]) => `${key}=${formatValue(value)}`).join(', ')
        lines.push(`- ${baseline.name}: ${baseline.experimentName} / ${baseline.label} (${baseline.runId})${metrics === '' ? '' : ` · ${metrics}`}`)
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'exp_report',
    description: 'Write a report for one experiment: design (factors and metrics), runs table, grouped comparison with mean±sd and 95% CI, best runs, artifacts, and a generation stamp. Markdown by default; format="html" writes a self-contained HTML report, format="print" writes a print-optimised HTML (use the browser to save as PDF). The report is saved under the ledger and its SHA-256 is returned.',
    parameters: {
      type: 'object',
      properties: {
        experimentId: { type: 'string', description: 'Experiment id' },
        groupBy: {
          type: 'array',
          items: { type: 'string' },
          description: 'Factor keys to group by in the comparison; defaults to the factors that vary',
        },
        maxRuns: { type: 'number', description: 'Maximum runs listed in the runs table (default 100)' },
        format: { type: 'string', enum: ['markdown', 'html', 'print'], description: 'Report format (default markdown)' },
        root: { type: 'string', description: 'Ledger directory; defaults to .experiments' },
      },
      required: ['experimentId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const root = ledgerRoot(exec, args)
      const ledger = await loadLedger(root)
      const experiment = requireExperiment(ledger, args.experimentId)
      const format = args.format === 'print' ? 'print' : args.format === 'html' ? 'html' : 'markdown'
      const report = await generateReportFor(root, ledger, experiment, {
        groupBy: Array.isArray(args.groupBy) ? args.groupBy : undefined,
        maxRuns: args.maxRuns,
        format,
      })
      const size = report.bytes < 1024 ? `${report.bytes} B` : `${(report.bytes / 1024).toFixed(1)} KB`
      return [
        `${format === 'html' ? 'HTML report' : format === 'print' ? 'Print report' : 'Report'} written for ${experiment.id}: ${report.path}`,
        `size: ${size} · sha256: ${report.sha256.slice(0, 16)}… · runs: ${report.summary.runs} · groups: ${report.summary.groups} · charts: ${report.summary.charts} · datasets: ${report.summary.datasets}`,
        'Open it directly, or read it with the read tool.',
      ].join('\n')
    },
  }))
}

/** One HTTP error the route layer reports with its own status. */
class RequestError extends Error {
  /**
   * @param {number} status - HTTP status.
   * @param {string} message - client-facing message.
   */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Build one route handler: method check, package header, same-origin check,
 * then the operation with a JSON response.
 * @param {object} ctx - plugin context.
 * @param {string} method - allowed method.
 * @param {(req: import('node:http').IncomingMessage) => Promise<object>} run - operation.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} the handler.
 */
function serve(ctx, method, run) {
  return async (req, res) => {
    try {
      if (req.method !== method) {
        res.writeHead(405, { allow: method, 'content-length': '0' })
        res.end()
        return
      }
      if (req.headers[REQUEST_HEADER] !== '1') {
        sendJson(res, 403, { ok: false, error: 'missing plugin request header' })
        return
      }
      if (!sameOrigin(req)) {
        sendJson(res, 403, { ok: false, error: 'cross-origin request refused' })
        return
      }
      sendJson(res, 200, await run(req))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = error instanceof RequestError ? error.status : message.startsWith('bad request:') ? 400 : 500
      ctx.logger?.warn?.('experiment-ledger: %s %s failed: %s', method, ROUTE_BASE, message)
      try {
        sendJson(res, status, { ok: false, error: message })
      } catch {
        /* socket already gone */
      }
    }
  }
}

/**
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {boolean} whether the request comes from this server's own page.
 */
function sameOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  const host = req.headers.host
  return typeof host === 'string' && parsed.host === host
}

/**
 * @param {import('node:http').ServerResponse} res - response sink.
 * @param {number} status - HTTP status.
 * @param {object} payload - JSON payload.
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/**
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {URL} the request URL with a loopback base.
 */
function requestUrl(req) {
  return new URL(req.url ?? '/', 'http://127.0.0.1')
}

/**
 * GET /list?root= — remembered roots plus the experiments under one root.
 * @param {object} _ctx - plugin context.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function listPayload(_ctx, req) {
  const url = requestUrl(req)
  const requested = url.searchParams.get('root')
  const roots = await listRoots()
  const root = typeof requested === 'string' && requested.trim() !== ''
    ? resolve(requested.trim())
    : roots[0]?.path ?? null
  if (root === null) return { ok: true, roots, root: null, experiments: [] }
  let ledger
  try {
    ledger = await loadLedger(root)
  } catch (error) {
    throw new RequestError(500, error instanceof Error ? error.message : String(error))
  }
  const experiments = ledger.experiments
    .map(summarizeExperiment)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
  return { ok: true, roots, root, experiments }
}

/**
 * GET /experiment?root=&id= — one experiment with its runs.
 * @param {object} _ctx - plugin context.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function experimentPayload(_ctx, req) {
  const url = requestUrl(req)
  const root = url.searchParams.get('root')
  const id = url.searchParams.get('id')
  if (typeof root !== 'string' || root.trim() === '') throw new RequestError(400, 'bad request: root is required')
  if (typeof id !== 'string' || id.trim() === '') throw new RequestError(400, 'bad request: id is required')
  const ledgerRoot = resolve(root.trim())
  const ledger = await loadLedger(ledgerRoot)
  if (finalizeScheduleJobs(ledger)) await saveLedger(ledgerRoot, ledger)
  const experiment = findExperiment(ledger, id.trim())
  if (experiment === undefined) throw new RequestError(404, `experiment not found: ${id}`)
  return { ok: true, experiment }
}

/**
 * Read a bounded JSON object body.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the parsed body.
 */
async function readJsonBody(req, limit = 128 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new RequestError(413, 'request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  let body
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RequestError(400, 'invalid JSON body')
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError(400, 'JSON body must be an object')
  }
  return body
}

/**
 * @param {object} body - parsed body.
 * @param {string} key - field name.
 * @returns {string} the trimmed field.
 */
function bodyString(body, key) {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '') throw new RequestError(400, `${key} is required`)
  return value.trim()
}

/**
 * GET /candidates — recent passively recorded commands.
 * @returns {Promise<object>} the payload.
 */
async function candidatesPayload() {
  return { ok: true, candidates: await listCandidates(50) }
}

/**
 * POST /promote — turn a candidate into a run of one experiment.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function promotePayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const candidateId = bodyString(body, 'candidateId')
  const experimentId = bodyString(body, 'experimentId')
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, experimentId)
  if (experiment === undefined) throw new RequestError(404, `experiment not found: ${experimentId}`)
  const candidate = await findCandidate(candidateId)
  if (candidate === undefined) throw new RequestError(404, `candidate not found: ${candidateId}`)
  const cwd = typeof candidate.cwd === 'string' && candidate.cwd !== '' ? candidate.cwd : root
  const run = await promoteCandidateRun({
    root,
    ledger,
    experiment,
    candidate,
    cwd,
    params: body.params,
    metrics: body.metrics,
    label: body.label,
    notes: body.notes,
  })
  return {
    ok: true,
    run: {
      id: run.id,
      label: run.label,
      status: run.status,
      durationMs: run.durationMs,
      params: run.params,
      metrics: run.metrics,
    },
    summary: runSummary(run, root, experiment),
  }
}

/**
 * POST /report — write a report for one experiment.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function reportPayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const experimentId = bodyString(body, 'experimentId')
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, experimentId)
  if (experiment === undefined) throw new RequestError(404, `experiment not found: ${experimentId}`)
  let groupBy
  if (body.groupBy !== undefined) {
    if (!Array.isArray(body.groupBy) || body.groupBy.some((key) => typeof key !== 'string')) {
      throw new RequestError(400, 'groupBy must be an array of strings')
    }
    groupBy = body.groupBy
  }
  const report = await generateReportFor(root, ledger, experiment, {
    groupBy,
    maxRuns: typeof body.maxRuns === 'number' ? body.maxRuns : undefined,
    format: body.format === 'print' ? 'print' : body.format === 'html' ? 'html' : 'markdown',
  })
  return {
    ok: true,
    report: {
      path: report.path,
      relative: report.relative,
      sha256: report.sha256,
      bytes: report.bytes,
      summary: report.summary,
    },
  }
}

/** Background sweeps started from the panel, keyed by job id. */
const sweepJobs = new Map()
/** Last panel-open request from the agent, polled by the client. */
let panelOpenRequest = null
/** Finished jobs kept for later inspection. */
const MAX_SWEEP_JOBS = 6
/** Concurrent sweeps allowed. */
const MAX_RUNNING_SWEEPS = 3

/**
 * @param {object} job - one sweep job.
 * @returns {object} the JSON-safe view.
 */
function sweepJobView(job) {
  return {
    id: job.id,
    status: job.status,
    experimentId: job.experimentId,
    total: job.total,
    done: job.done,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    error: job.error,
    stopped: job.stopped,
    runs: job.runs.filter(Boolean).map((run) => ({
      id: run.id,
      label: run.label,
      status: run.status,
      durationMs: run.durationMs,
      params: run.params,
      metrics: run.metrics,
    })),
    errors: job.errors,
  }
}

/**
 * Create and start a background sweep job.
 * @param {object} options - sweep inputs.
 * @returns {object} the job (already running).
 */
function startSweepJob(options) {
  const running = [...sweepJobs.values()].filter((job) => job.status === 'running').length
  if (running >= MAX_RUNNING_SWEEPS) throw new RequestError(429, `too many running sweeps (${MAX_RUNNING_SWEEPS})`)
  const id = `sweep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const job = {
    id,
    experimentId: options.experiment.id,
    status: 'running',
    total: options.combos.length,
    done: 0,
    startedAt: Date.now(),
    endedAt: null,
    error: null,
    stopped: false,
    cancelRequested: false,
    runs: [],
    errors: [],
    root: options.root,
  }
  sweepJobs.set(id, job)
  const finished = [...sweepJobs.values()]
    .filter((entry) => entry.status !== 'running')
    .sort((left, right) => left.startedAt - right.startedAt)
  while (sweepJobs.size > MAX_SWEEP_JOBS && finished.length > 0) {
    sweepJobs.delete(finished.shift().id)
  }
  void runSweepJob(job, options)
  return job
}

const DEFAULT_MANIFEST_ENV = ['EXP_*', 'CUDA_VISIBLE_DEVICES', 'OMP_NUM_THREADS', 'PYTHONHASHSEED', 'NODE_OPTIONS']

/**
 * Run a command and capture trimmed stdout; returns null on failure.
 * @param {string} command - executable.
 * @param {string[]} args - arguments.
 * @param {string} cwd - working directory.
 * @returns {Promise<string|null>} stdout or null.
 */
function captureCommand(command, args, cwd) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: 2000, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout) => {
      resolve(error ? null : String(stdout).trim())
    })
  })
}

/**
 * Capture the git state of a directory.
 * @param {string} cwd - working directory.
 * @returns {Promise<{commit: string, branch: string, dirty: boolean}|null>} git state.
 */
async function captureGit(cwd) {
  const commit = await captureCommand('git', ['rev-parse', 'HEAD'], cwd)
  if (commit === null || commit === '') return null
  const branch = await captureCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  const status = await captureCommand('git', ['status', '--porcelain'], cwd)
  return { commit, branch: branch ?? '', dirty: status !== null && status !== '' }
}

/**
 * Capture allow-listed environment variables.
 * @returns {Record<string, string>} captured environment.
 */
function captureManifestEnv() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    const allowed = DEFAULT_MANIFEST_ENV.some((pattern) => pattern.endsWith('*')
      ? key.startsWith(pattern.slice(0, -1))
      : key === pattern)
    if (allowed) env[key] = truncate(String(value ?? ''), 300)
  }
  return env
}

/**
 * Build the reproducibility manifest for a run.
 * @param {string} cwd - working directory.
 * @param {string} command - substituted command.
 * @returns {Promise<object>} the manifest.
 */
async function captureManifest(cwd, command, timeoutMs) {
  return {
    command,
    cwd,
    timeoutMs,
    git: await captureGit(cwd),
    toolchain: { node: process.version, platform: process.platform, arch: process.arch },
    env: captureManifestEnv(),
    capturedAt: Date.now(),
  }
}

/**
 * Compare one value against a search condition.
 * @param {unknown} actual - recorded value.
 * @param {string} op - eq, ne, gt, gte, lt, lte or contains.
 * @param {unknown} expected - expected value.
 * @returns {boolean} whether the condition matches.
 */
function matchesCondition(actual, op, expected) {
  if (op === 'contains') return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase())
  const numeric = Number(actual)
  const target = Number(expected)
  if (Number.isFinite(numeric) && Number.isFinite(target)) {
    if (op === 'gt') return numeric > target
    if (op === 'gte') return numeric >= target
    if (op === 'lt') return numeric < target
    if (op === 'lte') return numeric <= target
    if (op === 'ne') return numeric !== target
    return numeric === target
  }
  if (op === 'ne') return String(actual ?? '') !== String(expected ?? '')
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') return false
  return String(actual ?? '') === String(expected ?? '')
}

/**
 * Search runs across one ledger.
 * @param {object} ledger - loaded ledger.
 * @param {{query?: string, experimentId?: string, status?: string, since?: string, paramFilters?: object[], metricFilters?: object[], sortMetric?: string, direction?: string, limit?: number}} options - search options.
 * @returns {object[]} ranked result rows.
 */
function searchLedger(ledger, options) {
  const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : ''
  const since = typeof options.since === 'string' && options.since !== '' ? Date.parse(options.since) : null
  const results = []
  for (const experiment of ledger.experiments) {
    if (experiment.archived === true && options.includeArchived !== true) continue
    if (typeof options.experimentId === 'string' && options.experimentId !== '' && experiment.id !== options.experimentId) continue
    for (const run of experiment.runs ?? []) {
      if (typeof options.status === 'string' && options.status !== '' && options.status !== 'any' && run.status !== options.status) continue
      if (since !== null && !Number.isNaN(since) && typeof run.startedAt === 'number' && run.startedAt < since) continue
      if (query !== '') {
        const haystack = [
          experiment.name,
          experiment.id,
          ...(experiment.tags ?? []),
          experiment.conclusion?.text ?? '',
          experiment.conclusion?.status ?? '',
          run.id,
          run.label,
          run.command,
          run.notes,
          JSON.stringify(run.params ?? {}),
          JSON.stringify(run.metrics ?? {}),
        ].join(' ').toLowerCase()
        if (!haystack.includes(query)) continue
      }
      if (Array.isArray(options.paramFilters) && options.paramFilters.some((filter) =>
        !matchesCondition(run.params?.[filter.key], filter.op ?? 'eq', filter.value))) continue
      if (Array.isArray(options.metricFilters) && options.metricFilters.some((filter) =>
        !matchesCondition(run.metrics?.[filter.key], filter.op ?? 'eq', filter.value))) continue
      results.push({ experimentId: experiment.id, experimentName: experiment.name, run })
    }
  }
  if (typeof options.sortMetric === 'string' && options.sortMetric !== '') {
    const direction = options.direction === 'min' ? 1 : -1
    results.sort((left, right) => {
      const a = Number(left.run.metrics?.[options.sortMetric])
      const b = Number(right.run.metrics?.[options.sortMetric])
      if (!Number.isFinite(a) && !Number.isFinite(b)) return 0
      if (!Number.isFinite(a)) return 1
      if (!Number.isFinite(b)) return -1
      return (a - b) * direction
    })
  } else {
    results.sort((left, right) => (right.run.startedAt ?? 0) - (left.run.startedAt ?? 0))
  }
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50)
  return results.slice(0, limit).map(({ experimentId, experimentName, run }) => ({
    experimentId,
    experimentName,
    run: {
      id: run.id,
      label: run.label,
      status: run.status,
      params: run.params ?? {},
      metrics: run.metrics ?? {},
      command: run.command ?? '',
      notes: run.notes ?? '',
      startedAt: run.startedAt,
      durationMs: run.durationMs,
      manifest: run.manifest,
    },
  }))
}

const SCRIPT_INTERPRETERS = new Set(['python', 'python3', 'py', 'node', 'nodejs', 'bash', 'sh', 'pwsh', 'powershell', 'ruby', 'perl'])
const SCRIPT_EXTENSIONS = /\.(py|js|mjs|cjs|sh|ps1|rb|pl)$/i

/**
 * Split a shell command into approximate tokens.
 * @param {string} command - shell command.
 * @returns {string[]} tokens.
 */
function commandTokens(command) {
  const tokens = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = pattern.exec(command)) !== null) tokens.push(match[1] ?? match[2] ?? match[3])
  return tokens
}

/**
 * Find a script argument that a command clearly refers to, if any.
 * @param {string} command - shell command.
 * @returns {string|null} script path.
 */
function expectedScript(command) {
  const tokens = commandTokens(command)
  if (tokens.length === 0) return null
  const first = tokens[0].toLowerCase().replace(/\.exe$/, '')
  const base = first.includes('\\') || first.includes('/')
    ? first.slice(Math.max(first.lastIndexOf('\\'), first.lastIndexOf('/')) + 1)
    : first
  if (SCRIPT_INTERPRETERS.has(base) && tokens[1] !== undefined && !tokens[1].startsWith('-') && SCRIPT_EXTENSIONS.test(tokens[1])) {
    return tokens[1]
  }
  if (!first.startsWith('-') && SCRIPT_EXTENSIONS.test(tokens[0])) return tokens[0]
  return null
}

/**
 * Check that a script named by the command exists before rerunning it.
 * @param {string} command - shell command.
 * @param {string} cwd - working directory.
 * @returns {string|null} a clear problem, or null.
 */
function preflightCommand(command, cwd) {
  const script = expectedScript(command)
  if (script === null || script === '') return null
  const file = isAbsolute(script) ? script : resolve(cwd, script)
  if (!existsSync(file)) return `command file not found: ${file} (cwd ${cwd})`
  return null
}

/**
 * Rerun a recorded run with the same command and parameters.
 * @param {string} root - ledger directory.
 * @param {object} ledger - loaded ledger.
 * @param {object} experiment - target experiment.
 * @param {object} source - source run.
 * @returns {Promise<object>} the new run.
 */
async function reproduceRun(root, ledger, experiment, source) {
  const manifest = source.manifest ?? {}
  const recorded = typeof manifest.command === 'string' && manifest.command !== ''
    ? manifest.command
    : substitute(source.command ?? '', normalizeParams(source.params ?? {}))
  const command = recorded
  if (typeof command !== 'string' || command.trim() === '') throw new Error('run has no command to reproduce')
  const cwd = typeof manifest.cwd === 'string' && manifest.cwd !== '' ? manifest.cwd : (source.cwd || process.cwd())
  if (!existsSync(cwd)) throw new Error(`original working directory is missing: ${cwd}`)
  const preflight = preflightCommand(command, cwd)
  if (preflight !== null) throw new Error(preflight)
  const run = await performRun({
    root,
    experiment,
    resolvedCommand: command,
    params: source.params ?? {},
    label: `reproduce ${source.id}`,
    cwd,
    timeoutMs: source.timeoutMs ?? manifest.timeoutMs,
    manifestEnv: manifest.env ?? {},
    notes: `reproduced from ${source.id}`,
  })
  run.reproducedFrom = source.id
  await appendRun(root, ledger, experiment, run)
  return run
}

/**
 * Run one job to completion, updating its progress.
 * @param {object} job - the job record.
 * @param {object} options - sweep inputs.
 * @returns {Promise<void>} resolution when every worker finished.
 */
async function runSweepJob(job, options) {
  try {
    const { stopped } = await executeSweep(
      { ...options, shouldStop: () => job.cancelRequested },
      (event) => {
        job.done += 1
        if (event.run !== undefined) job.runs[event.index] = event.run
        else job.errors.push({ index: event.index, error: event.error })
      },
    )
    job.stopped = stopped || job.cancelRequested
    job.status = job.cancelRequested ? 'stopped' : 'done'
  } catch (error) {
    job.status = 'failed'
    job.error = error instanceof Error ? error.message : String(error)
  } finally {
    job.endedAt = Date.now()
  }
}

/**
 * POST /sweep — start a background sweep.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload with the initial job view.
 */
async function startSweepPayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const experimentId = bodyString(body, 'experimentId')
  const command = bodyString(body, 'command')
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, experimentId)
  if (experiment === undefined) throw new RequestError(404, `experiment not found: ${experimentId}`)
  const combos = sweepCombos(body)
  const maxRuns = typeof body.maxRuns === 'number' ? Math.min(Math.max(1, Math.round(body.maxRuns)), 100) : 50
  if (combos.length > maxRuns) {
    throw new RequestError(400, `sweep has ${combos.length} runs; raise maxRuns (max 100) or narrow the grid`)
  }
  const cwd = typeof body.cwd === 'string' && body.cwd.trim() !== '' ? resolve(body.cwd.trim()) : dirname(root)
  const job = startSweepJob({
    root,
    ledger,
    experiment,
    combos,
    commandTemplate: command,
    label: typeof body.label === 'string' ? body.label.trim() : '',
    cwd,
    timeoutMs: body.timeoutMs,
    artifacts: body.artifacts,
    datasets: body.datasets,
    notes: body.notes,
    maxParallel: body.maxParallel,
    failFast: body.failFast === true,
  })
  return { ok: true, job: sweepJobView(job) }
}

/**
 * GET /sweep/status?jobId= — one job's progress.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {object} the payload.
 */
function sweepStatusPayload(req) {
  const jobId = requestUrl(req).searchParams.get('jobId')
  if (typeof jobId !== 'string' || jobId.trim() === '') throw new RequestError(400, 'jobId is required')
  const job = sweepJobs.get(jobId.trim())
  if (job === undefined) throw new RequestError(404, `sweep job not found: ${jobId}`)
  return { ok: true, job: sweepJobView(job) }
}

/**
 * POST /sweep/stop — ask a job to stop scheduling.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function stopSweepPayload(req) {
  const body = await readJsonBody(req)
  const jobId = bodyString(body, 'jobId')
  const job = sweepJobs.get(jobId)
  if (job === undefined) throw new RequestError(404, `sweep job not found: ${jobId}`)
  job.cancelRequested = true
  return { ok: true, job: sweepJobView(job) }
}

/**
 * Render the duration trend of a schedule as a standalone SVG.
 * @param {object[]} history - schedule history entries.
 * @returns {string} SVG markup.
 */
function scheduleChartSvg(history) {
  const width = 720
  const height = 180
  const pad = 26
  const values = history.map((entry) => Math.max(1, entry.durationMs ?? ((entry.endedAt ?? 0) - (entry.startedAt ?? 0))))
  const max = Math.max(...values, 1)
  const step = (width - pad * 2) / Math.max(values.length, 1)
  const bars = history.map((entry, index) => {
    const value = values[index]
    const barHeight = Math.max(2, Math.round((value / max) * (height - pad - 28)))
    const x = Math.round(pad + index * step + 3)
    const barWidth = Math.max(4, Math.floor(step) - 6)
    const fill = entry.status === 'done' ? '#2e7d32' : '#c62828'
    return `<rect x="${x}" y="${height - pad - barHeight}" width="${barWidth}" height="${barHeight}" fill="${fill}"><title>#${index + 1} ${entry.status} · ${formatNumber(value)} ms</title></rect>`
  }).join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#d0d5dd"/>`,
    `<text x="${pad}" y="16" fill="#667085" font-size="11" font-family="sans-serif">duration (ms)</text>`,
    `<text x="${width - pad}" y="16" fill="#667085" font-size="11" text-anchor="end" font-family="sans-serif">${formatNumber(max)}</text>`,
    bars,
    '</svg>',
  ].join('')
}

/**
 * Write a Markdown report for one schedule (history + duration trend).
 * @param {string} root - ledger directory.
 * @param {object} experiment - experiment owning the schedule.
 * @param {object} schedule - schedule record.
 * @returns {Promise<object>} the written report.
 */
async function writeScheduleReport(root, experiment, schedule) {
  const history = Array.isArray(schedule.history) ? schedule.history : []
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safe = String(schedule.name).replace(/[^A-Za-z0-9._-]+/g, '-')
  const directory = join(root, 'reports', `schedule-${safe}-${stamp}`)
  await fsp.mkdir(directory, { recursive: true })
  const chartFile = join(directory, 'chart.svg')
  await fsp.writeFile(chartFile, scheduleChartSvg(history), 'utf8')
  const ok = history.filter((entry) => entry.status === 'done').length
  const durations = history
    .map((entry) => entry.durationMs ?? ((entry.endedAt ?? 0) - (entry.startedAt ?? 0)))
    .filter((value) => Number.isFinite(value) && value >= 0)
  const avg = durations.length === 0 ? null : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
  const lines = [
    `# Schedule report: ${schedule.name}`,
    '',
    `- Experiment: ${experiment.name} (${experiment.id})`,
    `- Preset: ${schedule.preset}`,
    `- Interval: ${Math.round((schedule.intervalMs ?? 0) / 60000)} min`,
    `- Retries: ${schedule.retryLimit ?? 0} · backoff ${Math.round((schedule.retryDelayMs ?? 60000) / 1000)} s`,
    `- Failure limit: ${schedule.failureLimit ?? 0}`,
    `- Enabled: ${schedule.enabled === false ? 'no' : 'yes'}`,
    `- Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- Runs recorded: ${history.length}`,
    `- Successful: ${ok}`,
    `- Failed: ${history.length - ok}`,
    `- Average duration: ${avg === null ? '—' : `${formatNumber(avg)} ms`}`,
    '',
    '## History',
    '',
    '| # | Time | Status | Attempt | Done | Failed | Duration | Metrics |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const [index, entry] of history.entries()) {
    const time = typeof entry.startedAt === 'number' ? new Date(entry.startedAt).toISOString() : '—'
    const metrics = Object.entries(entry.metrics ?? {})
      .map(([key, value]) => `${key}=${formatNumber(value)}`)
      .join(', ') || '—'
    lines.push(`| ${index + 1} | ${time} | ${entry.status} | ${entry.attempt ?? index + 1} | ${entry.done ?? 0}/${entry.total ?? 0} | ${entry.failed ?? 0} | ${entry.durationMs === undefined ? '—' : `${formatNumber(entry.durationMs)} ms`} | ${metrics} |`)
  }
  lines.push('', '## Duration trend', '', '![Duration trend](chart.svg)', '')
  const file = join(directory, 'report.md')
  await fsp.writeFile(file, `${lines.join('\n')}\n`, 'utf8')
  const digest = await hashFile(file)
  const reportRelative = relative(root, file)
  const summary = { runs: history.length, ok, failed: history.length - ok, averageDurationMs: avg }
  experiment.scheduleReports = [...(Array.isArray(experiment.scheduleReports) ? experiment.scheduleReports : []), {
    id: `srep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    path: reportRelative,
    sha256: digest.sha256,
    bytes: digest.bytes,
    createdAt: Date.now(),
    summary,
  }].slice(-20)
  schedule.lastReport = reportRelative
  return {
    path: file,
    relative: reportRelative,
    sha256: digest.sha256,
    bytes: digest.bytes,
    summary,
  }
}

/**
 * GET /schedule/reports?root=&experimentId=&scheduleId= — archived schedule reports.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function scheduleReportsPayload(req) {
  const url = requestUrl(req)
  const rootParam = url.searchParams.get('root')
  const experimentId = url.searchParams.get('experimentId')
  const scheduleId = url.searchParams.get('scheduleId')
  if (typeof rootParam !== 'string' || rootParam.trim() === '') throw new RequestError(400, 'root is required')
  if (typeof experimentId !== 'string' || experimentId.trim() === '') throw new RequestError(400, 'experimentId is required')
  const ledger = await loadLedger(resolve(rootParam.trim()))
  const experiment = findExperiment(ledger, experimentId.trim())
  if (experiment === undefined) throw new RequestError(404, `experiment not found: ${experimentId}`)
  const reports = (Array.isArray(experiment.scheduleReports) ? experiment.scheduleReports : [])
    .filter((report) => typeof scheduleId !== 'string' || scheduleId === '' || report.scheduleId === scheduleId)
    .slice()
    .reverse()
  return { ok: true, reports }
}

/**
 * POST /schedule — save, delete, toggle or run a scheduled sweep.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function schedulePayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const experimentId = bodyString(body, 'experimentId')
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, experimentId)
  if (experiment === undefined) throw new RequestError(404, `experiment not found: ${experimentId}`)
  const action = typeof body.action === 'string' && body.action !== '' ? body.action : 'list'
  if (action === 'report') {
    const schedules = Array.isArray(experiment.schedules) ? experiment.schedules : []
    const schedule = schedules.find((entry) =>
      (typeof body.scheduleId === 'string' && entry.id === body.scheduleId) ||
      (typeof body.name === 'string' && entry.name === body.name))
    if (schedule === undefined) throw new RequestError(404, 'schedule not found')
    const report = await writeScheduleReport(root, experiment, schedule)
    await saveLedger(root, ledger)
    await rememberRoot(root)
    return { ok: true, report }
  }
  if (action === 'run' || action === 'resume-run') {
    const schedules = Array.isArray(experiment.schedules) ? experiment.schedules : []
    const schedule = schedules.find((entry) =>
      (typeof body.scheduleId === 'string' && entry.id === body.scheduleId) ||
      (typeof body.name === 'string' && entry.name === body.name))
    if (schedule === undefined) throw new RequestError(404, 'schedule not found')
    if (action === 'resume-run') {
      schedule.enabled = true
      schedule.failureCount = 0
    }
    schedule.retryCount = 0
    let job
    try {
      job = runScheduleNow(root, ledger, experiment, schedule)
    } catch (error) {
      throw new RequestError(400, error instanceof Error ? error.message : String(error))
    }
    await saveLedger(root, ledger)
    await rememberRoot(root)
    return { ok: true, schedules: experiment.schedules, job: { id: job.id, total: job.total, status: job.status } }
  }
  let schedules
  try {
    schedules = applySchedule(experiment, {
      action,
      scheduleId: typeof body.scheduleId === 'string' ? body.scheduleId : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      preset: typeof body.preset === 'string' ? body.preset : undefined,
      intervalMinutes: body.intervalMinutes,
      enabled: body.enabled,
      retryLimit: body.retryLimit,
      retryDelayMs: body.retryDelayMs,
      failureLimit: body.failureLimit,
    })
  } catch (error) {
    throw new RequestError(400, error instanceof Error ? error.message : String(error))
  }
  await saveLedger(root, ledger)
  await rememberRoot(root)
  return { ok: true, schedules }
}

/**
 * POST /preset — save or delete a sweep preset.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload with the resulting presets.
 */
async function presetPayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const experimentId = bodyString(body, 'experimentId')
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, experimentId)
  if (experiment === undefined) throw new RequestError(404, `experiment not found: ${experimentId}`)
  let presets
  try {
    presets = applyPreset(experiment, {
      action: typeof body.action === 'string' ? body.action : 'list',
      name: typeof body.name === 'string' ? body.name : undefined,
      command: typeof body.command === 'string' ? body.command : undefined,
      grid: body.grid,
      rows: body.rows,
      maxParallel: body.maxParallel,
      failFast: body.failFast,
      timeoutMs: body.timeoutMs,
      presetId: typeof body.presetId === 'string' ? body.presetId : undefined,
    })
  } catch (error) {
    throw new RequestError(400, error instanceof Error ? error.message : String(error))
  }
  await saveLedger(root, ledger)
  await rememberRoot(root)
  return { ok: true, presets }
}

/**
 * POST /baseline — set or clear an experiment's baseline.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload with the new baseline.
 */
async function baselinePayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const experimentId = bodyString(body, 'experimentId')
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, experimentId)
  if (experiment === undefined) throw new RequestError(404, `experiment not found: ${experimentId}`)
  let baselines
  try {
    baselines = applyBaselines(ledger, experiment, {
      clear: body.clear === true,
      baselineId: typeof body.baselineId === 'string' ? body.baselineId : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      baselineExperimentId: typeof body.baselineExperimentId === 'string' ? body.baselineExperimentId : undefined,
      baselineRunId: typeof body.baselineRunId === 'string' ? body.baselineRunId : undefined,
    })
  } catch (error) {
    throw new RequestError(400, error instanceof Error ? error.message : String(error))
  }
  await saveLedger(root, ledger)
  await rememberRoot(root)
  return { ok: true, baselines, baseline: baselines[0] ?? null }
}

/**
 * GET /baseline/options?root= — experiments and runs the panel can choose as a baseline.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function baselineOptionsPayload(req) {
  const rootParam = requestUrl(req).searchParams.get('root')
  if (typeof rootParam !== 'string' || rootParam.trim() === '') throw new RequestError(400, 'root is required')
  const ledger = await loadLedger(resolve(rootParam.trim()))
  const experiments = ledger.experiments
    .map((experiment) => ({
      id: experiment.id,
      name: experiment.name,
      runs: (Array.isArray(experiment.runs) ? experiment.runs : []).slice(-50).map((run) => ({
        id: run.id,
        label: run.label ?? run.id,
        metrics: run.metrics ?? {},
        params: run.params ?? {},
      })),
    }))
    .filter((experiment) => experiment.runs.length > 0)
  return { ok: true, experiments }
}

/**
 * Open one local file with the OS default application.
 * @param {string} file - absolute path.
 */
function openLocalFile(file) {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [file], { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

/**
 * POST /report/open — open the experiment's latest report in the OS.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function openReportPayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const experimentId = bodyString(body, 'experimentId')
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, experimentId)
  if (experiment === undefined) throw new RequestError(404, `experiment not found: ${experimentId}`)
  const reports = Array.isArray(experiment.reports) ? experiment.reports : []
  const report = reports[reports.length - 1]
  if (report === undefined) throw new RequestError(404, 'no report yet; generate one first')
  const reportsRoot = resolve(root, 'reports')
  const file = resolve(root, report.path)
  if (!file.startsWith(`${reportsRoot}${sep}`)) throw new RequestError(400, 'report path is outside the ledger reports directory')
  if (!existsSync(file)) throw new RequestError(404, `report file is missing: ${file}`)
  if (process.env.DSH_EXPERIMENT_LEDGER_NO_OPEN === '1') return { ok: true, opened: file, skipped: true }
  try {
    openLocalFile(file)
  } catch (error) {
    throw new RequestError(500, `could not open the report: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { ok: true, opened: file }
}

/**
 * Normalize comparison references from a request body or query.
 * @param {unknown} value - array of `{root, experimentId|id}`.
 * @returns {Array<{root: string, id: string}>} deduplicated refs.
 */
function normalizeCompareRefs(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const refs = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue
    const root = typeof entry.root === 'string' ? entry.root.trim() : ''
    const id = typeof entry.experimentId === 'string'
      ? entry.experimentId.trim()
      : typeof entry.id === 'string' ? entry.id.trim() : ''
    if (root === '' || id === '') continue
    const key = `${resolve(root)}::${id}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ root: resolve(root), id })
  }
  return refs
}

/**
 * Load each referenced experiment from its own ledger.
 * @param {Array<{root: string, id: string}>} refs - normalized refs.
 * @returns {Promise<Array<{root: string, experiment: object}>>} the entries.
 */
async function loadCompareEntries(refs) {
  const cache = new Map()
  const entries = []
  for (const ref of refs) {
    if (!cache.has(ref.root)) cache.set(ref.root, await loadLedger(ref.root))
    const experiment = findExperiment(cache.get(ref.root), ref.id)
    if (experiment === undefined) throw new RequestError(404, `experiment not found: ${ref.id} (${ref.root})`)
    entries.push({ root: ref.root, experiment })
  }
  return entries
}

/**
 * Build the side-by-side comparison payload for 2-4 experiments.
 * @param {Array<{root: string, experiment: object}>} entries - loaded experiments.
 * @param {string[]} requestedGroup - requested factor keys.
 * @returns {object} the comparison payload.
 */
function buildMultiCompareFrom(entries, requestedGroup) {
  const experiments = entries.map((entry) => entry.experiment)
  let common = null
  for (const experiment of experiments) {
    const own = new Set((experiment.factors ?? []).map((factor) => factor.key))
    common = common === null ? own : new Set([...common].filter((key) => own.has(key)))
  }
  const groupBy = (Array.isArray(requestedGroup) ? requestedGroup : []).filter((key) => common?.has(key) === true)
  const metricMap = new Map()
  for (const experiment of experiments) {
    for (const metric of experiment.metrics ?? []) {
      if (!metricMap.has(metric.key)) metricMap.set(metric.key, { ...metric })
    }
    for (const run of experiment.runs ?? []) {
      for (const key of Object.keys(run.metrics ?? {})) {
        if (!metricMap.has(key)) metricMap.set(key, { key, label: key, direction: 'none' })
      }
    }
  }
  const results = entries.map(({ root, experiment }) => {
    const comparison = compareRuns(experiment, { groupBy })
    return {
      id: experiment.id,
      root,
      name: experiment.name,
      runCount: Array.isArray(experiment.runs) ? experiment.runs.length : 0,
      groups: comparison.groups,
    }
  })
  const labels = [...new Set(results.flatMap((entry) => entry.groups.map((group) => group.label)))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  return {
    groupBy,
    commonFactors: [...(common ?? [])],
    metrics: [...metricMap.values()],
    labels,
    experiments: results,
  }
}

/**
 * GET /compare/experiments?root=&ids=a,b,c&groupBy= — side-by-side summary of 2-4 experiments.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function compareExperimentsPayload(req) {
  const url = requestUrl(req)
  const rootParam = url.searchParams.get('root')
  const idsParam = url.searchParams.get('ids')
  if (typeof rootParam !== 'string' || rootParam.trim() === '') throw new RequestError(400, 'root is required')
  if (typeof idsParam !== 'string' || idsParam.trim() === '') throw new RequestError(400, 'ids is required')
  const ids = [...new Set(idsParam.split(',').map((value) => value.trim()).filter(Boolean))]
  if (ids.length < 2 || ids.length > 4) throw new RequestError(400, 'pass 2-4 experiment ids')
  const root = resolve(rootParam.trim())
  const ledger = await loadLedger(root)
  const entries = ids.map((id) => {
    const experiment = findExperiment(ledger, id)
    if (experiment === undefined) throw new RequestError(404, `experiment not found: ${id}`)
    return { root, experiment }
  })
  const requestedGroup = (url.searchParams.get('groupBy') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return { ok: true, ...buildMultiCompareFrom(entries, requestedGroup) }
}

/**
 * POST /compare — cross-project comparison from explicit refs.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function compareRefsPayload(req) {
  const body = await readJsonBody(req)
  const refs = normalizeCompareRefs(body.refs)
  if (refs.length < 2 || refs.length > 4) throw new RequestError(400, 'pass 2-4 experiment refs')
  const entries = await loadCompareEntries(refs)
  const groupBy = Array.isArray(body.groupBy) ? body.groupBy.filter((value) => typeof value === 'string') : []
  return { ok: true, ...buildMultiCompareFrom(entries, groupBy) }
}

/**
 * GET /all-experiments — experiment summaries for every remembered root.
 * @returns {Promise<object>} the payload.
 */
async function allExperimentsPayload() {
  const roots = await listRoots()
  const result = []
  for (const entry of roots.slice(0, 20)) {
    try {
      const ledger = await loadLedger(entry.path)
      result.push({
        root: entry.path,
        experiments: ledger.experiments
          .map(summarizeExperiment)
          .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
          .slice(0, 50),
      })
    } catch (error) {
      result.push({ root: entry.path, experiments: [], error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { ok: true, roots: result }
}

/**
 * @param {unknown} value - CSV cell.
 * @returns {string} the escaped cell.
 */
function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * @param {object} payload - multi-compare payload.
 * @param {object} metric - the selected metric.
 * @returns {string} CSV content.
 */
function multiCompareCsv(payload, metric) {
  const header = ['group']
  for (const experiment of payload.experiments) header.push(`${experiment.name} mean`, `${experiment.name} sd`, `${experiment.name} n`)
  const lines = [header.map(csvCell).join(',')]
  for (const label of payload.labels) {
    const row = [label]
    for (const experiment of payload.experiments) {
      const bucket = experiment.groups.find((group) => group.label === label)
      const stat = bucket?.stats?.[metric.key]
      row.push(stat === undefined ? '' : stat.mean, stat === undefined ? '' : stat.sd, stat === undefined ? '' : stat.n)
    }
    lines.push(row.map(csvCell).join(','))
  }
  return `${lines.join('\n')}\n`
}

/**
 * @param {object} payload - multi-compare payload.
 * @param {object} metric - the selected metric.
 * @returns {string} Markdown content.
 */
function multiCompareMarkdown(payload, metric) {
  const label = `${metric.label ?? metric.key}${metric.unit ? ` (${metric.unit})` : ''}`
  const lines = [
    '# Multi-experiment comparison',
    '',
    `- Metric: ${label}`,
    `- Grouping: ${payload.groupBy.length === 0 ? 'all runs' : payload.groupBy.map((key) => `\`${key}\``).join(', ')}`,
    `- Experiments: ${payload.experiments.map((experiment) => `${experiment.name} (${experiment.runCount} runs)`).join(', ')}`,
    '',
    `| Group | ${payload.experiments.map((experiment) => experiment.name).join(' | ')} |`,
    `| --- | ${payload.experiments.map(() => '---').join(' | ')} |`,
  ]
  for (const rowLabel of payload.labels) {
    const cells = [rowLabel]
    for (const experiment of payload.experiments) {
      const bucket = experiment.groups.find((group) => group.label === rowLabel)
      const stat = bucket?.stats?.[metric.key]
      cells.push(stat === undefined || stat.n === 0 ? '—' : `${formatNumber(stat.mean)} ± ${formatNumber(stat.sd)} (n=${stat.n})`)
    }
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * POST /compare/export — write a CSV or Markdown comparison under `<ledger>/exports/`.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the written file.
 */
async function exportComparePayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const refs = normalizeCompareRefs(body.refs)
  const groupBy = Array.isArray(body.groupBy) ? body.groupBy.filter((value) => typeof value === 'string') : []
  let entries
  if (refs.length > 0) {
    if (refs.length < 2 || refs.length > 4) throw new RequestError(400, 'pass 2-4 experiment refs')
    entries = await loadCompareEntries(refs)
  } else {
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((value) => typeof value === 'string' && value !== ''))] : []
    if (ids.length < 2 || ids.length > 4) throw new RequestError(400, 'pass 2-4 experiment ids')
    const ledger = await loadLedger(root)
    entries = ids.map((id) => {
      const experiment = findExperiment(ledger, id)
      if (experiment === undefined) throw new RequestError(404, `experiment not found: ${id}`)
      return { root, experiment }
    })
  }
  const metricKey = bodyString(body, 'metric')
  const format = body.format === 'md' ? 'md' : 'csv'
  const payload = buildMultiCompareFrom(entries, groupBy)
  const metric = payload.metrics.find((entry) => entry.key === metricKey)
  if (metric === undefined) throw new RequestError(400, `metric not found: ${metricKey}`)
  const directory = join(root, 'exports')
  await fsp.mkdir(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safe = metricKey.replace(/[^A-Za-z0-9._-]+/g, '-')
  const file = join(directory, `compare-${safe}-${stamp}.${format}`)
  const content = format === 'md' ? multiCompareMarkdown(payload, metric) : multiCompareCsv(payload, metric)
  await fsp.writeFile(file, content, 'utf8')
  const digest = await hashFile(file)
  return {
    ok: true,
    file: {
      path: file,
      relative: relative(root, file),
      bytes: digest.bytes,
      sha256: digest.sha256,
    },
  }
}

/**
 * List, save, delete or toggle scheduled sweeps on an experiment.
 * @param {object} experiment - target experiment.
 * @param {{action?: string, name?: string, preset?: string, intervalMinutes?: number, enabled?: boolean, scheduleId?: string}} options - operation.
 * @returns {object[]} the resulting schedules.
 */
function applySchedule(experiment, options) {
  if (!Array.isArray(experiment.schedules)) experiment.schedules = []
  const action = typeof options.action === 'string' && options.action !== '' ? options.action : 'list'
  const findIndex = () => experiment.schedules.findIndex((entry) =>
    (typeof options.scheduleId === 'string' && entry.id === options.scheduleId) ||
    (typeof options.name === 'string' && entry.name === options.name))
  if (action === 'list') return experiment.schedules
  if (action === 'delete') {
    const index = findIndex()
    if (index < 0) throw new Error('schedule not found')
    experiment.schedules.splice(index, 1)
    experiment.updatedAt = Date.now()
    return experiment.schedules
  }
  if (action === 'toggle') {
    const index = findIndex()
    if (index < 0) throw new Error('schedule not found')
    const schedule = experiment.schedules[index]
    schedule.enabled = options.enabled !== false
    if (schedule.enabled) {
      schedule.failureCount = 0
      if (typeof schedule.nextRunAt !== 'number') schedule.nextRunAt = Date.now() + schedule.intervalMs
    }
    experiment.updatedAt = Date.now()
    return experiment.schedules
  }
  if (action !== 'save') throw new Error(`unknown schedule action: ${action}`)
  const name = typeof options.name === 'string' ? options.name.trim() : ''
  if (name === '') throw new Error('schedule name is required')
  const preset = typeof options.preset === 'string' ? options.preset.trim() : ''
  if (preset === '') throw new Error('schedule preset is required')
  if (!(experiment.sweepPresets ?? []).some((entry) => entry.name === preset)) {
    throw new Error(`preset not found: ${preset}`)
  }
  const minutes = Number(options.intervalMinutes)
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) {
    throw new Error('intervalMinutes must be between 1 and 10080')
  }
  const intervalMs = Math.round(minutes * 60000)
  const existingIndex = experiment.schedules.findIndex((entry) => entry.name === name)
  const existing = existingIndex >= 0 ? experiment.schedules[existingIndex] : undefined
  const retryLimit = Number(options.retryLimit ?? existing?.retryLimit ?? 0)
  if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 5) {
    throw new Error('retryLimit must be an integer between 0 and 5')
  }
  const retryDelayMs = Number(options.retryDelayMs ?? existing?.retryDelayMs ?? 60000)
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 10000 || retryDelayMs > 3600000) {
    throw new Error('retryDelayMs must be between 10000 and 3600000')
  }
  const failureLimit = Number(options.failureLimit ?? existing?.failureLimit ?? 0)
  if (!Number.isInteger(failureLimit) || failureLimit < 0 || failureLimit > 10) {
    throw new Error('failureLimit must be an integer between 0 and 10')
  }
  const schedule = {
    id: existing?.id ?? `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name,
    preset,
    intervalMs,
    retryLimit,
    retryDelayMs,
    failureLimit,
    failureCount: 0,
    enabled: options.enabled !== false,
    nextRunAt: Date.now() + intervalMs,
    ...(existing?.lastRunAt !== undefined ? { lastRunAt: existing.lastRunAt } : {}),
    ...(existing?.lastStatus !== undefined ? { lastStatus: existing.lastStatus } : {}),
  }
  if (existingIndex >= 0) experiment.schedules[existingIndex] = schedule
  else experiment.schedules.unshift(schedule)
  while (experiment.schedules.length > 10) experiment.schedules.pop()
  experiment.updatedAt = Date.now()
  return experiment.schedules
}

/**
 * Run one schedule now: start its preset as a background sweep job.
 * @param {object} root - ledger directory.
 * @param {object} ledger - loaded ledger.
 * @param {object} experiment - target experiment.
 * @param {object} schedule - schedule record.
 * @returns {object} the job.
 */
function runScheduleNow(root, ledger, experiment, schedule) {
  const preset = (experiment.sweepPresets ?? []).find((entry) => entry.name === schedule.preset)
  if (preset === undefined) throw new Error(`preset not found: ${schedule.preset}`)
  const combos = sweepCombos({ grid: preset.grid, rows: preset.rows })
  if (combos.length === 0) throw new Error('preset grid is empty')
  const job = startSweepJob({
    root,
    ledger,
    experiment,
    combos,
    commandTemplate: preset.command,
    label: `${schedule.name} ${new Date().toISOString().slice(0, 16)}`,
    cwd: dirname(root),
    timeoutMs: preset.timeoutMs,
    maxParallel: preset.maxParallel,
    failFast: preset.failFast,
  })
  schedule.lastRunAt = Date.now()
  schedule.nextRunAt = Date.now() + schedule.intervalMs
  schedule.lastStatus = 'running'
  schedule.lastJobId = job.id
  delete schedule.lastError
  experiment.updatedAt = Date.now()
  return job
}

/**
 * Append a notification to a ledger (last 50 kept).
 * @param {object} ledger - target ledger.
 * @param {{level: string, text: string, experimentId?: string, scheduleId?: string, jobId?: string}} note - notification fields.
 */
function pushNotification(ledger, note) {
  const notifications = Array.isArray(ledger.notifications) ? ledger.notifications : []
  ledger.notifications = [...notifications, {
    id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    createdAt: Date.now(),
    read: false,
    ...note,
  }].slice(-50)
}

/**
 * Move finished scheduled jobs into their schedule history and notify once.
 * @param {object} ledger - loaded ledger.
 * @returns {boolean} whether anything changed.
 */
function finalizeScheduleJobs(ledger) {
  let changed = false
  for (const experiment of ledger.experiments) {
    for (const schedule of Array.isArray(experiment.schedules) ? experiment.schedules : []) {
      if (schedule.lastJobId === undefined || schedule.lastStatus !== 'running') continue
      const job = sweepJobs.get(schedule.lastJobId)
      if (job === undefined) {
        schedule.lastStatus = 'unknown'
        schedule.lastError = 'job record expired'
        changed = true
        continue
      }
      if (job.status === 'running') continue
      const runs = Array.isArray(job.runs) ? job.runs.filter(Boolean) : []
      const failedRuns = runs.filter((run) => run.status !== 'ok').length
        + (Array.isArray(job.errors) ? job.errors.length : 0)
      const success = job.status === 'done' && failedRuns === 0
      const attempt = (schedule.retryCount ?? 0) + 1
      schedule.lastStatus = success ? 'done' : 'failed'
      schedule.lastError = success
        ? undefined
        : job.error ?? (failedRuns > 0 ? `${failedRuns} run(s) failed` : `job ${job.status}`)
      const metricTotals = new Map()
      for (const run of runs) {
        if (run.status !== 'ok') continue
        for (const [key, value] of Object.entries(run.metrics ?? {})) {
          if (typeof value !== 'number' || !Number.isFinite(value)) continue
          const total = metricTotals.get(key) ?? { sum: 0, count: 0 }
          total.sum += value
          total.count += 1
          metricTotals.set(key, total)
        }
      }
      const metricAverages = Object.fromEntries([...metricTotals]
        .map(([key, total]) => [key, Math.round((total.sum / total.count) * 1000) / 1000]))
      schedule.history = [...(Array.isArray(schedule.history) ? schedule.history : []), {
        jobId: job.id,
        attempt,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        durationMs: (job.endedAt ?? Date.now()) - job.startedAt,
        status: success ? 'done' : 'failed',
        done: job.done,
        total: job.total,
        failed: failedRuns,
        metrics: metricAverages,
      }].slice(-20)
      const reason = schedule.lastError ?? 'failed'
      if (success) {
        schedule.retryCount = 0
        schedule.failureCount = 0
        schedule.nextRunAt = Date.now() + (schedule.intervalMs ?? 3600000)
        pushNotification(ledger, {
          level: 'info',
          text: `Scheduled sweep "${schedule.name}" finished: ${job.done}/${job.total} runs.`,
          experimentId: experiment.id,
          scheduleId: schedule.id,
          jobId: job.id,
        })
      } else {
        schedule.failureCount = (schedule.failureCount ?? 0) + 1
        const failureLimit = schedule.failureLimit ?? 0
        if (failureLimit > 0 && schedule.failureCount >= failureLimit) {
          schedule.enabled = false
          pushNotification(ledger, {
            level: 'error',
            text: `Scheduled sweep "${schedule.name}" paused after ${schedule.failureCount} consecutive failures (last: ${reason}).`,
            experimentId: experiment.id,
            scheduleId: schedule.id,
            jobId: job.id,
            action: 'resume-run',
          })
        } else if ((schedule.retryCount ?? 0) < (schedule.retryLimit ?? 0)) {
          schedule.retryCount = (schedule.retryCount ?? 0) + 1
          const delay = (schedule.retryDelayMs ?? 60000) * 2 ** (schedule.retryCount - 1)
          schedule.nextRunAt = Date.now() + delay
          pushNotification(ledger, {
            level: 'error',
            text: `Scheduled sweep "${schedule.name}" failed (${reason}) — retry ${schedule.retryCount}/${schedule.retryLimit} in ${Math.round(delay / 1000)}s.`,
            experimentId: experiment.id,
            scheduleId: schedule.id,
            jobId: job.id,
          })
        } else {
          schedule.nextRunAt = Date.now() + (schedule.intervalMs ?? 3600000)
          pushNotification(ledger, {
            level: 'error',
            text: `Scheduled sweep "${schedule.name}" failed: ${reason}`,
            experimentId: experiment.id,
            scheduleId: schedule.id,
            jobId: job.id,
          })
        }
      }
      changed = true
    }
  }
  return changed
}

/**
 * Check due schedules across remembered roots and start their sweeps.
 * @returns {Promise<void>} resolution after one pass.
 */
async function schedulerTick() {
  const roots = await listRoots()
  for (const entry of roots.slice(0, 20)) {
    let ledger
    try {
      ledger = await loadLedger(entry.path)
    } catch {
      continue
    }
    let changed = finalizeScheduleJobs(ledger)
    for (const experiment of ledger.experiments) {
      for (const schedule of Array.isArray(experiment.schedules) ? experiment.schedules : []) {
        if (schedule.enabled !== true) continue
        if (typeof schedule.nextRunAt === 'number' && schedule.nextRunAt > Date.now()) continue
        if (schedule.lastJobId !== undefined && sweepJobs.get(schedule.lastJobId)?.status === 'running') continue
        try {
          runScheduleNow(entry.path, ledger, experiment, schedule)
        } catch (error) {
          schedule.lastError = error instanceof Error ? error.message : String(error)
          schedule.lastStatus = 'failed'
          schedule.nextRunAt = Date.now() + (schedule.intervalMs ?? 3600000)
          pushNotification(ledger, {
            level: 'error',
            text: `Scheduled sweep "${schedule.name}" could not start: ${schedule.lastError}`,
            experimentId: experiment.id,
            scheduleId: schedule.id,
          })
        }
        changed = true
      }
    }
    if (changed) await saveLedger(entry.path, ledger)
  }
}

/**
 * Start the scheduler interval (30 s); tests pass `scheduler: false`.
 * @param {object} ctx - plugin context.
 */
function registerScheduler(ctx) {
  let ticking = false
  const tick = () => {
    if (ticking) return
    ticking = true
    void schedulerTick()
      .catch((error) => ctx.logger?.warn?.('experiment-ledger: schedule tick failed: %s', String(error)))
      .finally(() => { ticking = false })
  }
  ctx.effect(() => {
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, 'experiment-ledger: schedule ticker')
  tick()
}

/**
 * Write a standalone multi-experiment comparison report.
 * @param {string} root - destination ledger root.
 * @param {Array<{root: string, experiment: object}>} entries - loaded experiments.
 * @param {string[]} groupBy - grouping keys.
 * @returns {Promise<object>} the written report.
 */
async function writeCompareReport(root, entries, groupBy) {
  const payload = buildMultiCompareFrom(entries, groupBy)
  const directory = join(root, 'reports', `compare-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await fsp.mkdir(directory, { recursive: true })
  const metrics = payload.metrics.slice(0, 8)
  const lines = [
    '# Multi-experiment comparison',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Experiments: ${payload.experiments.map((experiment) => `${experiment.name} (${experiment.root}) — ${experiment.runCount} runs`).join('; ')}`,
    `- Grouping: ${payload.groupBy.length === 0 ? 'all runs' : payload.groupBy.map((key) => `\`${key}\``).join(', ')}`,
  ]
  for (const metric of metrics) {
    lines.push('', `## ${metric.label ?? metric.key}${metric.unit ? ` (${metric.unit})` : ''}`, '')
    lines.push(`| Group | ${payload.experiments.map((experiment) => experiment.name).join(' | ')} |`)
    lines.push(`| --- | ${payload.experiments.map(() => '---').join(' | ')} |`)
    for (const label of payload.labels) {
      const cells = [label]
      for (const experiment of payload.experiments) {
        const bucket = experiment.groups.find((group) => group.label === label)
        const stat = bucket?.stats?.[metric.key]
        cells.push(stat === undefined || stat.n === 0 ? '—' : `${formatNumber(stat.mean)} ± ${formatNumber(stat.sd)} (n=${stat.n})`)
      }
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }
  const file = join(directory, 'report.md')
  await fsp.writeFile(file, `${lines.join('\n')}\n`, 'utf8')
  const digest = await hashFile(file)
  return {
    path: file,
    relative: relative(root, file),
    sha256: digest.sha256,
    bytes: digest.bytes,
    summary: { experiments: payload.experiments.length, metrics: metrics.length, groups: payload.labels.length },
  }
}

/**
 * Render a self-contained HTML multi-experiment comparison report.
 * @param {string} root - destination ledger directory.
 * @param {Array<{root: string, experiment: object}>} entries - compared experiments.
 * @param {string[]} groupBy - shared factors to group by.
 * @returns {Promise<object>} written report metadata.
 */
async function writeCompareHtmlReport(root, entries, groupBy) {
  const payload = buildMultiCompareFrom(entries, groupBy)
  const directory = join(root, 'reports', `compare-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await fsp.mkdir(directory, { recursive: true })
  const metrics = payload.metrics.slice(0, 12)
  const escape = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const sections = metrics.map((metric) => {
    const head = payload.experiments.map((experiment) => `<th>${escape(experiment.name)}</th>`).join('')
    const rows = payload.labels.map((label) => {
      const cells = payload.experiments.map((experiment) => {
        const bucket = experiment.groups.find((group) => group.label === label)
        const stat = bucket?.stats?.[metric.key]
        if (stat === undefined || stat.n === 0) return '<td>—</td>'
        const ci = Array.isArray(stat.ci95) ? ` <span class="muted">[${formatNumber(stat.ci95[0])}, ${formatNumber(stat.ci95[1])}]</span>` : ''
        return `<td>${formatNumber(stat.mean)} ± ${formatNumber(stat.sd)}${ci} <span class="muted">(n=${stat.n})</span></td>`
      }).join('')
      return `<tr><td class="strong">${escape(label)}</td>${cells}</tr>`
    }).join('')
    return `<section class="card"><h2>${escape(metric.label ?? metric.key)}${metric.unit ? ` (${escape(metric.unit)})` : ''}</h2><table><thead><tr><th>Group</th>${head}</tr></thead><tbody>${rows}</tbody></table></section>`
  }).join('\n')
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Multi-experiment comparison</title>
<style>
body{margin:0;padding:32px;font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#1f2328;background:#f6f8fa}
main{max-width:1100px;margin:0 auto}h1{margin:0 0 6px;font-size:25px}h2{margin:0 0 12px;font-size:16px}
.muted{color:#6e7781}.strong{font-weight:600}.card{background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:18px;margin:16px 0;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #eaeef2;vertical-align:top}
th{color:#57606a;background:#f6f8fa;font-weight:600}footer{margin-top:24px;color:#6e7781;font-size:12px}
@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}.card{background:#161b22;border-color:#30363d}th{background:#161b22;color:#8b949e}th,td{border-color:#21262d}.muted,footer{color:#8b949e}}
</style></head><body><main>
<h1>Multi-experiment comparison</h1>
<p class="muted">Generated ${escape(new Date().toISOString())} · ${payload.experiments.length} experiments · grouped by ${escape(payload.groupBy.length === 0 ? 'all runs' : payload.groupBy.join(', '))}</p>
<p>${payload.experiments.map((experiment) => `<b>${escape(experiment.name)}</b> <span class="muted">(${escape(experiment.root)} · ${experiment.runCount} runs)</span>`).join(' · ')}</p>
${sections}
<footer>Generated by dsh-experiment-ledger · self-contained HTML (no external assets).</footer>
</main></body></html>`
  const file = join(directory, 'report.html')
  await fsp.writeFile(file, html, 'utf8')
  const digest = await hashFile(file)
  return {
    path: file,
    relative: relative(root, file),
    sha256: digest.sha256,
    bytes: digest.bytes,
    format: 'html',
    summary: { experiments: payload.experiments.length, metrics: metrics.length, groups: payload.labels.length },
  }
}

/**
 * Append a comparison-report record to the destination ledger.
 * @param {object} ledger - destination ledger.
 * @param {object} report - written report.
 * @param {Array<{root: string, experiment: object}>} entries - compared experiments.
 * @returns {object} the archive record.
 */
function archiveCompareReport(ledger, report, entries) {
  const record = {
    id: `crep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    path: report.relative,
    format: report.format ?? 'markdown',
    sha256: report.sha256,
    bytes: report.bytes,
    createdAt: Date.now(),
    refs: entries.map((entry) => ({ root: entry.root, experimentId: entry.experiment.id, name: entry.experiment.name })),
    summary: report.summary,
  }
  ledger.compareReports = [...(Array.isArray(ledger.compareReports) ? ledger.compareReports : []), record].slice(-20)
  return record
}

/**
 * GET /search?root=&q=&status=&experimentId=&limit= — search runs for the panel.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function searchPayload(req) {
  const url = requestUrl(req)
  const rootParam = url.searchParams.get('root')
  if (typeof rootParam !== 'string' || rootParam.trim() === '') throw new RequestError(400, 'root is required')
  const ledger = await loadLedger(resolve(rootParam.trim()))
  const results = searchLedger(ledger, {
    query: url.searchParams.get('q') ?? '',
    status: url.searchParams.get('status') ?? '',
    experimentId: url.searchParams.get('experimentId') ?? '',
    includeArchived: url.searchParams.get('includeArchived') === '1',
    limit: url.searchParams.get('limit') ?? 20,
  })
  return { ok: true, results }
}

/**
 * POST /reproduce — rerun a recorded run from the panel.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function reproducePayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const experimentId = bodyString(body, 'experimentId')
  const runId = bodyString(body, 'runId')
  if (body.confirm !== true) throw new RequestError(400, 'confirm=true is required to reproduce a run')
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, experimentId)
  if (experiment === undefined) throw new RequestError(404, `experiment not found: ${experimentId}`)
  const source = (experiment.runs ?? []).find((run) => run.id === runId)
  if (source === undefined) throw new RequestError(404, `run not found: ${runId}`)
  let run
  try {
    run = await reproduceRun(root, ledger, experiment, source)
  } catch (error) {
    throw new RequestError(400, error instanceof Error ? error.message : String(error))
  }
  return {
    ok: true,
    run: {
      id: run.id,
      status: run.status,
      label: run.label,
      params: run.params,
      metrics: run.metrics,
      durationMs: run.durationMs,
      exitCode: run.exitCode,
      error: run.error,
      stderrTail: run.stderrTail,
      reproducedFrom: run.reproducedFrom,
    },
  }
}

/**
 * POST /update — update experiment metadata (name, description, tags, archived).
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function updateExperimentPayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const experimentId = bodyString(body, 'experimentId')
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, experimentId)
  if (experiment === undefined) throw new RequestError(404, `experiment not found: ${experimentId}`)
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name === '') throw new RequestError(400, 'name must not be empty')
    if (ledger.experiments.some((entry) => entry.id !== experiment.id && entry.name === name)) {
      throw new RequestError(400, `experiment name already exists: ${name}`)
    }
    experiment.name = name
  }
  if (body.description !== undefined) {
    experiment.description = truncate(typeof body.description === 'string' ? body.description : '', 2000)
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) throw new RequestError(400, 'tags must be an array of strings')
    const tags = [...new Set(body.tags.map((tag) => String(tag).trim()).filter((tag) => tag !== ''))]
    if (tags.length > 20) throw new RequestError(400, 'at most 20 tags are allowed')
    if (tags.some((tag) => tag.length > 40)) throw new RequestError(400, 'each tag must be at most 40 characters')
    experiment.tags = tags
  }
  if (body.archived !== undefined) experiment.archived = body.archived === true
  experiment.updatedAt = Date.now()
  await saveLedger(root, ledger)
  await rememberRoot(root)
  return { ok: true, experiment: summarizeExperiment(experiment) }
}

/**
 * POST /conclude — record an experiment conclusion / decision.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function concludeExperimentPayload(req) {
  const body = await readJsonBody(req)
  if (body.text === undefined && body.status === undefined) throw new RequestError(400, 'pass text or status')
  if (body.status !== undefined && !['draft', 'approved', 'rejected'].includes(body.status)) {
    throw new RequestError(400, 'status must be draft, approved or rejected')
  }
  const root = resolve(bodyString(body, 'root'))
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, bodyString(body, 'experimentId'))
  if (experiment === undefined) throw new RequestError(404, 'experiment not found')
  const previous = experiment.conclusion ?? {}
  const text = body.text !== undefined ? truncate(String(body.text), 2000) : (previous.text ?? '')
  const status = body.status ?? previous.status ?? 'draft'
  if ((status === 'approved' || status === 'rejected') && text.trim() === '') {
    throw new RequestError(400, 'approved/rejected conclusions need text')
  }
  const decidedBy = body.decidedBy ?? previous.decidedBy ?? null
  const role = body.role ?? previous.role ?? null
  const at = Date.now()
  const signature = decisionSignature(experiment.id, { status, text, decidedBy, role, at })
  const conclusion = {
    text,
    status,
    decidedBy,
    role,
    decidedAt: status === 'draft' ? null : at,
    updatedAt: at,
    signature,
    history: [
      ...(Array.isArray(previous.history) ? previous.history : []),
      { status, text, note: body.note ?? null, decidedBy: body.decidedBy ?? null, role: body.role ?? null, at, signature },
    ].slice(-50),
  }
  experiment.conclusion = conclusion
  experiment.updatedAt = Date.now()
  await saveLedger(root, ledger)
  await rememberRoot(root)
  return { ok: true, conclusion }
}

/**
 * GET /reviews?root=&status=&reviewer= — pending/reviewed conclusions.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function reviewsPayload(req) {
  const url = requestUrl(req)
  const rootParam = url.searchParams.get('root')
  if (typeof rootParam !== 'string' || rootParam.trim() === '') throw new RequestError(400, 'root is required')
  const root = resolve(rootParam.trim())
  const status = url.searchParams.get('status') ?? 'draft'
  const reviewer = (url.searchParams.get('reviewer') ?? '').toLowerCase()
  const ledger = await loadLedger(root)
  const reviews = ledger.experiments
    .filter((experiment) => {
      const conclusion = experiment.conclusion
      if (conclusion === undefined || conclusion === null) return false
      if (status !== 'all' && (conclusion.status ?? 'draft') !== status) return false
      if (reviewer !== '') {
        const haystack = `${conclusion.decidedBy ?? ''} ${conclusion.role ?? ''}`.toLowerCase()
        if (!haystack.includes(reviewer)) return false
      }
      return true
    })
    .map((experiment) => ({
      id: experiment.id,
      name: experiment.name,
      runs: experiment.runs?.length ?? 0,
      conclusion: experiment.conclusion,
    }))
  return { ok: true, status, reviews }
}

/**
 * POST /review — batch approve/reject conclusions.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function reviewPayload(req) {
  const body = await readJsonBody(req)
  const ids = Array.isArray(body.experimentIds) ? body.experimentIds.filter((id) => typeof id === 'string') : []
  if (ids.length === 0 || ids.length > 20) throw new RequestError(400, 'experimentIds must contain 1-20 ids')
  if (!['approved', 'rejected'].includes(body.status)) throw new RequestError(400, 'status must be approved or rejected')
  const root = resolve(bodyString(body, 'root'))
  const ledger = await loadLedger(root)
  const done = []
  const skipped = []
  for (const id of ids) {
    const experiment = findExperiment(ledger, id)
    if (experiment === undefined) {
      skipped.push({ id, reason: 'not found' })
      continue
    }
    const conclusion = experiment.conclusion
    if (conclusion === undefined || conclusion === null || typeof conclusion.text !== 'string' || conclusion.text.trim() === '') {
      skipped.push({ id, reason: 'no conclusion text' })
      continue
    }
    const history = Array.isArray(conclusion.history) ? conclusion.history : []
    const decidedBy = body.decidedBy ?? conclusion.decidedBy ?? null
    const role = body.role ?? conclusion.role ?? null
    const at = Date.now()
    const signature = decisionSignature(id, { status: body.status, text: conclusion.text, decidedBy, role, at })
    experiment.conclusion = {
      ...conclusion,
      status: body.status,
      decidedBy,
      role,
      decidedAt: at,
      updatedAt: at,
      signature,
      history: [...history, {
        status: body.status,
        text: conclusion.text,
        note: body.note ?? null,
        decidedBy: body.decidedBy ?? null,
        role: body.role ?? null,
        at,
        signature,
      }].slice(-50),
    }
    experiment.updatedAt = Date.now()
    done.push(id)
  }
  if (done.length > 0) {
    await saveLedger(root, ledger)
    await rememberRoot(root)
  }
  return { ok: true, status: body.status, done, skipped }
}

/**
 * POST /clone — clone an experiment as a template (factors/metrics, no runs).
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function cloneExperimentPayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const ledger = await loadLedger(root)
  const source = findExperiment(ledger, bodyString(body, 'experimentId'))
  if (source === undefined) throw new RequestError(404, 'experiment not found')
  const requested = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : `${source.name} (clone)`
  if (ledger.experiments.some((experiment) => experiment.name === requested)) {
    throw new RequestError(400, `experiment name already exists: ${requested}`)
  }
  const clone = {
    id: newId('exp'),
    name: requested,
    description: source.description ?? '',
    factors: JSON.parse(JSON.stringify(source.factors ?? [])),
    metrics: JSON.parse(JSON.stringify(source.metrics ?? [])),
    tags: JSON.parse(JSON.stringify(source.tags ?? [])),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    runs: [],
    reports: [],
  }
  ledger.experiments.push(clone)
  await saveLedger(root, ledger)
  await rememberRoot(root)
  return { ok: true, experiment: summarizeExperiment(clone) }
}

/**
 * POST /run/update — update one run's label or notes.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function updateRunPayload(req) {
  const body = await readJsonBody(req)
  if (body.label === undefined && body.notes === undefined) throw new RequestError(400, 'pass label or notes')
  const root = resolve(bodyString(body, 'root'))
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, bodyString(body, 'experimentId'))
  if (experiment === undefined) throw new RequestError(404, 'experiment not found')
  const run = (experiment.runs ?? []).find((entry) => entry.id === bodyString(body, 'runId'))
  if (run === undefined) throw new RequestError(404, 'run not found')
  if (body.label !== undefined) run.label = truncate(typeof body.label === 'string' ? body.label : '', 200)
  if (body.notes !== undefined) run.notes = truncate(typeof body.notes === 'string' ? body.notes : '', 2000)
  experiment.updatedAt = Date.now()
  await saveLedger(root, ledger)
  await rememberRoot(root)
  return { ok: true, run: { id: run.id, label: run.label, notes: run.notes } }
}

/**
 * POST /run/delete — delete one run record (confirm=true required).
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function deleteRunPayload(req) {
  const body = await readJsonBody(req)
  if (body.confirm !== true) throw new RequestError(400, 'confirm=true is required to delete a run')
  const root = resolve(bodyString(body, 'root'))
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, bodyString(body, 'experimentId'))
  if (experiment === undefined) throw new RequestError(404, 'experiment not found')
  const index = (experiment.runs ?? []).findIndex((entry) => entry.id === bodyString(body, 'runId'))
  if (index < 0) throw new RequestError(404, 'run not found')
  experiment.runs.splice(index, 1)
  experiment.updatedAt = Date.now()
  await saveLedger(root, ledger)
  await rememberRoot(root)
  return { ok: true, runs: experiment.runs.length }
}

/**
 * POST /export — write a portable ledger bundle.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function exportLedgerPayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const ledger = await loadLedger(root)
  const zip = body.format === 'zip'
  const bundle = zip
    ? await exportLedgerPackage(root, ledger, {
      path: typeof body.path === 'string' ? body.path : undefined,
      cwd: process.cwd(),
      experimentId: typeof body.experimentId === 'string' ? body.experimentId : undefined,
      sign: body.sign !== false,
      signer: typeof body.signer === 'string' ? body.signer : undefined,
    })
    : await exportLedgerBundle(root, ledger, {
      path: typeof body.path === 'string' ? body.path : undefined,
      cwd: process.cwd(),
      experimentId: typeof body.experimentId === 'string' ? body.experimentId : undefined,
    })
  await rememberRoot(root)
  appendAudit({
    action: 'package.export',
    actor: bundle.signature?.signer ?? null,
    detail: { path: bundle.path, format: zip ? 'zip' : 'json', keyId: bundle.signature?.keyId ?? null },
  })
  return {
    ok: true,
    bundle: {
      path: bundle.path,
      relative: bundle.relative,
      format: zip ? 'zip' : 'json',
      signature: bundle.signature ?? null,
      bytes: bundle.bytes,
      sha256: bundle.sha256,
      counts: bundle.counts,
    },
  }
}

/**
 * POST /import — merge a bundle into a ledger.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function importLedgerPayload(req) {
  const body = await readJsonBody(req, 32 * 1024 * 1024)
  let file = null
  let uploaded = null
  if (typeof body.path === 'string' && body.path.trim() !== '') {
    file = resolve(body.path.trim())
    if (!existsSync(file)) throw new RequestError(404, `bundle not found: ${file}`)
  } else if (typeof body.data === 'string' && body.data !== '') {
    let bytes
    try {
      bytes = Buffer.from(body.data, 'base64')
    } catch {
      throw new RequestError(400, 'uploaded bundle data is not valid base64')
    }
    if (bytes.length > 20 * 1024 * 1024) throw new RequestError(413, 'uploaded bundle is larger than 20 MB')
    const extension = typeof body.filename === 'string' && /\.zip$/i.test(body.filename) ? 'zip' : 'json'
    uploaded = join(tmpdir(), `ledger-upload-${randomBytes(8).toString('hex')}.${extension}`)
    await fsp.writeFile(uploaded, bytes)
    file = uploaded
  } else {
    throw new RequestError(400, 'pass a bundle path or uploaded file data')
  }
  try {
    let parsed
    try {
      parsed = await readLedgerBundleFile(file)
    } catch (error) {
      throw new RequestError(400, error instanceof Error ? error.message : String(error))
    }
    const { bundle, kind, verified, packageDatasets, signature, auditMirror } = parsed
    if (body.requireTrusted === true) {
      if (signature === null) throw new RequestError(400, 'package is unsigned; requireTrusted needs a signed zip')
      if (!signature.trusted) throw new RequestError(400, `package signing key is not trusted: ${signature.keyId}`)
    }
    const root = resolve(bodyString(body, 'root'))
    const ledger = await loadLedger(root)
    const prefer = body.prefer === 'incoming' ? 'incoming' : 'local'
    const dryRun = body.dryRun === true
    let datasetsRestored = 0
    if (!dryRun && packageDatasets.length > 0) {
      datasetsRestored = (await restorePackageDatasets(root, ledger, bundle, packageDatasets)).restored
    }
    const target = dryRun ? JSON.parse(JSON.stringify(ledger)) : ledger
    const summary = mergeLedgerBundle(target, bundle, prefer)
    if (!dryRun) {
      await saveLedger(root, ledger)
      await rememberRoot(root)
      appendAudit({
        action: 'package.import',
        actor: signature?.signer ?? null,
        detail: { path: file, kind, keyId: signature?.keyId ?? null, trust: signature?.trusted ? signature.trustReason : 'untrusted' },
      })
    }
    return { ok: true, dryRun, path: file, kind, verified, signature, auditMirror, datasetsRestored, prefer, summary }
  } finally {
    if (uploaded !== null) await fsp.unlink(uploaded).catch(() => {})
  }
}

/**
 * Find the ledger directory for a project folder or a ledger folder.
 * @param {string} input - folder path.
 * @returns {string|null} ledger directory.
 */
function findLedgerDir(input) {
  if (existsSync(join(input, 'ledger.json'))) return input
  const nested = join(input, '.experiments')
  if (existsSync(join(nested, 'ledger.json'))) return nested
  return null
}

/**
 * POST /roots — remember and open a ledger/project folder.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the opened root.
 */
async function openRootPayload(req) {
  const body = await readJsonBody(req)
  const input = bodyString(body, 'path')
  const directory = resolve(input)
  let stat
  try {
    stat = await fsp.stat(directory)
  } catch {
    throw new RequestError(404, `folder not found: ${directory}`)
  }
  if (!stat.isDirectory()) throw new RequestError(400, `not a folder: ${directory}`)
  let root = findLedgerDir(directory)
  let created = false
  if (root === null && body.create === true) {
    root = join(directory, '.experiments')
    await fsp.mkdir(root, { recursive: true })
    if (!existsSync(join(root, 'ledger.json'))) await saveLedger(root, { version: 1, experiments: [] })
    created = true
  }
  if (root === null) throw new RequestError(404, 'no ledger here; enable create to start one in this folder')
  await rememberRoot(root)
  return { ok: true, root, created, roots: await listRoots() }
}

/**
 * POST /experiment/delete — remove one experiment from the ledger, keeping its
 * runs and files on disk.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the deletion result.
 */
async function deleteExperimentPayload(req) {
  const body = await readJsonBody(req)
  if (body.confirm !== true) throw new RequestError(400, 'pass confirm=true to delete an experiment')
  const root = resolve(bodyString(body, 'root'))
  const id = bodyString(body, 'experimentId')
  const ledger = await loadLedger(root)
  const experiment = findExperiment(ledger, id)
  if (experiment === undefined) throw new RequestError(404, 'experiment not found')
  const runsKept = Array.isArray(experiment.runs) ? experiment.runs.length : 0
  ledger.experiments = ledger.experiments.filter((entry) => entry.id !== id)
  await saveLedger(root, ledger)
  await rememberRoot(root)
  appendAudit({ action: 'experiment.delete', actor: null, detail: { experimentId: id, runsKept, filesKept: true } })
  return { ok: true, deleted: id, runsKept, filesKept: true }
}

/**
 * GET /browse?dir= — list subfolders for the open-folder picker.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the listing.
 */
async function browsePayload(req) {
  const url = requestUrl(req)
  const requested = url.searchParams.get('dir')
  const dir = resolve(typeof requested === 'string' && requested.trim() !== '' ? requested.trim() : process.cwd())
  let stat
  try {
    stat = await fsp.stat(dir)
  } catch {
    throw new RequestError(404, `folder not found: ${dir}`)
  }
  if (!stat.isDirectory()) throw new RequestError(400, `not a folder: ${dir}`)
  const entries = []
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (entries.length >= 200) break
    if (!entry.isDirectory()) continue
    const path = join(dir, entry.name)
    entries.push({
      name: entry.name,
      path,
      ledger: findLedgerDir(path) !== null,
      hidden: entry.name.startsWith('.'),
    })
  }
  entries.sort((left, right) => (left.hidden ? 1 : 0) - (right.hidden ? 1 : 0) || left.name.localeCompare(right.name))
  const parent = dirname(dir)
  return { ok: true, dir, parent: parent === dir ? null : parent, entries }
}

/**
 * GET /panel-request — last agent request to open the panel.
 * @returns {object} the request, if any.
 */
function panelRequestPayload() {
  const request = panelOpenRequest
  panelOpenRequest = null
  return { ok: true, request }
}


/**
 * GET /notifications?root= — recent notifications (newest first).
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function notificationsPayload(req) {
  const rootParam = requestUrl(req).searchParams.get('root')
  if (typeof rootParam !== 'string' || rootParam.trim() === '') throw new RequestError(400, 'root is required')
  const root = resolve(rootParam.trim())
  const ledger = await loadLedger(root)
  if (finalizeScheduleJobs(ledger)) await saveLedger(root, ledger)
  const notifications = Array.isArray(ledger.notifications) ? [...ledger.notifications].reverse() : []
  return { ok: true, notifications, unread: notifications.filter((note) => note.read !== true).length }
}

/**
 * GET /notifications/all — notifications across every remembered root.
 * @returns {Promise<object>} the payload with root-tagged items.
 */
async function allNotificationsPayload() {
  const roots = await listRoots()
  const items = []
  for (const entry of roots.slice(0, 20)) {
    let ledger
    try {
      ledger = await loadLedger(entry.path)
    } catch {
      continue
    }
    if (finalizeScheduleJobs(ledger)) await saveLedger(entry.path, ledger)
    for (const note of Array.isArray(ledger.notifications) ? ledger.notifications : []) {
      items.push({ ...note, root: entry.path })
    }
  }
  items.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
  const notifications = items.slice(0, 100)
  return {
    ok: true,
    notifications,
    unread: notifications.filter((note) => note.read !== true).length,
  }
}

/**
 * POST /notifications/read — mark all (or selected) notifications as read.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function readNotificationsPayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const ids = Array.isArray(body.ids)
    ? new Set(body.ids.filter((value) => typeof value === 'string'))
    : null
  const ledger = await loadLedger(root)
  let changed = finalizeScheduleJobs(ledger)
  const notifications = Array.isArray(ledger.notifications) ? ledger.notifications : []
  for (const note of notifications) {
    if (note.read === true) continue
    if (ids !== null && !ids.has(note.id)) continue
    note.read = true
    changed = true
  }
  if (changed) await saveLedger(root, ledger)
  const list = [...notifications].reverse()
  return { ok: true, notifications: list, unread: list.filter((note) => note.read !== true).length }
}

/**
 * POST /compare/report — write a multi-experiment comparison report.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function compareReportPayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const refs = normalizeCompareRefs(body.refs)
  if (refs.length < 2 || refs.length > 4) throw new RequestError(400, 'pass 2-4 experiment refs')
  const entries = await loadCompareEntries(refs)
  const groupBy = Array.isArray(body.groupBy) ? body.groupBy.filter((value) => typeof value === 'string') : []
  const report = body.format === 'html'
    ? await writeCompareHtmlReport(root, entries, groupBy)
    : await writeCompareReport(root, entries, groupBy)
  const ledger = await loadLedger(root)
  archiveCompareReport(ledger, report, entries)
  await saveLedger(root, ledger)
  await rememberRoot(root)
  return { ok: true, report }
}

/**
 * GET /compare/reports?root= — archived comparison reports for one ledger.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function compareReportsPayload(req) {
  const rootParam = requestUrl(req).searchParams.get('root')
  if (typeof rootParam !== 'string' || rootParam.trim() === '') throw new RequestError(400, 'root is required')
  const ledger = await loadLedger(resolve(rootParam.trim()))
  const reports = Array.isArray(ledger.compareReports) ? [...ledger.compareReports].reverse() : []
  return { ok: true, reports }
}

/**
 * POST /compare/report/open — open a comparison report in the OS.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function openCompareReportPayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const reportsRoot = resolve(root, 'reports')
  const file = resolve(root, bodyString(body, 'path'))
  if (!file.startsWith(`${reportsRoot}${sep}`)) throw new RequestError(400, 'report path is outside the ledger reports directory')
  if (!existsSync(file)) throw new RequestError(404, `report file is missing: ${file}`)
  if (process.env.DSH_EXPERIMENT_LEDGER_NO_OPEN === '1') return { ok: true, opened: file, skipped: true }
  try {
    openLocalFile(file)
  } catch (error) {
    throw new RequestError(500, `could not open the report: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { ok: true, opened: file }
}

/**
 * POST /compare/open — open an exported comparison file in the OS.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @returns {Promise<object>} the payload.
 */
async function openExportPayload(req) {
  const body = await readJsonBody(req)
  const root = resolve(bodyString(body, 'root'))
  const exportsRoot = resolve(root, 'exports')
  const file = resolve(root, bodyString(body, 'path'))
  if (!file.startsWith(`${exportsRoot}${sep}`)) throw new RequestError(400, 'export path is outside the ledger exports directory')
  if (!existsSync(file)) throw new RequestError(404, `export file is missing: ${file}`)
  if (process.env.DSH_EXPERIMENT_LEDGER_NO_OPEN === '1') return { ok: true, opened: file, skipped: true }
  try {
    openLocalFile(file)
  } catch (error) {
    throw new RequestError(500, `could not open the export: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { ok: true, opened: file }
}

/**
 * Register the panel routes: read-only list/detail plus candidates, promote and report.
 * @param {object} ctx - plugin context.
 */
function registerRoutes(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/list`,
    handler: serve(ctx, 'GET', (req) => listPayload(ctx, req)),
  }), 'experiment-ledger: list route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/experiment`,
    handler: serve(ctx, 'GET', (req) => experimentPayload(ctx, req)),
  }), 'experiment-ledger: experiment route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/update`,
    handler: serve(ctx, 'POST', (req) => updateExperimentPayload(req)),
  }), 'experiment-ledger: update route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/clone`,
    handler: serve(ctx, 'POST', (req) => cloneExperimentPayload(req)),
  }), 'experiment-ledger: clone route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/conclude`,
    handler: serve(ctx, 'POST', (req) => concludeExperimentPayload(req)),
  }), 'experiment-ledger: conclude route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/reviews`,
    handler: serve(ctx, 'GET', (req) => reviewsPayload(req)),
  }), 'experiment-ledger: reviews route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/review`,
    handler: serve(ctx, 'POST', (req) => reviewPayload(req)),
  }), 'experiment-ledger: review route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/run/update`,
    handler: serve(ctx, 'POST', (req) => updateRunPayload(req)),
  }), 'experiment-ledger: run update route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/run/delete`,
    handler: serve(ctx, 'POST', (req) => deleteRunPayload(req)),
  }), 'experiment-ledger: run delete route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/candidates`,
    handler: serve(ctx, 'GET', () => candidatesPayload()),
  }), 'experiment-ledger: candidates route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/promote`,
    handler: serve(ctx, 'POST', (req) => promotePayload(req)),
  }), 'experiment-ledger: promote route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/report`,
    handler: serve(ctx, 'POST', (req) => reportPayload(req)),
  }), 'experiment-ledger: report route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/export`,
    handler: serve(ctx, 'POST', (req) => exportLedgerPayload(req)),
  }), 'experiment-ledger: export route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/roots`,
    handler: serve(ctx, 'POST', (req) => openRootPayload(req)),
  }), 'experiment-ledger: roots route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/experiment/delete`,
    handler: serve(ctx, 'POST', (req) => deleteExperimentPayload(req)),
  }), 'experiment-ledger: experiment delete route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/browse`,
    handler: serve(ctx, 'GET', (req) => browsePayload(req)),
  }), 'experiment-ledger: browse route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/panel-request`,
    handler: serve(ctx, 'GET', () => panelRequestPayload()),
  }), 'experiment-ledger: panel request route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/import`,
    handler: serve(ctx, 'POST', (req) => importLedgerPayload(req)),
  }), 'experiment-ledger: import route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/report/open`,
    handler: serve(ctx, 'POST', (req) => openReportPayload(req)),
  }), 'experiment-ledger: report open route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/baseline`,
    handler: serve(ctx, 'POST', (req) => baselinePayload(req)),
  }), 'experiment-ledger: baseline route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/baseline/options`,
    handler: serve(ctx, 'GET', (req) => baselineOptionsPayload(req)),
  }), 'experiment-ledger: baseline options route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/preset`,
    handler: serve(ctx, 'POST', (req) => presetPayload(req)),
  }), 'experiment-ledger: preset route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/schedule`,
    handler: serve(ctx, 'POST', (req) => schedulePayload(req)),
  }), 'experiment-ledger: schedule route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/schedule/reports`,
    handler: serve(ctx, 'GET', (req) => scheduleReportsPayload(req)),
  }), 'experiment-ledger: schedule reports route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/search`,
    handler: serve(ctx, 'GET', (req) => searchPayload(req)),
  }), 'experiment-ledger: search route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/reproduce`,
    handler: serve(ctx, 'POST', (req) => reproducePayload(req)),
  }), 'experiment-ledger: reproduce route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/notifications`,
    handler: serve(ctx, 'GET', (req) => notificationsPayload(req)),
  }), 'experiment-ledger: notifications route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/notifications/all`,
    handler: serve(ctx, 'GET', () => allNotificationsPayload()),
  }), 'experiment-ledger: all notifications route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/notifications/read`,
    handler: serve(ctx, 'POST', (req) => readNotificationsPayload(req)),
  }), 'experiment-ledger: notifications read route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/compare/experiments`,
    handler: serve(ctx, 'GET', (req) => compareExperimentsPayload(req)),
  }), 'experiment-ledger: compare experiments route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/all-experiments`,
    handler: serve(ctx, 'GET', () => allExperimentsPayload()),
  }), 'experiment-ledger: all experiments route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/compare`,
    handler: serve(ctx, 'POST', (req) => compareRefsPayload(req)),
  }), 'experiment-ledger: compare refs route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/compare/report`,
    handler: serve(ctx, 'POST', (req) => compareReportPayload(req)),
  }), 'experiment-ledger: compare report route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/compare/reports`,
    handler: serve(ctx, 'GET', (req) => compareReportsPayload(req)),
  }), 'experiment-ledger: compare reports route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/compare/report/open`,
    handler: serve(ctx, 'POST', (req) => openCompareReportPayload(req)),
  }), 'experiment-ledger: compare report open route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/compare/export`,
    handler: serve(ctx, 'POST', (req) => exportComparePayload(req)),
  }), 'experiment-ledger: compare export route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/compare/open`,
    handler: serve(ctx, 'POST', (req) => openExportPayload(req)),
  }), 'experiment-ledger: compare open route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/sweep`,
    handler: serve(ctx, 'POST', (req) => startSweepPayload(req)),
  }), 'experiment-ledger: sweep start route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/sweep/status`,
    handler: serve(ctx, 'GET', (req) => sweepStatusPayload(req)),
  }), 'experiment-ledger: sweep status route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/sweep/stop`,
    handler: serve(ctx, 'POST', (req) => stopSweepPayload(req)),
  }), 'experiment-ledger: sweep stop route')
}

/**
 * Plugin entry: tools first, then the panel routes and the passive recorder.
 * @param {object} ctx - plugin context.
 * @param {{recorder?: boolean}} [config] - row config; `recorder: false` disables capture.
 */
export function apply(ctx, config = {}) {
  registerTools(ctx)
  registerRoutes(ctx)
  if (config === null || typeof config !== 'object' || config.recorder !== false) registerRecorder(ctx)
  if (config === null || typeof config !== 'object' || config.scheduler !== false) registerScheduler(ctx)
}
