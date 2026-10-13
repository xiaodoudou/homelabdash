import { parentPort, workerData } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { createIO, loadFixtures } from './io.js'
import { parseDuration } from '../util.js'
import { parseSchedule } from '../runtime/cron.js'
import { viewError } from '../views/schema.js'
import { installResolveHooks } from './resolve-hooks.js'

/**
 * One worker per plugin. The main thread sends `call` messages; this side owns each source's
 * config, state, latest data and stream, and posts `update`, `state`, `log` and `stream-end` events.
 */

const port = /** @type {import('node:worker_threads').MessagePort} */ (parentPort)
const { file, pluginDir, dataDir, configDir, fixtures: fx, capture } = workerData
const fixtures = fx === true ? loadFixtures(pluginDir) : (fx ?? null)

/** @type {Record<string, any>} */
let captured = {}
const io = createIO({
  fixtures,
  onCapture: capture ? (key, entry) => { captured[key] = entry } : null,
  dataDir,
  configDir,
  log: (level, msg) => post({ type: 'log', level, msg })
})


/**
 * @typedef {object} Src
 * @property {string} id
 * @property {Record<string, any>} config
 * @property {{ id: string, options: Record<string, any> }[]} tiles
 * @property {{ tileId: string, key: string }[]} statusKeys
 * @property {Record<string, any>} state
 * @property {any} data
 * @property {AbortController | null} stream
 * @property {NodeJS.Timeout | null} stateTimer
 * @property {NodeJS.Timeout | null} renderTimer
 * @property {number} lastRender
 */

/** @type {Map<string, Src>} */
const sources = new Map()

/** @param {any} msg */
function post (msg) {
  try {
    port.postMessage(msg)
  } catch (err) {
    port.postMessage({ type: 'log', level: 'error', sourceId: msg.sourceId, msg: `could not send ${msg.type} to the main thread: ${errorText(err)} (plugin data must be plain JSON-like values)` })
  }
}

/** @param {unknown} err */
function errorText (err) {
  return err instanceof Error ? err.message : String(err)
}

/** @param {unknown} err */
function serializeError (err) {
  const e = /** @type {any} */ (err)
  return { message: errorText(err), name: e?.name, status: e?.status }
}

/** @param {any} p */
function describe (p) {
  if (!p || typeof p !== 'object') throw new Error('the module must `export default` a plugin object')
  for (const fn of ['fetch', 'stream', 'render', 'alerts', 'status']) {
    if (p[fn] !== undefined && typeof p[fn] !== 'function') throw new Error(`\`${fn}\` must be a function`)
  }
  if (!p.fetch && !p.stream && !p.jobs) throw new Error('a plugin needs at least one of fetch(), stream() or jobs')
  /** @type {Record<string, any>} */
  const actions = {}
  for (const [name, a] of Object.entries(p.actions ?? {})) {
    if (typeof a?.run !== 'function') throw new Error(`actions.${name}.run must be a function`)
    actions[name] = { title: a.title ?? name, description: a.description, input: a.input }
  }
  /** @type {Record<string, any>} */
  const jobs = {}
  for (const [name, j] of Object.entries(p.jobs ?? {})) {
    if (typeof j?.run !== 'function') throw new Error(`jobs.${name}.run must be a function`)
    if (typeof j.schedule !== 'string') throw new Error(`jobs.${name}.schedule must be a cron expression or a duration`)
    parseSchedule(j.schedule)
    jobs[name] = { schedule: j.schedule, timeout: parseDuration(j.timeout), description: j.description, refresh: j.refresh !== false }
  }
  return {
    id: p.id,
    name: p.name ?? p.id,
    version: p.version ?? '0.0.0',
    description: p.description ?? '',
    interval: parseDuration(p.interval),
    timeout: parseDuration(p.timeout),
    throttle: parseDuration(p.throttle) ?? 250,
    keepStreaming: !!p.keepStreaming,
    config: p.config ?? { type: 'object' },
    options: p.options ?? { type: 'object' },
    actions,
    jobs,
    examples: Array.isArray(p.examples) ? p.examples : [],
    hasFetch: typeof p.fetch === 'function',
    hasStream: typeof p.stream === 'function',
    hasRender: typeof p.render === 'function',
    hasAlerts: typeof p.alerts === 'function',
    hasStatus: typeof p.status === 'function'
  }
}

