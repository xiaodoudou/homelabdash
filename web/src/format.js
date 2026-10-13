const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Three significant digits with trailing zeros kept (1.50, 28.0, 330), so neighbouring values read alike. @param {number} v */
const sig3 = v => v >= 100 ? nf0.format(v) : v >= 10 ? nf1.format(v) : nf2.format(v)

/**
 * @param {number} n
 * @param {number} base
 * @param {string[]} units
 */
function scaled (n, base, units) {
  if (n === 0) return `0 ${units[0]}`
  let i = 0
  let v = Math.abs(n)
  while (v >= base && i < units.length - 1) { v /= base; i++ }
  return `${n < 0 ? '-' : ''}${i ? sig3(v) : nf0.format(v)} ${units[i]}`
}

/** @param {number} seconds */
export function duration (seconds) {
  let s = Math.max(0, Math.round(seconds))
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600); s -= h * 3600
  const m = Math.floor(s / 60); s -= m * 60
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m >= 10) return `${m}m`
  if (m) return `${m}m ${s}s`
  return `${s}s`
}

/** Seconds as HH:MM:SS (00:06:05, 01:02:45), always the same width. @param {number} seconds */
export function clockTime (seconds) {
  const s = Math.max(0, Math.round(seconds))
  const two = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
}

/** @param {string | number} t */
export function toMs (t) {
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t
  return Date.parse(t)
}

/** @param {string | number} t */
export function relative (t) {
  const diff = (toMs(t) - Date.now()) / 1000
  if (!Number.isFinite(diff)) return ''
  if (Math.abs(diff) < 45) return 'just now'
  return diff < 0 ? `${duration(-diff)} ago` : `in ${duration(diff)}`
}

/**
 * @param {unknown} value
 * @param {string} [format]
 * @param {string} [unit]
 */
export function fmt (value, format, unit) {
  if (value === null || value === undefined || value === '') return '-'
  const n = typeof value === 'number' ? value : Number(value)
  const num = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(n))
  let out
  switch (format) {
    case 'percent': out = num ? (n === 0 ? '0%' : n < 10 ? `${nf1.format(n)}%` : `${nf0.format(n)}%`) : String(value); break
    case 'bytes': out = num ? scaled(n, 1024, ['B', 'KB', 'MB', 'GB', 'TB', 'PB']) : String(value); break
    case 'bits': out = num ? scaled(n, 1000, ['b', 'kb', 'Mb', 'Gb', 'Tb']) : String(value); break
    case 'bitrate': out = num ? scaled(n, 1000, ['b/s', 'kb/s', 'Mb/s', 'Gb/s']) : String(value); break
    case 'byterate': out = num ? scaled(n, 1024, ['B/s', 'KB/s', 'MB/s', 'GB/s']) : String(value); break
    case 'duration': out = num ? duration(n) : String(value); break
    case 'since': out = duration((Date.now() - toMs(/** @type {any} */ (value))) / 1000); break
    case 'clock': out = num ? clockTime(n) : String(value); break
    case 'until': out = clockTime((toMs(/** @type {any} */ (value)) - Date.now()) / 1000); break
    case 'relativeTime': out = relative(/** @type {any} */ (value)); break
    case 'date': out = new Date(toMs(/** @type {any} */ (value))).toLocaleDateString(); break
    case 'datetime': out = new Date(toMs(/** @type {any} */ (value))).toLocaleString(); break
    case 'temperature': out = num ? `${nf0.format(n)}°C` : String(value); break
    case 'text': out = String(value); break
    default: out = num ? (Number.isInteger(n) || Math.abs(n) >= 1000 ? nf0.format(n) : sig3(n)) : String(value)
  }
  return unit ? `${out} ${unit}` : out
}

/**
 * @param {{ value: unknown, warn?: number | null, crit?: number | null, invert?: boolean }} item
 * @returns {'' | 'warning' | 'error'}
 */
export function threshold (item) {
  const v = typeof item.value === 'number' ? item.value : Number(item.value)
  if (Number.isNaN(v) || item.value === null || item.value === '') return ''
  const over = (/** @type {number | null | undefined} */ t) => t !== null && t !== undefined && (item.invert ? v <= t : v >= t)
  if (over(item.crit)) return 'error'
  if (over(item.warn)) return 'warning'
  return ''
}

/** @param {string | number} t */
export function clock (t) {
  const d = new Date(toMs(t))
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
