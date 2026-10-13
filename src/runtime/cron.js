import { parseDuration } from '../util.js'

const MACROS = /** @type {Record<string, string>} */ ({
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *'
})

const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]

/**
 * @typedef {{ kind: 'cron', fields: Set<number>[], domStar: boolean, dowStar: boolean } | { kind: 'every', ms: number }} Schedule
 */

/**
 * Parses a 5-field cron expression (local time), a macro such as @hourly, or a duration such as 10m.
 * @param {string} expr
 * @returns {Schedule}
 */
export function parseSchedule (expr) {
  const text = String(expr).trim()
  if (/^\d+(\.\d+)?(ms|s|m|h|d)$/.test(text)) {
    const ms = /** @type {number} */ (parseDuration(text))
    if (ms < 1000) throw new Error(`schedule "${expr}": minimum is 1s`)
    return { kind: 'every', ms }
  }
  const parts = (MACROS[text] ?? text).split(/\s+/)
  if (parts.length !== 5) throw new Error(`schedule "${expr}": expected 5 cron fields (minute hour day month weekday), a macro like @daily, or a duration like 10m`)
  const fields = parts.map((p, i) => parseField(p, RANGES[i][0], RANGES[i][1], expr))
  if (fields[4].has(7)) fields[4].add(0)
  return { kind: 'cron', fields, domStar: parts[2] === '*', dowStar: parts[4] === '*' }
}

/**
 * @param {string} part
 * @param {number} min
 * @param {number} max
 * @param {string} expr
 */
function parseField (part, min, max, expr) {
  const out = new Set()
  for (const item of part.split(',')) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(item)
    if (!m) throw new Error(`schedule "${expr}": cannot read "${item}"`)
    const lo = m[1] === '*' ? min : Number(m[1])
    const hi = m[2] !== undefined ? Number(m[2]) : (m[1] === '*' || m[3] ? max : lo)
    const step = m[3] ? Number(m[3]) : 1
    if (lo < min || hi > max || lo > hi || step < 1) throw new Error(`schedule "${expr}": "${item}" is out of range ${min}-${max}`)
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

/**
 * Next run strictly after `from`.
 * @param {Schedule} s
 * @param {Date} [from]
 */
export function nextRun (s, from = new Date()) {
  if (s.kind === 'every') return new Date(from.getTime() + s.ms)
  const [min, hour, dom, mon, dow] = s.fields
  const d = new Date(from.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const limit = from.getTime() + 5 * 366 * 86_400_000
  while (d.getTime() < limit) {
    if (!mon.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    const domOk = dom.has(d.getDate())
    const dowOk = dow.has(d.getDay())
    const dayOk = s.domStar && s.dowStar ? true : s.domStar ? dowOk : s.dowStar ? domOk : domOk || dowOk
    if (!dayOk) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!min.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0)
      continue
    }
    return d
  }
  throw new Error('schedule never fires')
}
