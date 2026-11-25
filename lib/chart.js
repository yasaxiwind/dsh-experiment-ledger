/**
 * Dependency-free SVG bar chart for reports.
 *
 * The report is a standalone Markdown directory; a chart file beside it keeps
 * the report readable without a browser runtime. Colours are fixed because the
 * file may be opened outside the Harness theme.
 *
 * @module dsh-experiment-ledger/chart
 */
import { formatNumber } from './compare.js'

/**
 * @param {string} text - untrusted label.
 * @returns {string} XML-escaped text.
 */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * @param {string} key - metric key.
 * @returns {string} a safe chart file stem.
 */
export function chartFileName(key) {
  return `${String(key).replace(/[^A-Za-z0-9._-]+/g, '-')}.svg`
}

/**
 * Render one comparison metric as a bar chart with ±sd whiskers.
 * @param {{groups: object[], metric: {key: string, label?: string, unit?: string}, title?: string, width?: number, height?: number}} options - chart data.
 * @returns {string} the SVG document.
 */
export function barChartSvg(options) {
  const { groups, metric } = options
  const width = options.width ?? 680
  const height = options.height ?? 260
  const left = 56
  const right = 20
  const top = 34
  const bottom = 56
  const plotW = width - left - right
  const plotH = height - top - bottom
  const stats = groups.map((group) => group.stats?.[metric.key] ?? { n: 0 })
  const max = Math.max(...stats.map((stat) => (stat.mean ?? 0) + (stat.sd ?? 0)), 0.000001)
  const step = plotW / Math.max(groups.length, 1)
  const barW = Math.min(58, step * 0.55)
  const y = (value) => top + plotH - (Math.max(0, value) / max) * plotH
  const title = options.title ?? `${metric.label ?? metric.key}${metric.unit ? ` (${metric.unit})` : ''}`

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`)
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`)
  parts.push(`<text x="${left}" y="20" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="#22302c">${escapeXml(title)}</text>`)
  parts.push(`<line x1="${left}" y1="${top + plotH}" x2="${width - right}" y2="${top + plotH}" stroke="#9aa8a2" stroke-width="1"/>`)
  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#9aa8a2" stroke-width="1"/>`)
  parts.push(`<text x="${left - 8}" y="${top + 4}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10" fill="#5b6b66">${escapeXml(formatNumber(max))}</text>`)
  parts.push(`<text x="${left - 8}" y="${top + plotH}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10" fill="#5b6b66">0</text>`)

  groups.forEach((group, index) => {
    const stat = stats[index]
    if (stat === undefined || stat.n === 0 || stat.mean === null) return
    const cx = left + step * index + step / 2
    const barTop = y(stat.mean)
    const high = y(stat.mean + (stat.sd ?? 0))
    const low = y(Math.max(0, stat.mean - (stat.sd ?? 0)))
    parts.push(`<rect x="${(cx - barW / 2).toFixed(1)}" y="${barTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, top + plotH - barTop).toFixed(1)}" fill="#2f8f7c" opacity="0.9"/>`)
    parts.push(`<line x1="${cx.toFixed(1)}" y1="${high.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${low.toFixed(1)}" stroke="#22302c" stroke-width="1"/>`)
    parts.push(`<line x1="${(cx - 6).toFixed(1)}" y1="${high.toFixed(1)}" x2="${(cx + 6).toFixed(1)}" y2="${high.toFixed(1)}" stroke="#22302c" stroke-width="1"/>`)
    parts.push(`<line x1="${(cx - 6).toFixed(1)}" y1="${low.toFixed(1)}" x2="${(cx + 6).toFixed(1)}" y2="${low.toFixed(1)}" stroke="#22302c" stroke-width="1"/>`)
    parts.push(`<text x="${cx.toFixed(1)}" y="${(high - 5).toFixed(1)}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#22302c">${escapeXml(formatNumber(stat.mean))}</text>`)
    const label = group.label.length > 18 ? `${group.label.slice(0, 17)}…` : group.label
    parts.push(`<text x="${cx.toFixed(1)}" y="${top + plotH + 16}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#5b6b66">${escapeXml(label)}</text>`)
    if (stat.n > 0) parts.push(`<text x="${cx.toFixed(1)}" y="${top + plotH + 30}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" fill="#8a9994">n=${stat.n}</text>`)
  })

  parts.push('</svg>')
  return parts.join('\n')
}
