import fs from 'node:fs'
import path from 'node:path'

const UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/**
 * @param {string | number | undefined | null} value "15s", "2m", "500ms" or a number of milliseconds
 * @returns {number | undefined}
 */
export function parseDuration (value) {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return value
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(String(value).trim())
  if (!m) throw new Error(`invalid duration "${value}" (use 500ms, 15s, 2m, 1h)`)
  return Math.round(Number(m[1]) * UNITS[/** @type {keyof typeof UNITS} */ (m[2])])
}

/** @param {string} text */
export function slug (text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
}

/**
 * JSON.stringify with sorted keys, so equal objects give equal strings.
 * @param {unknown} value
 */
export function stableStringify (value) {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
    }
    return v
  })
}

/**
 * @param {string} file
 * @param {string | Buffer} content
 */
export function writeFileAtomic (file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, file)
}

/**
 * Expands a pattern whose last segment may contain `*` (e.g. "pages/*.yaml").
 * @param {string} baseDir
 * @param {string} pattern
 * @returns {string[]} absolute paths, sorted
 */
export function expandGlob (baseDir, pattern) {
  const abs = path.resolve(baseDir, pattern)
  const dir = path.dirname(abs)
  const base = path.basename(abs)
  if (!base.includes('*')) return fs.existsSync(abs) ? [abs] : []
  if (/[*?[\]]/.test(dir.slice(path.resolve(baseDir).length))) {
    throw new Error(`include "${pattern}": wildcards are only supported in the file name`)
  }
  if (!fs.existsSync(dir)) return []
  const re = new RegExp('^' + base.split('*').map(s => s.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('.*') + '$')
  return fs.readdirSync(dir).filter(f => re.test(f)).sort().map(f => path.join(dir, f))
}

/**
 * Replaces every known secret value in strings, deeply.
 * @template T
 * @param {T} value
 * @param {Set<string>} secrets
 * @returns {T}
 */
export function redact (value, secrets) {
  if (!secrets.size) return value
  if (typeof value === 'string') {
    let out = /** @type {string} */ (value)
    for (const s of secrets) if (out.includes(s)) out = out.split(s).join('***')
    return /** @type {T} */ (/** @type {unknown} */ (out))
  }
  if (Array.isArray(value)) return /** @type {T} */ (value.map(v => redact(v, secrets)))
  if (value && typeof value === 'object') {
    return /** @type {T} */ (Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, secrets)])))
  }
  return value
}

/** @param {unknown} err */
export function errorMessage (err) {
  if (err instanceof Error) return err.message
  return String(err)
}

export function createLogger (level = process.env.HOMELABDASH_LOG_LEVEL ?? 'info') {
  const levels = ['debug', 'info', 'warn', 'error']
  const min = Math.max(0, levels.indexOf(level))
  /** @type {Set<string>} */
  let secrets = new Set()
  /** @param {string} lvl */
  const at = lvl => (/** @type {unknown[]} */ ...args) => {
    if (levels.indexOf(lvl) < min) return
    const text = args.map(a => typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a)).join(' ')
    const line = `${new Date().toISOString()} ${lvl.padEnd(5)} ${redact(text, secrets)}`
    if (lvl === 'error' || lvl === 'warn') process.stderr.write(line + '\n')
    else process.stdout.write(line + '\n')
  }
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    /** @param {Set<string>} s */
    setSecrets (s) { secrets = s }
  }
}

/** @typedef {ReturnType<typeof createLogger>} Logger */