/** @type {any} */
let plugin
let throttleMs = 250
try {
  await installResolveHooks()
  const mod = await import(pathToFileURL(file).href)
  plugin = mod.default ?? mod
  const meta = describe(plugin)
  throttleMs = meta.throttle
  port.postMessage({ type: 'ready', meta: JSON.parse(JSON.stringify(meta)) })
} catch (err) {
  port.postMessage({ type: 'fatal', error: serializeError(err) })
  process.exit(1)
}

/** @param {Src} src @param {AbortSignal} [signal] */
function makeCtx (src, signal) {
  const helpers = io(signal)
  const logAt = (/** @type {string} */ level) => (/** @type {unknown[]} */ ...args) =>
    post({ type: 'log', level, sourceId: src.id, msg: args.map(a => typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a)).join(' ') })
  return {
    source: src.id,
    config: src.config,
    tiles: src.tiles,
    signal: signal ?? new AbortController().signal,
    get data () { return src.data },
    state: {
      /** @param {string} key @param {unknown} [fallback] */
      get: (key, fallback) => key in src.state ? structuredClone(src.state[key]) : fallback,
      /** @param {string} key @param {unknown} value */
      set: (key, value) => { src.state[key] = structuredClone(value); saveState(src) },
      /** @param {string} key */
      delete: (key) => { delete src.state[key]; saveState(src) },
      all: () => structuredClone(src.state)
    },
    log: { debug: logAt('debug'), info: logAt('info'), warn: logAt('warn'), error: logAt('error') },
    refresh: () => post({ type: 'refresh', sourceId: src.id }),
    ...helpers
  }
}

/** @param {Src} src */
function saveState (src) {
  if (src.stateTimer) return
  src.stateTimer = setTimeout(() => {
    src.stateTimer = null
    post({ type: 'state', sourceId: src.id, state: src.state })
  }, 50)
}

/** @param {any} view */
function checkView (view) {
  const problem = viewError(view)
  if (problem) throw new Error(problem)
  return view ?? null
}

const SEVERITIES = ['info', 'warning', 'error']

/** @param {any} list */
function checkAlerts (list) {
  if (list === null || list === undefined) return []
  if (!Array.isArray(list)) throw new Error('alerts() must return an array')
  return list.map((a, i) => {
    if (!a || typeof a.id !== 'string' || !a.id) throw new Error(`alerts()[${i}] needs a string id`)
    if (typeof a.message !== 'string' && typeof a.title !== 'string') throw new Error(`alerts()[${i}] needs a message or title`)
    return {
      id: a.id,
      severity: SEVERITIES.includes(a.severity) ? a.severity : 'warning',
      title: a.title,
      message: a.message,
      href: a.href,
      time: a.time,
      actions: Array.isArray(a.actions) ? a.actions.filter((/** @type {any} */ x) => x && plugin.actions?.[x.name]).map((/** @type {any} */ x) => ({ name: x.name, title: x.title ?? plugin.actions[x.name].title ?? x.name, input: x.input })) : []
    }
  })
}

const STATES = ['up', 'down', 'warn', 'unknown']

/** @param {any} s */
function checkStatus (s) {
  if (s === null || s === undefined) return { state: 'unknown', label: 'not found' }
  if (typeof s === 'string') return { state: STATES.includes(s) ? s : 'unknown' }
  return { state: STATES.includes(s.state) ? s.state : 'unknown', label: s.label }
}

/** @param {Src} src */
async function derive (src) {
  const ctx = makeCtx(src)
  /** @type {Record<string, { view?: any, error?: string }>} */
  const views = {}
  for (const t of src.tiles) {
    try {
      const view = plugin.render ? await plugin.render(src.data, t.options ?? {}, ctx) : src.data
      views[t.id] = { view: checkView(view) }
    } catch (err) {
      views[t.id] = { error: errorText(err) }
    }
  }
  /** @type {any[] | null} */
  let alerts = null
  let alertsError
  if (plugin.alerts) {
    try {
      alerts = checkAlerts(await plugin.alerts(src.data, ctx))
    } catch (err) {
      alertsError = errorText(err)
    }
  }
  /** @type {Record<string, any>} */
  const statuses = {}
  for (const sk of src.statusKeys) {
    try {
      statuses[sk.tileId] = plugin.status ? checkStatus(await plugin.status(src.data, sk.key, ctx)) : { state: 'unknown', label: 'plugin has no status()' }
    } catch (err) {
      statuses[sk.tileId] = { state: 'unknown', label: errorText(err) }
    }
  }
  return { views, alerts, alertsError, statuses }
}

