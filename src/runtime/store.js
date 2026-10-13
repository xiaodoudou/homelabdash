import fs from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from '../util.js'

/**
 * Small JSON document store under the data folder, one file per namespace ("alerts", "state/<source>").
 * Writes are debounced; call flush() before exiting.
 * @param {string | null} dataDir null keeps everything in memory
 * @param {(err: Error) => void} [onError] a write that fails (read-only or wrongly owned folder) is reported, not thrown
 */
export function createStore (dataDir, onError = () => {}) {
  /** @type {Map<string, any>} */
  const cache = new Map()
  /** @type {Set<string>} */
  const dirty = new Set()
  /** @type {NodeJS.Timeout | null} */
  let timer = null

  /** @param {string} ns */
  const fileOf = ns => path.join(/** @type {string} */ (dataDir), ...ns.split('/').map(s => s.replace(/[^A-Za-z0-9._-]/g, '_'))) + '.json'

  function flush () {
    if (timer) { clearTimeout(timer); timer = null }
    if (!dataDir) { dirty.clear(); return }
    for (const ns of dirty) {
      try {
        writeFileAtomic(fileOf(ns), JSON.stringify(cache.get(ns) ?? null, null, 2))
      } catch (err) {
        onError(/** @type {Error} */ (err))
      }
    }
    dirty.clear()
  }

  return {
    /** @param {string} ns @param {any} [fallback] */
    get (ns, fallback) {
      if (!cache.has(ns) && dataDir) {
        try {
          cache.set(ns, JSON.parse(fs.readFileSync(fileOf(ns), 'utf8')))
        } catch {}
      }
      return cache.has(ns) ? cache.get(ns) : fallback
    },
    /** @param {string} ns @param {any} value */
    set (ns, value) {
      cache.set(ns, value)
      dirty.add(ns)
      timer ??= setTimeout(flush, 500)
    },
    /** @param {string} ns */
    delete (ns) {
      cache.delete(ns)
      dirty.delete(ns)
      if (dataDir) fs.rmSync(fileOf(ns), { force: true })
    },
    flush
  }
}

/** @typedef {ReturnType<typeof createStore>} Store */
