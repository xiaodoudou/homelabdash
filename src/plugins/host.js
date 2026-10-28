import { Worker } from 'node:worker_threads'
import { EventEmitter } from 'node:events'

const WORKER_URL = new URL('./worker.js', import.meta.url)

/**
 * @typedef {object} PluginMeta
 * @property {string} [id]
 * @property {string} name
 * @property {string} version
 * @property {string} description
 * @property {number} [interval]
 * @property {number} [timeout]
 * @property {number} throttle
 * @property {boolean} keepStreaming
 * @property {object} config JSON Schema
 * @property {object} options JSON Schema
 * @property {Record<string, { title: string, description?: string, input?: object }>} actions
 * @property {Record<string, { schedule: string, timeout?: number, description?: string, refresh: boolean }>} jobs
 * @property {boolean} hasFetch
 * @property {boolean} hasStream
 * @property {boolean} hasRender
 * @property {boolean} hasAlerts
 * @property {boolean} hasStatus
 */

export class PluginError extends Error {
  /** @param {string} message @param {{ name?: string, status?: number }} [info] */
  constructor (message, info = {}) {
    super(message)
    this.name = info.name && info.name !== 'Error' ? info.name : 'PluginError'
    this.status = info.status
  }
}

/**
 * Runs one plugin in a worker thread and survives it crashing or hanging: the worker is
 * respawned and every source it served is configured again (and its stream restarted).
 */
export class PluginHost extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.id
   * @param {string} o.file
   * @param {string} o.dir
   * @param {string} [o.dataDir]
   * @param {string} [o.configDir]
   * @param {boolean | Record<string, any>} [o.fixtures]
   * @param {boolean} [o.capture]
   */
  constructor (o) {
    super()
    this.o = o
    /** @type {Worker | null} */
    this.worker = null
    /** @type {PluginMeta | null} */
    this.meta = null
    /** @type {Promise<PluginMeta> | null} */
    this.starting = null
    this.seq = 0
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, timer: NodeJS.Timeout | null }>} */
    this.pending = new Map()
    /** @type {Map<string, any>} configure args per source, replayed after a respawn */
    this.configured = new Map()
    /** @type {Set<string>} */
    this.streaming = new Set()
    this.crashes = 0
    this.stopped = false
  }

  /** @returns {Promise<PluginMeta>} */
  start () {
    if (this.worker && this.meta) return Promise.resolve(this.meta)
    if (this.starting) return this.starting
    this.stopped = false
    this.starting = new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_URL, {
        workerData: { file: this.o.file, pluginDir: this.o.dir, dataDir: this.o.dataDir, configDir: this.o.configDir, fixtures: this.o.fixtures, capture: this.o.capture },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
        stdout: false,
        stderr: false
      })
      let ready = false
      const timer = setTimeout(() => {
        if (ready) return
        worker.terminate()
        reject(new PluginError(`plugin "${this.o.id}" did not load within 15s`))
      }, 15_000)
      worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          ready = true
          clearTimeout(timer)
          this.worker = worker
          this.meta = msg.meta
          resolve(msg.meta)
        } else if (msg.type === 'fatal') {
          clearTimeout(timer)
          reject(new PluginError(msg.error.message, msg.error))
        } else {
          this.onMessage(msg)
        }
      })
      worker.on('error', (err) => {
        const message = err instanceof Error ? err.message : String(err)
        if (!ready) { clearTimeout(timer); reject(new PluginError(message)) } else this.emit('log', 'error', null, `worker error: ${message}`)
      })
      worker.on('exit', (code) => {
        if (this.worker !== worker) return
        this.worker = null
        this.starting = null
        for (const [, p] of this.pending) {
          if (p.timer) clearTimeout(p.timer)
          p.reject(new PluginError(`plugin "${this.o.id}" worker exited (code ${code})`))
        }
        this.pending.clear()
        if (!this.stopped) this.respawn()
      })
    })
    this.starting.catch(() => { this.starting = null })
    return this.starting
  }

  /** @param {any} msg */
  onMessage (msg) {
    switch (msg.type) {
      case 'result': {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (p.timer) clearTimeout(p.timer)
        if (msg.ok) p.resolve(msg.value)
        else p.reject(new PluginError(msg.error.message, msg.error))
        return
      }
      case 'update': this.emit('update', msg.sourceId, msg); return
      case 'stream-end':
        this.streaming.delete(msg.sourceId)
        this.emit('stream-end', msg.sourceId, msg)
        return
      case 'state':
        if (this.configured.has(msg.sourceId)) this.configured.get(msg.sourceId).state = msg.state
        this.emit('state', msg.sourceId, msg.state)
        return
      case 'log': this.emit('log', msg.level, msg.sourceId ?? null, msg.msg); return
      case 'refresh': this.emit('refresh', msg.sourceId)
    }
  }

  respawn () {
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.crashes++, 5))
    this.emit('log', 'warn', null, `plugin "${this.o.id}" worker stopped, restarting in ${delay / 1000}s`)
    setTimeout(() => {
      if (this.stopped) return
      this.start().then(() => this.replay()).then(() => { this.crashes = 0 }).catch(err => {
        this.emit('log', 'error', null, `plugin "${this.o.id}" failed to restart: ${err.message}`)
        if (!this.stopped) this.respawn()
      })
    }, delay).unref()
  }

  async replay () {
    const streams = [...this.streaming]
    this.streaming.clear()
    for (const [sourceId, args] of this.configured) await this.call('configure', { sourceId, ...args })
    for (const sourceId of streams) await this.startStream(sourceId)
    this.emit('restarted')
  }

  /**
   * @param {string} method
   * @param {any} args
   * @param {number} [hardTimeout] the worker is killed and respawned past this
   */
  async call (method, args, hardTimeout) {
    if (!this.worker) await this.start()
    const worker = /** @type {Worker} */ (this.worker)
    const id = ++this.seq
    return await new Promise((resolve, reject) => {
      const timer = hardTimeout
        ? setTimeout(() => {
          this.pending.delete(id)
          reject(new PluginError(`plugin "${this.o.id}" did not answer ${method} within ${Math.round(hardTimeout / 1000)}s; its worker was restarted`))
          worker.terminate()
        }, hardTimeout)
        : null
      this.pending.set(id, { resolve, reject, timer })
      worker.postMessage({ type: 'call', id, method, args })
    })
  }

  /** @param {string} sourceId @param {{ config: any, tiles: any[], statusKeys: any[], state: any }} args */
  async configure (sourceId, args) {
    this.configured.set(sourceId, { ...args })
    await this.call('configure', { sourceId, ...args }, 10_000)
  }

  /** @param {string} sourceId */
  async startStream (sourceId) {
    if (this.streaming.has(sourceId)) return
    this.streaming.add(sourceId)
    await this.call('startStream', { sourceId }, 10_000)
  }

  /** @param {string} sourceId */
  async stopStream (sourceId) {
    if (!this.streaming.delete(sourceId) || !this.worker) return
    await this.call('stopStream', { sourceId }, 10_000).catch(() => {})
  }

  /** @param {string} sourceId */
  async remove (sourceId) {
    this.configured.delete(sourceId)
    this.streaming.delete(sourceId)
    if (this.worker) await this.call('remove', { sourceId }, 10_000).catch(() => {})
  }

  get sources () { return this.configured.size }

  async stop () {
    this.stopped = true
    const w = this.worker
    this.worker = null
    this.starting = null
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new PluginError(`plugin "${this.o.id}" stopped`))
    }
    this.pending.clear()
    if (w) await w.terminate()
  }
}