/** @param {Src} src */
function scheduleRender (src) {
  if (src.renderTimer) return
  const wait = Math.max(0, src.lastRender + throttleMs - Date.now())
  src.renderTimer = setTimeout(async () => {
    src.renderTimer = null
    src.lastRender = Date.now()
    const derived = await derive(src)
    post({ type: 'update', sourceId: src.id, data: src.data, derived })
  }, wait)
}

/** @param {string} id */
function getSource (id) {
  const src = sources.get(id)
  if (!src) throw new Error(`source "${id}" is not configured in this worker`)
  return src
}

/** @param {number | undefined} ms */
function timeoutSignal (ms) {
  return AbortSignal.timeout(ms ?? 10_000)
}

/** @type {Record<string, (args: any) => Promise<any>>} */
const methods = {
  async configure ({ sourceId, config, tiles, statusKeys, state }) {
    const prev = sources.get(sourceId)
    const same = prev && JSON.stringify(prev.config) === JSON.stringify(config)
    if (prev && !same) prev.stream?.abort()
    sources.set(sourceId, {
      id: sourceId,
      config,
      tiles,
      statusKeys,
      state: same ? prev.state : (state ?? {}),
      data: same ? prev.data : undefined,
      stream: same ? prev.stream : null,
      stateTimer: null,
      renderTimer: null,
      lastRender: 0
    })
    return {}
  },

  async fetch ({ sourceId, timeout }) {
    const src = getSource(sourceId)
    captured = {}
    src.data = await plugin.fetch(makeCtx(src, timeoutSignal(timeout)))
    return { data: src.data, derived: await derive(src), captured: capture ? captured : undefined }
  },

  async derive ({ sourceId }) {
    return { data: getSource(sourceId).data, derived: await derive(getSource(sourceId)) }
  },

  async job ({ sourceId, name, timeout }) {
    const src = getSource(sourceId)
    const job = plugin.jobs?.[name]
    if (!job) throw new Error(`unknown job "${name}"`)
    const result = await job.run(makeCtx(src, timeoutSignal(timeout ?? 300_000)))
    return { result: result === undefined ? null : result }
  },

  async action ({ sourceId, name, input, timeout }) {
    const src = getSource(sourceId)
    const action = plugin.actions?.[name]
    if (!action) throw new Error(`unknown action "${name}"`)
    const result = await action.run(makeCtx(src, timeoutSignal(timeout)), input ?? {})
    return { result: result === undefined ? null : result }
  },

  async startStream ({ sourceId }) {
    const src = getSource(sourceId)
    if (src.stream || !plugin.stream) return {}
    const ac = new AbortController()
    src.stream = ac
    const emit = (/** @type {any} */ next) => {
      if (ac.signal.aborted) return
      src.data = typeof next === 'function' ? next(src.data) : next
      scheduleRender(src)
    }
    ;(async () => {
      let error
      try {
        await plugin.stream(makeCtx(src, ac.signal), emit)
      } catch (err) {
        if (!ac.signal.aborted) error = errorText(err)
      }
      if (src.stream === ac) src.stream = null
      post({ type: 'stream-end', sourceId, error, aborted: ac.signal.aborted })
    })()
    return {}
  },

  async stopStream ({ sourceId }) {
    sources.get(sourceId)?.stream?.abort()
    return {}
  },

  async remove ({ sourceId }) {
    const src = sources.get(sourceId)
    src?.stream?.abort()
    if (src?.renderTimer) clearTimeout(src.renderTimer)
    sources.delete(sourceId)
    return {}
  }
}

port.on('message', async (msg) => {
  if (msg?.type !== 'call') return
  const fn = methods[msg.method]
  try {
    if (!fn) throw new Error(`unknown method ${msg.method}`)
    const value = await fn(msg.args ?? {})
    try {
      port.postMessage({ type: 'result', id: msg.id, ok: true, value })
    } catch (err) {
      port.postMessage({ type: 'result', id: msg.id, ok: false, error: { message: `result is not serializable: ${errorText(err)} (return plain JSON-like data)` } })
    }
  } catch (err) {
    port.postMessage({ type: 'result', id: msg.id, ok: false, error: serializeError(err) })
  }
})
