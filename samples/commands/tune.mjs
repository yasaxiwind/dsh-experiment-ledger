// Tiny deterministic "tuning" job for exp_run.
// Usage: node samples/commands/tune.mjs --kp 1.5 --ki 0.3
const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '')
  args[key] = Number(process.argv[i + 1])
}
const kp = Number.isFinite(args.kp) ? args.kp : 1.5
const ki = Number.isFinite(args.ki) ? args.ki : 0.3
const noise = Math.sin(kp * 12.9898 + ki * 78.233) * 0.4
const overshoot = Math.max(0, 18 - 5 * kp + 6 * ki + noise)
const settling = Math.max(0.4, 3.2 - 0.8 * kp + 0.5 * ki + noise / 4)
const squareError = Math.max(0.01, 1.1 - 0.25 * kp + 0.03 * ki)
console.log(`kp=${kp} ki=${ki}`)
console.log(`EXP_METRICS: ${JSON.stringify({
  overshoot: Number(overshoot.toFixed(3)),
  settling: Number(settling.toFixed(3)),
  square_error: Number(squareError.toFixed(4)),
})}`)
