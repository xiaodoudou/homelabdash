import { EventEmitter } from 'node:events'
import { Alerts } from './alerts.js'
import { History } from './history.js'
import { parseSchedule, nextRun } from './cron.js'
import { stableStringify, redact, errorMessage } from '../util.js'
import { ALERTS_SOURCE } from '../config/load.js'

const MAX_TIMER = 2 ** 31 - 1
const IDLE_STREAM_GRACE = 30_000
const MAX_BACKOFF = 300_000

export class HttpStatusError extends Error {
  /** @param {number} status @param {string} message */
  constructor (status, message) {
    super(message)
    this.status = status
  }
}

/**
 * @typedef {object} Job
 * @property {string} name
 * @property {string} expr
 * @property {import('./cron.js').Schedule} schedule
 * @property {number} timeout
 * @property {boolean} refresh
 * @property {NodeJS.Timeout | null} timer
 * @property {number | null} nextRun
 * @property {number | null} lastRun
 * @property {string | null} lastError
 * @property {number | null} durationMs
 * @property {boolean} running
 *
 * @typedef {object} SourceRt
 * @property {string} id
 * @property {import('../config/load.js').SourceDef} def
 * @property {import('../plugins/registry.js').PluginEntry | undefined} entry
 * @property {{ id: string, options: any }[]} tiles
 * @property {{ tileId: string, key: string }[]} statusKeys
 * @property {string} fetchSig
 * @property {string} tileSig
 * @property {any} data
 * @property {any} derived
 * @property {string | null} error
 * @property {number} failures
 * @property {number | null} lastRun
 * @property {number | null} lastOk
 * @property {number | null} durationMs
 * @property {number | null} nextRun
 * @property {NodeJS.Timeout | undefined} timer
 * @property {Promise<void> | null} running
 * @property {boolean} streamOn
 * @property {number} streamFailures
 * @property {string | null} streamError
 * @property {NodeJS.Timeout | undefined} streamRetry
 * @property {NodeJS.Timeout | undefined} idleStreamTimer
 * @property {Map<string, Job>} jobs
 * @property {boolean} stopped
 *
 * @typedef {object} TileState
 * @property {string} id
 * @property {any} view
 * @property {string | null} error
 * @property {boolean} stale
 * @property {boolean} loading
 * @property {{ state: string, label?: string } | null} status
 * @property {Record<string, [number, number]> | null} [point] latest history point per graphed stat
 */

/**
 * Runs every enabled source: polls fetch() on its interval, keeps stream() connected while someone
 * is watching, fires the plugin's jobs on their schedule, and turns results into per-tile states.
 * Emits `tile` with a TileState whenever what a tile shows changes.
 */
