import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { writeFileAtomic } from '../util.js'

const require = createRequire(import.meta.url)
const SETS = /** @type {Record<string, string>} */ ({ mdi: '@iconify-json/mdi/icons.json', si: '@iconify-json/simple-icons/icons.json' })
const DI_CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons'

/**
 * @typedef {{ url: string, mono: boolean, color?: string }} IconRef
 */

/**
 * Turns an icon spec from the config into something the browser can load.
 *   mdi:cpu-64-bit[#38bdf8]  si:plex  di:plex[.png]  logo.png (config/icons, else dashboard-icons)  /path  https://...
 * homepage-style specs (mdi-cpu-64-bit-#38bdf8, plex.png) also work.
 * @param {string | undefined} spec
 * @returns {IconRef | null}
 */
export function resolveIcon (spec) {
  if (!spec) return null
  let s = spec.trim()
  let color
  const hash = /#([0-9a-fA-F]{3,8})$/.exec(s)
  if (hash) {
    color = `#${hash[1]}`
    s = s.slice(0, hash.index).replace(/-$/, '')
  }
  if (/^https?:\/\//.test(s) || s.startsWith('/')) return { url: s, mono: false }
  const m = /^(mdi|si)[:-](.+)$/.exec(s)
  if (m) return { url: `/icons/${m[1]}/${encodeURIComponent(m[2])}.svg`, mono: true, color }
  const di = /^di:([a-z0-9-]+)(?:\.(svg|png|webp))?$/.exec(s)
  if (di) return { url: `/icons/di/${di[1]}.${di[2] ?? 'svg'}`, mono: false }
  if (/^[\w.-]+\.(svg|png|webp|jpg|jpeg|gif|ico)$/i.test(s)) return { url: `/icons/local/${encodeURIComponent(s)}`, mono: false }
  return null
}

/**
 * @param {{ configDir: string, dataDir: string | null, log: import('../util.js').Logger }} o
 */
export function createIconService ({ configDir, dataDir, log }) {
  /** @type {Map<string, any>} */
  const sets = new Map()
  /** @type {Map<string, number>} */
  const misses = new Map()

  /** @param {string} set */
  function loadSet (set) {
    if (!sets.has(set)) sets.set(set, JSON.parse(fs.readFileSync(require.resolve(SETS[set]), 'utf8')))
    return sets.get(set)
  }

  return {
    /**
     * @param {string} set mdi | si
     * @param {string} name
     * @param {string} [color]
     * @returns {string | null} SVG markup
     */
    svg (set, name, color) {
      if (!SETS[set]) return null
      const data = loadSet(set)
      let key = name
      for (let i = 0; i < 5 && !data.icons[key] && data.aliases?.[key]; i++) key = data.aliases[key].parent
      const icon = data.icons[key]
      if (!icon) return null
      const w = icon.width ?? data.width ?? 24
      const h = icon.height ?? data.height ?? 24
      const fill = color && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : 'currentColor'
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="${fill}" color="${fill}">${icon.body}</svg>`
    },

    /**
     * A dashboard-icons file, downloaded once and cached under the data folder.
     * @param {string} name
     * @param {string} ext svg | png | webp
     * @returns {Promise<{ file: string } | null>}
     */
    async dashboardIcon (name, ext) {
      if (!/^[a-z0-9-]+$/.test(name) || !['svg', 'png', 'webp'].includes(ext)) return null
      const cacheDir = path.join(dataDir ?? path.join(configDir, '.cache'), 'cache', 'icons')
      const file = path.join(cacheDir, `${name}.${ext}`)
      if (fs.existsSync(file)) return { file }
      const key = `${name}.${ext}`
      if ((misses.get(key) ?? 0) > Date.now()) return null
      try {
        const r = await fetch(`${DI_CDN}/${ext}/${name}.${ext}`, { signal: AbortSignal.timeout(10_000) })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        fs.mkdirSync(cacheDir, { recursive: true })
        writeFileAtomic(file, /** @type {any} */ (Buffer.from(await r.arrayBuffer())))
        return { file }
      } catch (err) {
        log.debug(`icon di:${key} unavailable: ${/** @type {Error} */ (err).message}`)
        misses.set(key, Date.now() + 3_600_000)
        return null
      }
    },

    /** @param {string} name */
    localIcon (name) {
      const dir = path.join(configDir, 'icons')
      const file = path.resolve(dir, name)
      if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) return null
      return { file }
    }
  }
}
