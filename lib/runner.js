/**
 * Command execution for one experiment run.
 *
 * A run is a black box: this module starts a shell command, keeps its output
 * in the run directory, and reports the exit facts. Metric parsing and ledger
 * bookkeeping live outside, so this stays a small, testable primitive.
 *
 * @module dsh-experiment-ledger/runner
 */
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream, promises as fsp } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** How much of each stream is kept inline in the ledger record. */
const TAIL_BYTES = 16 * 1024

/**
 * Keep the last `limit` bytes of a stream.
 * @param {string} current - accumulated tail.
 * @param {Buffer} chunk - new data.
 * @param {number} limit - maximum bytes.
 * @returns {string} the updated tail.
 */
function appendTail(current, chunk, limit) {
  const merged = current + chunk.toString('utf8')
  if (merged.length <= limit) return merged
  return merged.slice(merged.length - limit)
}

/**
 * Kill a process and its children. Windows needs `taskkill /T`, POSIX uses the
 * process group created by `detached`.
 * @param {import('node:child_process').ChildProcess} child - the shell process.
 */
function killTree(child) {
  if (child === null || child === undefined || typeof child.pid !== 'number') return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

/**
 * Await one stream's finish, ignoring errors raised after close.
 * @param {import('node:fs').WriteStream} stream - output file stream.
 * @returns {Promise<void>} resolution when the stream is done.
 */
function finished(stream) {
  return new Promise((resolve) => {
    stream.once('close', () => resolve())
    stream.once('error', () => resolve())
  })
}

/**
 * Execute one command and capture its facts.
 * @param {{command: string, cwd: string, env?: Record<string, string>, timeoutMs?: number, runDir: string}} options - execution options.
 * @returns {Promise<{status: string, exitCode: number | null, signal: string | null, durationMs: number, stdoutPath: string, stderrPath: string, stdoutTail: string, stderrTail: string, error?: string}>} the result.
 */
export async function runCommand(options) {
  const { command, cwd, timeoutMs = 30 * 60 * 1000, runDir } = options
  await fsp.mkdir(runDir, { recursive: true })
  const stdoutPath = join(runDir, 'stdout.log')
  const stderrPath = join(runDir, 'stderr.log')
  const stdout = createWriteStream(stdoutPath, { flags: 'w' })
  const stderr = createWriteStream(stderrPath, { flags: 'w' })
  const startedAt = Date.now()

  return await new Promise((resolve) => {
    let child
    try {
      child = spawn(command, {
        shell: true,
        cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        windowsHide: true,
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      stdout.end()
      stderr.end()
      void finished(stdout)
      void finished(stderr)
      resolve({
        status: 'error',
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        stdoutPath,
        stderrPath,
        stdoutTail: '',
        stderrTail: '',
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    let tailOut = ''
    let tailErr = ''
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, Math.max(1000, timeoutMs))
    if (typeof timer.unref === 'function') timer.unref()

    child.stdout?.on('data', (chunk) => {
      stdout.write(chunk)
      tailOut = appendTail(tailOut, chunk, TAIL_BYTES)
    })
    child.stderr?.on('data', (chunk) => {
      stderr.write(chunk)
      tailErr = appendTail(tailErr, chunk, TAIL_BYTES)
    })

    const settle = async (extra) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdout.end()
      stderr.end()
      await Promise.all([finished(stdout), finished(stderr)])
      resolve({
        durationMs: Date.now() - startedAt,
        stdoutPath,
        stderrPath,
        stdoutTail: tailOut,
        stderrTail: tailErr,
        ...extra,
      })
    }

    child.once('error', (error) => {
      void settle({
        status: 'error',
        exitCode: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    child.once('close', (code, signal) => {
      const status = timedOut ? 'timeout' : code === 0 ? 'ok' : 'failed'
      void settle({ status, exitCode: code, signal: signal ?? null })
    })
  })
}

/**
 * Hash one file without loading it into memory.
 * @param {string} path - file path.
 * @returns {Promise<{sha256: string, bytes: number}>} digest and size.
 */
export async function hashFile(path) {
  const stat = await fsp.stat(path)
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path)
    stream.once('error', reject)
    hash.once('finish', resolve)
    stream.pipe(hash)
  })
  return { sha256: hash.digest('hex'), bytes: stat.size }
}
