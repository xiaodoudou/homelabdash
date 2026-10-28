import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { watch } from 'chokidar'
import { Registry, BUILTIN_DIR } from './plugins/registry.js'
import { Runtime } from './runtime/runtime.js'
import { createStore } from './runtime/store.js'
import { createIconService, resolveIcon } from './runtime/icons.js'
import { loadAndValidate, isolateErrors } from './config/validate.js'
import { ALERTS_SOURCE, MAIN_FILES } from './config/load.js'
import { createServer } from './server/app.js'
import { createLogger } from './util.js'

const STARTER = fileURLToPath(new URL('../examples/starter/homelabdash.yaml', import.meta.url))
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/**
 * The running service: config + plugins + runtime + HTTP/WebSocket server, with hot reload of
 * the config folder (YAML, secrets, user plugins) and optionally of the builtin plugins.
 */
export class Homelabdash {
  /**
   * @param {object} o
   * @param {string} o.configDir
   * @param {string | null} [o.dataDir]
   * @param {number} [o.port]
   * @param {string} [o.host]
   * @param {boolean} [o.watch]
   * @param {boolean} [o.watchBuiltin]
   * @param {NodeJS.ProcessEnv} [o.env]
   * @param {string} [o.secretsDir]
   * @param {string} [o.builtinDir]
   * @param {import('./util.js').Logger} [o.log]
   */
  constructor (o) {
    this.o = o
    this.configDir = path.resolve(o.configDir)
    this.dataDir = o.dataDir ? path.resolve(o.dataDir) : null
    this.log = o.log ?? createLogger()
    this.version = 0
    /** @type {import('./config/load.js').Config | null} */
    this.config = null
    /** @type {import('./config/load.js').ConfigError[]} */
    this.configErrors = []
    /** @type {import('./config/load.js').Settings['auth'] | null} last good auth, kept while the config is broken */
    this.lastAuth = null
    let warned = false
    this.store = createStore(this.dataDir, err => {
      if (warned) return
      warned = true
      this.log.error(`cannot write to the data folder (${err.message}); dismissed alerts and plugin state will not survive a restart. Make ${this.dataDir} writable for uid ${process.getuid?.() ?? '?'} (e.g. docker run --user).`)
    })
    this.registry = new Registry({ userDir: path.join(this.configDir, 'plugins'), builtinDir: o.builtinDir, dataDir: this.dataDir ?? undefined, configDir: this.configDir })
    this.runtime = new Runtime({ registry: this.registry, store: this.store, log: this.log })
    this.icons = createIconService({ configDir: this.configDir, dataDir: this.dataDir, log: this.log })
    /** @type {ReturnType<typeof createServer> | null} */
    this.http = null
    /** @type {import('chokidar').FSWatcher[]} */
    this.watchers = []
    /** @type {Map<string, NodeJS.Timeout>} */
    this.debounce = new Map()
  }

