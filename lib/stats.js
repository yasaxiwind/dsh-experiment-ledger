/**
 * Small-sample statistics for experiment comparisons: mean, sample standard
 * deviation, standard error, 95% confidence intervals, Welch's t-test and
 * Cohen's d. Kept dependency-free so the tool, report and panel agree.
 *
 * @module dsh-experiment-ledger/stats
 */

/**
 * @param {number[]} values - finite numbers.
 * @returns {number} arithmetic mean.
 */
export function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * @param {number[]} values - finite numbers.
 * @returns {number} sample standard deviation (n-1), 0 for one value.
 */
export function sampleSd(values) {
  if (values.length < 2) return 0
  const center = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1))
}

/** Two-sided 95% t critical values for small df; the rest use a normal approximation. */
const T95 = [
  0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
  2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093,
  2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
]

/**
 * @param {number} df - degrees of freedom.
 * @returns {number} two-sided 95% critical value.
 */
export function tCritical95(df) {
  if (!Number.isFinite(df) || df <= 0) return 1.96
  const integer = Math.floor(df)
  if (integer <= 30) return T95[integer] ?? 2.042
  return 1.96 + 2.4 / df
}

/**
 * @param {number[]} values - finite numbers.
 * @returns {{n: number, mean: number, sd: number, se: number, low: number, high: number}|null} interval.
 */
export function confidenceInterval95(values) {
  if (values.length < 2) return null
  const center = mean(values)
  const sd = sampleSd(values)
  const se = sd / Math.sqrt(values.length)
  const critical = tCritical95(values.length - 1)
  return {
    n: values.length,
    mean: center,
    sd,
    se,
    low: center - critical * se,
    high: center + critical * se,
  }
}

/** Continued fraction for the regularized incomplete beta (Numerical Recipes). */
function betaContinuedFraction(a, b, x) {
  const maxIterations = 200
  const epsilon = 3e-12
  const tiny = 1e-30
  let qab = a + b
  let qap = a + 1
  let qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < epsilon) break
  }
  return h
}

/** Regularized incomplete beta I_x(a,b). */
function incompleteBeta(a, b, x) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const logBeta = logGamma(a) + logGamma(b) - logGamma(a + b)
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - logBeta)
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b
}

/** Lanczos approximation of log gamma. */
function logGamma(value) {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ]
  let x = value
  let y = value
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (const coefficient of coefficients) {
    y += 1
    ser += coefficient / y
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

/**
 * Two-sided p-value for a t statistic.
 * @param {number} t - t statistic.
 * @param {number} df - degrees of freedom.
 * @returns {number} p in [0,1].
 */
export function tTestPValue(t, df) {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return 1
  const x = df / (df + t * t)
  return Math.min(1, Math.max(0, incompleteBeta(df / 2, 0.5, x)))
}

/**
 * Welch's t-test plus effect size and CI of the difference.
 * @param {number[]} a - first sample.
 * @param {number[]} b - second sample.
 * @returns {object|null} test result, or null with fewer than two values per side.
 */
export function welchTest(a, b) {
  if (a.length < 2 || b.length < 2) return null
  const meanA = mean(a)
  const meanB = mean(b)
  const varA = sampleSd(a) ** 2
  const varB = sampleSd(b) ** 2
  const seA = varA / a.length
  const seB = varB / b.length
  const se = Math.sqrt(seA + seB)
  if (!Number.isFinite(se) || se === 0) {
    return {
      meanA, meanB, difference: meanA - meanB, t: 0, df: a.length + b.length - 2, p: 1,
      cohenD: null, ci95: [meanA - meanB, meanA - meanB], zeroVariance: true, nA: a.length, nB: b.length,
    }
  }
  const difference = meanA - meanB
  const t = difference / se
  const df = (seA + seB) ** 2 / ((seA ** 2) / (a.length - 1) + (seB ** 2) / (b.length - 1))
  const p = tTestPValue(t, df)
  const pooled = Math.sqrt(((a.length - 1) * varA + (b.length - 1) * varB) / (a.length + b.length - 2))
  const cohenD = pooled === 0 ? null : difference / pooled
  const critical = tCritical95(df)
  return {
    meanA,
    meanB,
    difference,
    t,
    df,
    p,
    cohenD,
    ci95: [difference - critical * se, difference + critical * se],
    nA: a.length,
    nB: b.length,
  }
}

/**
 * Welch's t-test from precomputed summaries (mean/sd/n).
 * @param {{n: number, mean: number|null, sd: number|null}} a - first summary.
 * @param {{n: number, mean: number|null, sd: number|null}} b - second summary.
 * @returns {object|null} test result, or null when a side has fewer than two values.
 */
export function welchFromStats(a, b) {
  if (!a || !b || a.n < 2 || b.n < 2) return null
  if (!Number.isFinite(a.mean) || !Number.isFinite(b.mean)) return null
  const varA = (a.sd ?? 0) ** 2
  const varB = (b.sd ?? 0) ** 2
  const seA = varA / a.n
  const seB = varB / b.n
  const se = Math.sqrt(seA + seB)
  if (!Number.isFinite(se) || se === 0) {
    return {
      meanA: a.mean, meanB: b.mean, difference: a.mean - b.mean, t: 0,
      df: a.n + b.n - 2, p: 1, cohenD: null,
      ci95: [a.mean - b.mean, a.mean - b.mean], zeroVariance: true, nA: a.n, nB: b.n,
    }
  }
  const difference = a.mean - b.mean
  const t = difference / se
  const df = (seA + seB) ** 2 / ((seA ** 2) / (a.n - 1) + (seB ** 2) / (b.n - 1))
  const p = tTestPValue(t, df)
  const pooled = Math.sqrt(((a.n - 1) * varA + (b.n - 1) * varB) / (a.n + b.n - 2))
  const cohenD = pooled === 0 ? null : difference / pooled
  const critical = tCritical95(df)
  return {
    meanA: a.mean,
    meanB: b.mean,
    difference,
    t,
    df,
    p,
    cohenD,
    ci95: [difference - critical * se, difference + critical * se],
    nA: a.n,
    nB: b.n,
  }
}

/**
 * Interpret Cohen's d.
 * @param {number|null} d - effect size.
 * @returns {string} small, medium, large or —.
 */
export function effectLabel(d) {
  if (d === null || !Number.isFinite(d)) return '—'
  const magnitude = Math.abs(d)
  if (magnitude < 0.2) return 'negligible'
  if (magnitude < 0.5) return 'small'
  if (magnitude < 0.8) return 'medium'
  return 'large'
}
