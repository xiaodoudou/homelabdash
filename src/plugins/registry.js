import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { PluginHost } from './host.js'

export const BUILTIN_DIR = fileURLToPath(new URL('../../plugins/', import.meta.url))
const ID_RE = /^[a-z0-9][a-z0-9-]*$/

/**
 * @typedef {object} PluginEntry
 * @property {string} id
 * @property {string} dir
 * @property {string} file
 * @property {boolean} builtin
 * @property {PluginHost} host
 * @property {import('./host.js').PluginMeta | null} meta
 * @property {string | null} error
 * @property {boolean} widget the folder has a widget.js custom element
 */

/**
 * Finds plugins in the builtin folder and in <config>/plugins (same id overrides the builtin one)
 * and keeps one PluginHost per plugin. Host events are re-emitted with the plugin id first.
 */
export class Registry extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} [o.userDir]
   * @param {string} [o.builtinDir]
   * @param {string} [o.dataDir]
   * @param {string} [o.configDir]
   * @param {boolean | Record<string, any>} [o.fixtures]
   * @param {boolean} [o.capture]
   */
  constructor (o = {}) {
    super()
    this.o = o
    this.builtinDir = o.builtinDir ?? BUILTIN_DIR
    /** @type {Map<string, PluginEntry>} */
    this.entries = new Map()
    /** @type {Promise<unknown>} */
    this.queue = Promise.resolve()
  }

  /**
   * Reloads must not overlap: two at once would both start a host and orphan one worker.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  serial (fn) {
    const p = this.queue.then(fn)
    this.queue = p.catch(() => {})
    return p
  }

  scan () {
    /** @type {Map<string, { dir: string, file: string, builtin: boolean }>} */
    const found = new Map()
    for (const [dir, builtin] of /** @type {[string | undefined, boolean][]} */ ([[this.builtinDir, true], [this.o.userDir, false]])) {
      if (!dir || !fs.existsSync(dir)) continue
      for (const name of fs.readdirSync(dir).sort()) {
        const pdir = path.join(dir, name)
        const file = ['index.js', 'index.mjs'].map(f => path.join(pdir, f)).find(f => fs.existsSync(f))
        if (!file || !ID_RE.test(name)) continue
        found.set(name, { dir: pdir, file, builtin })
      }
    }
    return found
  }

  async load () {
    const found = this.scan()
    await Promise.all([...found].map(([id, info]) => this.loadOne(id, info)))
    return this
  }

  /** @param {string} id @param {{ dir: string, file: string, builtin: boolean }} info */
  async loadOne (id, info) {
    const host = new PluginHost({ id, file: info.file, dir: info.dir, dataDir: this.o.dataDir, configDir: this.o.configDir, fixtures: this.o.fixtures, capture: this.o.capture })
    for (const ev of ['update', 'stream-end', 'state', 'log', 'refresh', 'restarted']) {
      host.on(ev, (...args) => this.emit(ev, id, ...args))
    }
    /** @type {PluginEntry} */
    const entry = { id, ...info, host, meta: null, error: null, widget: fs.existsSync(path.join(info.dir, 'widget.js')) }
    try {
      entry.meta = await host.start()
      if (entry.meta.id && entry.meta.id !== id) throw new Error(`plugin id "${entry.meta.id}" does not match its folder name "${id}"`)
    } catch (err) {
      entry.error = /** @type {Error} */ (err).message
      entry.meta = null
      await host.stop()
    }
    this.entries.set(id, entry)
    return entry
  }

  /** @param {string} id */
  get (id) { return this.entries.get(id) }

  list () { return [...this.entries.values()].sort((a, b) => a.id.localeCompare(b.id)) }

  /** Stops workers of plugins no source uses; their metadata stays available. */
  async idle () {
    for (const e of this.entries.values()) if (e.host.sources === 0 && e.host.worker) await e.host.stop()
  }

  /** @param {string} id */
  reload (id) {
    return this.serial(() => this.doReload(id))
  }

  /** @param {string} id */
  async doReload (id) {
    const info = this.scan().get(id)
    const old = this.entries.get(id)
    if (old) await old.host.stop()
    if (!info) {
      this.entries.delete(id)
    } else {
      await this.loadOne(id, info)
    }
    this.emit('reloaded', id)
  }

  /** Picks up plugin folders that appeared or disappeared. */
  rescan () {
    return this.serial(async () => {
      const found = this.scan()
      for (const id of new Set([...found.keys(), ...this.entries.keys()])) {
        const a = found.get(id)
        const b = this.entries.get(id)
        if (!a || !b || a.file !== b.file) await this.doReload(id)
      }
    })
  }

  async stop () {
    await this.queue
    await Promise.all([...this.entries.values()].map(e => e.host.stop()))
  }
}