export class Runtime extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('../plugins/registry.js').Registry} o.registry
   * @param {import('./store.js').Store} o.store
   * @param {import('../util.js').Logger} o.log
   */
  constructor ({ registry, store, log }) {
    super()
    this.registry = registry
    this.store = store
    this.log = log
    /** @type {Set<string>} */
    this.secrets = new Set()
    /** @type {Map<string, SourceRt>} */
    this.sources = new Map()
    /** @type {Map<string, TileState>} */
    this.tileStates = new Map()
    /** @type {Map<string, string>} */
    this.tileSigs = new Map()
    /** @type {import('../config/load.js').Config | null} */
    this.config = null
    this.active = false
    this.alerts = new Alerts(store)
    this.history = new History(store)
    /** @type {Promise<void>} */
    this.applying = Promise.resolve()

    registry.on('update', (_p, sourceId, msg) => {
      const rt = this.sources.get(sourceId)
      if (!rt || rt.stopped) return
      rt.streamFailures = 0
      rt.streamError = null
      this.applyResult(rt, msg)
    })
    registry.on('stream-end', (_p, sourceId, info) => this.onStreamEnd(sourceId, info))
    registry.on('state', (_p, sourceId, state) => store.set(`state/${sourceId}`, state))
    registry.on('log', (pluginId, level, sourceId, msg) => {
      const fn = /** @type {any} */ (log)[level] ?? log.info
      fn(`[${sourceId ?? pluginId}] ${redact(String(msg), this.secrets)}`)
    })
    registry.on('refresh', (_p, sourceId) => {
      const rt = this.sources.get(sourceId)
      if (rt) this.runFetch(rt)
    })
  }

  /** @param {Set<string>} secrets */
  setSecrets (secrets) { this.secrets = secrets }

  /** @param {unknown} err */
  clean (err) { return redact(errorMessage(err), this.secrets) }

  /** @param {import('../config/load.js').Config} config */
  apply (config) {
    this.applying = this.applying.then(() => this.doApply(config)).catch(err => this.log.error(`applying config failed: ${err.stack ?? err}`))
    return this.applying
  }

  /** @param {import('../config/load.js').Config} config */
  async doApply (config) {
    this.config = config
    /** @type {Map<string, { id: string, options: any }[]>} */
    const tilesBy = new Map()
    /** @type {Map<string, { tileId: string, key: string }[]>} */
    const statusBy = new Map()
    for (const t of Object.values(config.tiles)) {
      if (t.source && t.source !== ALERTS_SOURCE) push(tilesBy, t.source, { id: t.id, options: t.options })
      if (t.status) push(statusBy, t.status.source, { tileId: t.id, key: t.status.key })
    }
    const wanted = Object.values(config.sources).filter(d => d.enabled)
    const wantedIds = new Set(wanted.map(d => d.id))

    for (const [id, rt] of this.sources) {
      if (wantedIds.has(id)) continue
      await this.stopSource(rt)
      this.sources.delete(id)
      if (this.alerts.remove(id)) this.emitAlerts()
    }

    /** @type {SourceRt[]} */
    const starting = []
    for (const def of wanted) {
      const entry = this.registry.get(def.plugin)
      const tiles = tilesBy.get(def.id) ?? []
      const statusKeys = statusBy.get(def.id) ?? []
      const fetchSig = stableStringify({ plugin: def.plugin, config: def.config, interval: def.interval, timeout: def.timeout, jobs: def.jobs, timeoutDefault: config.settings.timeout, intervalDefault: config.settings.defaultInterval })
      const tileSig = stableStringify({ tiles, statusKeys })
      const existing = this.sources.get(def.id)
      if (existing && existing.fetchSig === fetchSig && existing.entry === entry) {
        existing.def = def
        if (existing.tileSig !== tileSig) {
          Object.assign(existing, { tiles, statusKeys, tileSig })
          await this.reconfigure(existing)
        }
        continue
      }
      if (existing) await this.stopSource(existing)
      /** @type {SourceRt} */
      const rt = {
        id: def.id, def, entry, tiles, statusKeys, fetchSig, tileSig,
        data: undefined, derived: undefined, error: null, failures: 0,
        lastRun: null, lastOk: null, durationMs: null, nextRun: null, timer: undefined, running: null,
        streamOn: false, streamFailures: 0, streamError: null, streamRetry: undefined, idleStreamTimer: undefined,
        jobs: new Map(), stopped: false
      }
      this.sources.set(def.id, rt)
      starting.push(rt)
    }
    await Promise.all(starting.map(rt => this.startSource(rt)))
    await this.registry.idle()

    for (const id of [...this.tileStates.keys()]) {
      if (!config.tiles[id]) { this.tileStates.delete(id); this.tileSigs.delete(id) }
    }
    this.history.keep(new Map(Object.values(config.tiles).filter(t => t.graph).map(t => [t.id, /** @type {true | string[]} */ (t.graph)])))
    for (const tile of Object.values(config.tiles)) this.updateTile(tile)
  }

  /** @param {SourceRt} rt */
  async startSource (rt) {
    const { entry } = rt
    if (!entry || !entry.meta) {
      rt.error = entry ? `plugin "${entry.id}" failed to load: ${entry.error}` : `unknown plugin "${rt.def.plugin}"`
      this.emitSourceTiles(rt)
      return
    }
    const meta = entry.meta
    try {
      await entry.host.configure(rt.id, { config: rt.def.config, tiles: rt.tiles, statusKeys: rt.statusKeys, state: this.store.get(`state/${rt.id}`, {}) })
    } catch (err) {
      rt.error = this.clean(err)
      this.emitSourceTiles(rt)
      return
    }
    if (rt.stopped) return
    if (meta.hasFetch) this.runFetch(rt)
    else await this.runDerive(rt)
    if (meta.hasStream && (this.active || meta.keepStreaming)) this.startStream(rt)
    this.setupJobs(rt)
  }

  /** @param {SourceRt} rt */
  async reconfigure (rt) {
    if (!rt.entry?.meta) return
    try {
      await rt.entry.host.configure(rt.id, { config: rt.def.config, tiles: rt.tiles, statusKeys: rt.statusKeys, state: this.store.get(`state/${rt.id}`, {}) })
      if (rt.data !== undefined || !rt.entry.meta.hasFetch) await this.runDerive(rt)
    } catch (err) {
      rt.error = this.clean(err)
      this.emitSourceTiles(rt)
    }
  }

  /** @param {SourceRt} rt */
  async stopSource (rt) {
    rt.stopped = true
    clearTimeout(rt.timer)
    clearTimeout(rt.streamRetry)
    clearTimeout(rt.idleStreamTimer)
    for (const j of rt.jobs.values()) if (j.timer) clearTimeout(j.timer)
    if (rt.entry?.meta) await rt.entry.host.remove(rt.id)
  }

  /** @param {SourceRt} rt */
  intervalOf (rt) {
    return Math.max(1000, rt.def.interval ?? rt.entry?.meta?.interval ?? this.config?.settings.defaultInterval ?? 30_000)
  }

  /** @param {SourceRt} rt */
  timeoutOf (rt) {
    return rt.def.timeout ?? rt.entry?.meta?.timeout ?? this.config?.settings.timeout ?? 10_000
  }

  /** @param {SourceRt} rt */
  runFetch (rt) {
    if (rt.stopped || !rt.entry?.meta?.hasFetch) return Promise.resolve()
    if (rt.running) return rt.running
    clearTimeout(rt.timer)
    const timeout = this.timeoutOf(rt)
    const host = rt.entry.host
    rt.running = (async () => {
      const started = Date.now()
      try {
        const res = await host.call('fetch', { sourceId: rt.id, timeout }, timeout + 5000)
        if (rt.stopped) return
        rt.failures = 0
        this.applyResult(rt, res)
      } catch (err) {
        if (rt.stopped) return
        rt.failures++
        rt.error = this.clean(err)
        this.log.warn(`[${rt.id}] ${rt.error}`)
        this.emitSourceTiles(rt)
      } finally {
        rt.lastRun = started
        rt.durationMs = Date.now() - started
        rt.running = null
        if (!rt.stopped) this.scheduleFetch(rt)
      }
    })()
    return rt.running
  }

  /** @param {SourceRt} rt */
  scheduleFetch (rt) {
    clearTimeout(rt.timer)
    const base = this.intervalOf(rt)
    const eff = this.active ? base : Math.max(base, this.config?.settings.idleInterval ?? base)
    const delay = rt.failures ? Math.min(eff * 2 ** (rt.failures - 1), Math.max(eff, MAX_BACKOFF)) : eff
    rt.nextRun = Date.now() + delay
    rt.timer = setTimeout(() => this.runFetch(rt), Math.min(delay, MAX_TIMER))
  }

  /** @param {SourceRt} rt */
  async runDerive (rt) {
    if (rt.stopped || !rt.entry?.meta) return
    try {
      const res = await rt.entry.host.call('derive', { sourceId: rt.id }, 15_000)
      if (!rt.stopped) this.applyResult(rt, res)
    } catch (err) {
      rt.error = this.clean(err)
      this.emitSourceTiles(rt)
    }
  }

  /** @param {SourceRt} rt @param {{ data: any, derived: any }} res */
  applyResult (rt, res) {
    rt.data = res.data
    rt.derived = res.derived
    rt.error = null
    rt.lastOk = Date.now()
    if (this.config) {
      for (const t of Object.values(this.config.tiles)) {
        if (t.graph && t.source === rt.id) this.history.record(t.id, res.derived.views?.[t.id]?.view, t.graph)
      }
    }
    if (rt.entry?.meta?.hasAlerts) {
      if (res.derived.alertsError) this.log.warn(`[${rt.id}] alerts(): ${this.clean(res.derived.alertsError)}`)
      if (this.alerts.set(rt.id, rt.def.name, res.derived.alerts)) this.emitAlerts()
    }
    this.emitSourceTiles(rt)
  }

  /** @param {SourceRt} rt */
  startStream (rt) {
    if (rt.stopped || rt.streamOn || !rt.entry?.meta?.hasStream) return
    rt.streamOn = true
    clearTimeout(rt.streamRetry)
    rt.entry.host.startStream(rt.id).catch(err => {
      rt.streamOn = false
      rt.streamError = this.clean(err)
      this.retryStream(rt)
    })
  }

  /** @param {SourceRt} rt */
  stopStream (rt) {
    rt.streamOn = false
    clearTimeout(rt.streamRetry)
    rt.entry?.host.stopStream(rt.id)
  }

  /** @param {string} sourceId @param {{ error?: string, aborted?: boolean }} info */
  onStreamEnd (sourceId, info) {
    const rt = this.sources.get(sourceId)
    if (!rt) return
    rt.streamOn = false
    if (info.aborted || rt.stopped) return
    rt.streamError = info.error ? this.clean(info.error) : 'stream ended'
    this.log.warn(`[${rt.id}] stream: ${rt.streamError}`)
    if (!rt.entry?.meta?.hasFetch) {
      rt.error = rt.streamError
      this.emitSourceTiles(rt)
    }
    this.retryStream(rt)
  }

  /** @param {SourceRt} rt */
  retryStream (rt) {
    if (rt.stopped || !(this.active || rt.entry?.meta?.keepStreaming)) return
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(rt.streamFailures++, 6))
    rt.streamRetry = setTimeout(() => this.startStream(rt), delay)
  }

  /** @param {SourceRt} rt */
  setupJobs (rt) {
    const meta = rt.entry?.meta
    if (!meta) return
    const history = this.store.get(`jobs/${rt.id}`, {})
    for (const [name, job] of Object.entries(meta.jobs)) {
      const override = rt.def.jobs[name] ?? {}
      if (override.enabled === false) continue
      const expr = override.schedule ?? job.schedule
      /** @type {Job} */
      const j = {
        name, expr, schedule: parseSchedule(expr), timeout: job.timeout ?? 300_000, refresh: job.refresh,
        timer: null, nextRun: null, lastRun: history[name]?.at ?? null, lastError: history[name]?.error ?? null,
        durationMs: history[name]?.durationMs ?? null, running: false
      }
      rt.jobs.set(name, j)
      const missed = !j.lastRun || nextRun(j.schedule, new Date(j.lastRun)).getTime() <= Date.now()
      this.scheduleJobAt(rt, j, missed ? Date.now() + 1000 : nextRun(j.schedule).getTime())
    }
  }

  /** @param {SourceRt} rt @param {Job} j @param {number} at */
  scheduleJobAt (rt, j, at) {
    if (j.timer) clearTimeout(j.timer)
    j.nextRun = at
    const delay = Math.max(0, at - Date.now())
    j.timer = setTimeout(() => delay > MAX_TIMER ? this.scheduleJobAt(rt, j, at) : this.runJob(rt, j), Math.min(delay, MAX_TIMER))
  }

  /** @param {SourceRt} rt @param {Job} j */
  async runJob (rt, j) {
    if (rt.stopped || j.running || !rt.entry?.meta) return
    j.running = true
    const started = Date.now()
    try {
      await rt.entry.host.call('job', { sourceId: rt.id, name: j.name, timeout: j.timeout }, j.timeout + 5000)
      j.lastError = null
    } catch (err) {
      j.lastError = this.clean(err)
      this.log.warn(`[${rt.id}] job ${j.name}: ${j.lastError}`)
    } finally {
      j.running = false
      j.lastRun = started
      j.durationMs = Date.now() - started
      const history = this.store.get(`jobs/${rt.id}`, {})
      this.store.set(`jobs/${rt.id}`, { ...history, [j.name]: { at: j.lastRun, error: j.lastError, durationMs: j.durationMs } })
    }
    if (rt.stopped) return
    this.scheduleJobAt(rt, j, nextRun(j.schedule).getTime())
    if (j.refresh && !j.lastError) {
      if (rt.entry.meta.hasFetch) await this.runFetch(rt)
      else await this.runDerive(rt)
    }
  }

  /** @param {boolean} active true while at least one browser is connected */
  setActive (active) {
    if (active === this.active) return
    this.active = active
    for (const rt of this.sources.values()) {
      const meta = rt.entry?.meta
      if (!meta || rt.stopped) continue
      if (active) {
        clearTimeout(rt.idleStreamTimer)
        if (meta.hasFetch && !rt.running) {
          const base = this.intervalOf(rt)
          const age = Date.now() - (rt.lastRun ?? 0)
          if (age >= base) this.runFetch(rt)
          else {
            clearTimeout(rt.timer)
            rt.nextRun = Date.now() + base - age
            rt.timer = setTimeout(() => this.runFetch(rt), base - age)
          }
        }
        if (meta.hasStream) this.startStream(rt)
      } else if (meta.hasStream && !meta.keepStreaming) {
        rt.idleStreamTimer = setTimeout(() => this.stopStream(rt), IDLE_STREAM_GRACE)
      }
    }
  }

  /** @param {SourceRt} rt */
  emitSourceTiles (rt) {
    if (!this.config) return
    for (const tile of Object.values(this.config.tiles)) {
      if (tile.source === rt.id || tile.status?.source === rt.id) this.updateTile(tile)
    }
  }

  emitAlerts () {
    if (!this.config) return
    for (const tile of Object.values(this.config.tiles)) if (tile.source === ALERTS_SOURCE) this.updateTile(tile)
  }

  /** @param {import('../config/load.js').Tile} tile */
  computeTile (tile) {
    /** @type {TileState} */
    const st = { id: tile.id, view: null, error: null, stale: false, loading: false, status: null }
    const sourceError = tile.source ? this.config?.sources[tile.source]?.configError : undefined
    if (tile.configError || sourceError) {
      st.error = `config error: ${tile.configError ?? sourceError}`
    } else if (tile.source === ALERTS_SOURCE) {
      st.view = this.alerts.view()
    } else if (tile.source) {
      const rt = this.sources.get(tile.source)
      if (!rt) {
        st.error = 'source is disabled'
      } else {
        const d = rt.derived?.views?.[tile.id]
        st.view = d?.view ?? null
        st.error = d?.error ? this.clean(d.error) : rt.error
        st.stale = !!rt.error && rt.derived !== undefined
        st.loading = rt.derived === undefined && !rt.error
      }
    }
    if (tile.graph) st.point = this.history.last(tile.id)
    if (tile.status) {
      const s = this.sources.get(tile.status.source)
      st.status = s?.derived?.statuses?.[tile.id] ?? (s?.error ? { state: 'unknown', label: s.error } : null)
    }
    return st
  }

  /** @param {import('../config/load.js').Tile} tile */
  updateTile (tile) {
    const st = this.computeTile(tile)
    const sig = JSON.stringify(st)
    if (this.tileSigs.get(tile.id) === sig) return
    this.tileSigs.set(tile.id, sig)
    this.tileStates.set(tile.id, st)
    this.emit('tile', st)
  }

  snapshot () {
    return [...this.tileStates.values()]
  }

  /** @param {string} tileId */
  async refreshTile (tileId) {
    const tile = this.config?.tiles[tileId]
    if (!tile) throw new HttpStatusError(404, `unknown tile "${tileId}"`)
    const ids = tile.source === ALERTS_SOURCE
      ? [...this.sources.values()].filter(rt => rt.entry?.meta?.hasAlerts).map(rt => rt.id)
      : [tile.source, tile.status?.source].filter(Boolean)
    await Promise.all(ids.map(id => {
      const rt = this.sources.get(/** @type {string} */ (id))
      return rt ? (rt.entry?.meta?.hasFetch ? this.runFetch(rt) : this.runDerive(rt)) : null
    }))
    return this.tileStates.get(tileId) ?? null
  }

  /** @param {string} tileId @param {string} action @param {any} input */
  async runAction (tileId, action, input) {
    const tile = this.config?.tiles[tileId]
    if (!tile) throw new HttpStatusError(404, `unknown tile "${tileId}"`)
    if (tile.source === ALERTS_SOURCE) {
      if (action === 'dismiss') {
        if (!this.alerts.dismiss(String(input?.key))) throw new HttpStatusError(404, 'alert not found')
        this.emitAlerts()
        return { ok: true, result: null }
      }
      if (action === 'run') {
        const found = this.alerts.find(String(input?.key))
        if (!found) throw new HttpStatusError(404, 'alert not found')
        return await this.callAction(found.sourceId, String(input?.name), input?.input)
      }
      throw new HttpStatusError(400, `unknown alerts action "${action}"`)
    }
    if (!tile.source) throw new HttpStatusError(400, 'this tile has no source')
    return await this.callAction(tile.source, action, input)
  }

  /** @param {string} sourceId @param {string} name @param {any} input */
  async callAction (sourceId, name, input) {
    const rt = this.sources.get(sourceId)
    const entry = rt?.entry
    const meta = entry?.meta
    if (!rt || !entry || !meta) throw new HttpStatusError(404, `source "${sourceId}" is not running`)
    if (!meta.actions[name]) throw new HttpStatusError(400, `plugin "${rt.def.plugin}" has no action "${name}"`)
    const timeout = this.timeoutOf(rt)
    let res
    try {
      res = await entry.host.call('action', { sourceId, name, input, timeout }, timeout + 5000)
    } catch (err) {
      throw new HttpStatusError(502, this.clean(err))
    }
    if (meta.hasFetch) this.runFetch(rt)
    else this.runDerive(rt)
    return { ok: true, result: redact(res.result, this.secrets) }
  }

  /** @param {string} sourceId @param {string} name */
  async runJobNow (sourceId, name) {
    const rt = this.sources.get(sourceId)
    const j = rt?.jobs.get(name)
    if (!rt || !j) throw new HttpStatusError(404, `no job "${name}" on source "${sourceId}"`)
    await this.runJob(rt, j)
    return { ok: !j.lastError, error: j.lastError }
  }

  /** @param {{ data?: boolean, source?: string }} [o] */
  debug (o = {}) {
    const now = Date.now()
    return [...this.sources.values()].filter(rt => !o.source || rt.id === o.source).map(rt => ({
      id: rt.id,
      plugin: rt.def.plugin,
      interval: rt.entry?.meta?.hasFetch ? this.intervalOf(rt) : null,
      lastRun: iso(rt.lastRun),
      lastOk: iso(rt.lastOk),
      nextRunIn: rt.nextRun ? Math.max(0, rt.nextRun - now) : null,
      durationMs: rt.durationMs,
      failures: rt.failures,
      error: rt.error,
      stream: rt.entry?.meta?.hasStream ? { on: rt.streamOn, error: rt.streamError } : null,
      jobs: [...rt.jobs.values()].map(j => ({ name: j.name, schedule: j.expr, lastRun: iso(j.lastRun), nextRun: iso(j.nextRun), durationMs: j.durationMs, error: j.lastError, running: j.running })),
      tiles: rt.tiles.map(t => t.id),
      ...(o.data ? { data: redact(rt.data, this.secrets) } : {})
    }))
  }

  async stop () {
    await this.applying
    for (const rt of this.sources.values()) await this.stopSource(rt)
    this.sources.clear()
    this.history.flush()
    this.store.flush()
  }
}

/** @param {number | null} t */
function iso (t) {
  return t ? new Date(t).toISOString() : null
}

/** @template T @param {Map<string, T[]>} map @param {string} key @param {T} value */
function push (map, key, value) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
