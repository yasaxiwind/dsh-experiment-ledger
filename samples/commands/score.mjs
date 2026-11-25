// Reads a CSV and prints summary metrics, for exp_run.
// Usage: node samples/commands/score.mjs samples/datasets/latency.csv
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node score.mjs <csv>')
  process.exit(2)
}
const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/)
const header = lines[0].split(',')
const p50 = header.indexOf('p50_ms')
const errors = header.indexOf('errors')
const rows = lines.slice(1).map((line) => line.split(','))
const values = rows.map((row) => Number(row[p50])).filter(Number.isFinite)
const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
const totalErrors = rows.reduce((sum, row) => sum + Number(row[errors] || 0), 0)
console.log(`rows=${rows.length}`)
console.log(`EXP_METRICS: ${JSON.stringify({
  mean_p50_ms: Number(mean.toFixed(2)),
  errors: totalErrors,
})}`)