  async start () {
    this.ensureStarterConfig()
    await this.registry.load()
    for (const e of this.registry.list()) {
      if (e.error) this.log.error(`plugin ${e.id} failed to load: ${e.error}`)
    }
    this.log.info(`plugins: ${this.registry.list().map(e => e.id + (e.builtin ? '' : ' (user)')).join(', ')}`)
    await this.reloadConfig()
    this.http = createServer(this)
    const server = this.http.server
    const port = this.o.port ?? 3000
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, this.o.host ?? '0.0.0.0', () => resolve(undefined))
    })
    const addr = server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : port
    this.log.info(`homelabdash ${pkg.version} listening on http://${this.o.host ?? '0.0.0.0'}:${this.port} (config ${this.configDir})`)
    if (this.o.watch !== false) await this.watch()
    return this
  }

  ensureStarterConfig () {
    if (MAIN_FILES.some(f => fs.existsSync(path.join(this.configDir, f)))) return
    try {
      fs.mkdirSync(this.configDir, { recursive: true })
      fs.copyFileSync(STARTER, path.join(this.configDir, MAIN_FILES[0]))
      this.log.info(`no config found, wrote a starter ${MAIN_FILES[0]} to ${this.configDir}`)
    } catch (err) {
      this.log.error(`no config found and ${this.configDir} is not writable (${/** @type {Error} */ (err).message}); create ${MAIN_FILES[0]} there or run the container with --user matching the folder owner`)
    }
  }

  async reloadConfig () {
    const res = loadAndValidate(this.configDir, this.registry, { env: this.o.env, secretsDir: this.o.secretsDir })
    const errors = res.errors.map(e => ({ ...e, file: e.file ? path.relative(this.configDir, e.file) || e.file : undefined }))
    for (const e of errors) this.log.error(`config: ${formatError(e)}`)
    // A mistake inside one source or tile only switches that part off; anything else keeps the last good config.
    const config = res.config ?? (res.draft ? isolateErrors(res.draft, res.errors) : null)
    if (!config) {
      this.configErrors = errors
      if (this.config) this.log.warn('keeping the last valid config')
      this.http?.hub.broadcast({ type: 'config-errors', errors: this.configErrors })
      return { ok: false, errors: this.configErrors }
    }
    this.config = config
    this.lastAuth = config.settings.auth
    this.configErrors = errors
    this.version++
    this.log.setSecrets(res.secrets)
    this.runtime.setSecrets(res.secrets)
    await this.runtime.apply(config)
    this.http?.hub.broadcast({ type: 'dashboard', version: this.version })
    const off = Object.values(config.sources).filter(s => s.configError).length + Object.values(config.tiles).filter(t => t.configError).length
    this.log.info(`config v${this.version} applied: ${Object.keys(config.sources).length} sources, ${Object.keys(config.tiles).length} tiles${off ? `, ${off} switched off by config errors` : ''}`)
    return { ok: !errors.length, errors }
  }

  /** Resolves once the watchers have scanned the folders, so an edit right after start is not missed. */
  async watch () {
    const data = this.dataDir
    const ignored = (/** @type {string} */ p) => /[\\/](node_modules|\.git|\.schema|\.cache|fixtures)([\\/]|$)/.test(p) ||
      (!!data && (p === data || p.startsWith(data + path.sep)))
    const w = watch(this.configDir, { ignoreInitial: true, ignored, depth: 5 })
    w.on('all', (_ev, file) => {
      const rel = path.relative(this.configDir, file)
      const parts = rel.split(path.sep)
      if (parts[0] === 'plugins' && parts[1]) return this.later(`plugin:${parts[1]}`, () => this.pluginChanged(parts[1]))
      if (/\.ya?ml$/.test(rel)) return this.later('config', () => this.reloadConfig())
      if (rel === 'custom.css' || rel === 'custom.js') this.http?.hub.broadcast({ type: 'assets', file: rel })
    })
    this.watchers.push(w)
    if (this.o.watchBuiltin) {
      const b = watch(this.o.builtinDir ?? BUILTIN_DIR, { ignoreInitial: true, ignored, depth: 3 })
      b.on('all', (_ev, file) => {
        const id = path.relative(this.o.builtinDir ?? BUILTIN_DIR, file).split(path.sep)[0]
        if (id) this.later(`plugin:${id}`, () => this.pluginChanged(id))
      })
      this.watchers.push(b)
    }
    await Promise.all(this.watchers.map(w => new Promise(resolve => w.once('ready', () => resolve(undefined)))))
  }

  /** @param {string} key @param {() => unknown} fn */
  later (key, fn) {
    clearTimeout(this.debounce.get(key))
    this.debounce.set(key, setTimeout(() => {
      this.debounce.delete(key)
      Promise.resolve(fn()).catch(err => this.log.error(`${key}: ${err.stack ?? err}`))
    }, 300))
  }

  /** @param {string} id */
  async pluginChanged (id) {
    await this.registry.reload(id)
    const e = this.registry.get(id)
    if (e?.error) this.log.error(`plugin ${id} failed to load: ${e.error}`)
    else this.log.info(`plugin ${id} reloaded`)
    await this.reloadConfig()
  }

  dashboard () {
    const c = this.config
    if (!c) return { version: this.version, title: 'homelabdash', pages: [], configErrors: this.configErrors }
    /** @param {import('./config/load.js').Tile} t */
    const tile = (t) => {
      const src = t.source && t.source !== ALERTS_SOURCE ? c.sources[t.source] : null
      const entry = src ? this.registry.get(src.plugin) : null
      return {
        id: t.id,
        title: t.title,
        icon: resolveIcon(t.icon),
        href: t.href,
        target: t.target,
        description: t.description,
        span: t.span,
        width: t.width,
        hideWhen: t.hideWhen,
        bare: t.bare,
        kind: t.source ? 'data' : 'link',
        hasStatus: !!t.status,
        plugin: t.source === ALERTS_SOURCE ? ALERTS_SOURCE : src?.plugin ?? null,
        widget: entry?.widget ? `/plugins/${entry.id}/widget.js` : null,
        graph: t.graph
      }
    }
    /** @param {import('./config/load.js').Section} s @returns {any} */
    const section = (s) => ({
      id: s.id,
      title: s.title,
      icon: resolveIcon(s.icon),
      hideWhen: s.hideWhen,
      placement: s.placement,
      merge: s.merge,
      width: s.width,
      collapsed: s.collapsed,
      layout: s.layout,
      tiles: s.tiles.map(id => tile(c.tiles[id])),
      groups: s.groups.map(section)
    })
    return {
      version: this.version,
      title: c.settings.title,
      description: c.settings.description,
      theme: c.settings.theme,
      accent: c.settings.accent,
      density: c.settings.density,
      history: { window: this.runtime.history.window, step: this.runtime.history.step },
      pages: c.pages.map(p => ({
        id: p.id,
        title: p.title,
        icon: resolveIcon(p.icon),
        sections: p.sections.map(section)
      })),
      configErrors: this.configErrors
    }
  }

  health () {
    const sources = this.runtime.debug()
    const failing = sources.filter(s => s.error).length
    return {
      status: this.configErrors.length || failing ? 'degraded' : 'ok',
      version: pkg.version,
      configVersion: this.version,
      configErrors: this.configErrors.length,
      sources: sources.length,
      failing
    }
  }

  plugins () {
    return this.registry.list().map(e => ({
      id: e.id,
      builtin: e.builtin,
      error: e.error,
      widget: e.widget,
      ...(e.meta ? { name: e.meta.name, version: e.meta.version, description: e.meta.description, actions: Object.keys(e.meta.actions), jobs: e.meta.jobs, stream: e.meta.hasStream } : {})
    }))
  }

  /** @param {{ source?: string, data?: boolean }} o */
  debugInfo (o) {
    return {
      version: pkg.version,
      configVersion: this.version,
      configErrors: this.configErrors,
      clients: this.http?.hub.clients ?? 0,
      active: this.runtime.active,
      plugins: this.plugins(),
      sources: this.runtime.debug(o)
    }
  }

  async stop () {
    for (const w of this.watchers) await w.close()
    for (const t of this.debounce.values()) clearTimeout(t)
    if (this.http) await new Promise(resolve => { this.http?.hub.close(); this.http?.server.close(() => resolve(undefined)); this.http?.server.closeAllConnections() })
    await this.runtime.stop()
    await this.registry.stop()
    this.store.flush()
  }
}

/** @param {import('./config/load.js').ConfigError} e */
export function formatError (e) {
  const where = e.file ? `${e.file}${e.line ? `:${e.line}:${e.col}` : ''} ` : ''
  return `${where}${e.path ? e.path + ': ' : ''}${e.message}`
}
