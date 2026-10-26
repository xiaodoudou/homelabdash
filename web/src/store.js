import { reactive, shallowReactive, ref } from 'vue'
import { isEmpty } from './views.js'

/**
 * @typedef {{ id: string, view: any, error: string | null, stale: boolean, loading: boolean, status: { state: string, label?: string } | null, point?: Record<string, [number, number]> }} TileState
 * @typedef {Record<string, { t: number[], v: number[] }>} TileHistory
 */

// The width under which the stylesheet stacks merged cards; the header then has room for one alert chip.
const PHONE = matchMedia('(max-width: 640px)')

export const state = reactive({
  /** @type {any} */
  dash: null,
  page: pageFromHash(),
  /** @type {'connecting' | 'live' | 'offline'} */
  conn: 'connecting',
  /** @type {any[]} */
  errors: [],
  /** @type {{ text: string, tone: string } | null} */
  toast: null,
  /** @type {string | null} header tile whose full list is open */
  openTop: null,
  phone: PHONE.matches,
  /** bumped on every tile change, so the layout knows to measure again */
  version: 0
})

/** Tile states by id, replaced whole on each update. @type {Map<string, TileState>} */
export const tiles = shallowReactive(new Map())
/** Graph history by tile id, seeded by hello and extended by live points. @type {Map<string, TileHistory>} */
export const history = shallowReactive(new Map())
/** Actions waiting for their result, as "tile:action:input". */
export const pending = reactive(new Set())
/** Lists showing all their rows instead of `limit`. */
export const expanded = reactive(new Set())
/** Ticks every 30 s, for what moves without new data: the clock, "5m ago", uptimes. */
export const minute = ref(0)

/** @type {Map<string, any>} tile definitions from /api/dashboard, by id */
export const defs = new Map()

/** Every column, group and tile position the layout computed; see arrange.js. */
export const layout = reactive({
  C: 24,
  /** @type {Record<string, string>} */
  groups: {},
  /** @type {Record<string, string>} */
  tiles: {},
  /** @type {Record<string, { cols: number, wrapped: boolean }>} */
  stats: {}
})

/** @type {WebSocket | null} */
let ws = null
let retry = 0
let seq = 0
let lastSeen = 0
/** @type {Map<number, (msg: any) => void>} */
const waiting = new Map()
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer

function pageFromHash () {
  return location.hash.replace(/^#\/?/, '')
}

/** Starts loading, the WebSocket and the listeners that keep the page current. Called once by the app. */
export function start () {
  load()
  connect()
  window.addEventListener('hashchange', () => { state.page = pageFromHash() })
  document.addEventListener('click', e => { if (state.openTop && !(/** @type {Element} */ (e.target)).closest?.('.top-chips')) state.openTop = null })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') state.openTop = null })
  PHONE.addEventListener('change', () => { state.phone = PHONE.matches })
  setInterval(() => watchdog(false), 10_000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) watchdog(true) })
  window.addEventListener('online', () => watchdog(true))
  setInterval(() => { minute.value++ }, 30_000)
}

export async function load () {
  try {
    const r = await fetch('/api/dashboard', { cache: 'no-store' })
    if (r.status === 401) { location.reload(); return }
    const dash = await r.json()
    const root = document.documentElement
    root.dataset.theme = dash.theme ?? 'auto'
    root.dataset.density = dash.density ?? 'comfortable'
    if (dash.accent) root.style.setProperty('--accent', dash.accent)
    document.title = dash.title ?? 'homelabdash'
    defs.clear()
    for (const p of dash.pages) {
      for (const s of p.sections) {
        for (const t of [...s.tiles, ...(s.groups ?? []).flatMap((/** @type {any} */ g) => g.tiles)]) {
          defs.set(t.id, t)
          if (t.widget) import(/* @vite-ignore */ t.widget).catch(() => {})
        }
      }
    }
    state.errors = dash.configErrors ?? []
    state.dash = dash
    state.version++
  } catch {
    setTimeout(load, 2000)
  }
}

function connect () {
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`)
  ws = socket
  socket.onopen = () => { retry = 0; lastSeen = Date.now(); state.conn = 'live' }
  socket.onclose = () => {
    lost()
    setTimeout(connect, Math.min(15_000, 500 * 2 ** retry++))
  }
  socket.onmessage = ev => {
    lastSeen = Date.now()
    receive(JSON.parse(ev.data))
  }
}

/** @param {any} msg */
export function receive (msg) {
  switch (msg.type) {
    case 'hello':
      tiles.clear()
      for (const t of msg.tiles) tiles.set(t.id, t)
      history.clear()
      for (const [id, h] of Object.entries(msg.history ?? {})) history.set(id, h)
      state.errors = msg.configErrors ?? []
      if (state.dash && msg.version !== state.dash.version) load()
      state.version++
      break
    case 'tiles':
      for (const t of msg.tiles) {
        tiles.set(t.id, t)
        if (t.point) addPoints(t.id, t.point)
      }
      state.version++
      break
    case 'dashboard':
      load()
      break
    case 'config-errors':
      state.errors = msg.errors
      break
    case 'assets': {
      const link = /** @type {HTMLLinkElement | null} */ (document.querySelector('link[data-custom]'))
      if (link && msg.file === 'custom.css') link.href = `/custom.css?v=${Date.now()}`
      if (msg.file === 'custom.js') location.reload()
      break
    }
    case 'result': {
      const done = waiting.get(msg.id)
      waiting.delete(msg.id)
      if (typeof done === 'function') done(msg)
    }
  }
}

function lost () {
  state.conn = 'offline'
  for (const [, done] of waiting) done({ ok: false, error: 'connection lost' })
  waiting.clear()
}

/**
 * Same bucketing as the server: one point per step, the newest value of a step wins.
 * Each change replaces the series, so the graphs showing it redraw.
 * @param {string} tileId @param {Record<string, [number, number]>} point
 */
export function addPoints (tileId, point) {
  const step = state.dash?.history?.step ?? 10_000
  const window = state.dash?.history?.window ?? 3_600_000
  /** @type {TileHistory} */
  const tile = { ...history.get(tileId) }
  for (const [label, [t, v]] of Object.entries(point)) {
    const s = tile[label] ?? { t: [], v: [] }
    const last = s.t.length - 1
    if (last >= 0 && s.t[last] === t) continue
    const ts = [...s.t]
    const vs = [...s.v]
    if (last >= 0 && Math.floor(ts[last] / step) === Math.floor(t / step)) {
      ts[last] = t
      vs[last] = v
    } else {
      ts.push(t)
      vs.push(v)
    }
    while (ts.length && ts[0] < t - window) { ts.shift(); vs.shift() }
    tile[label] = { t: ts, v: vs }
  }
  history.set(tileId, tile)
}

/**
 * A socket that died without a close (sleep, network switch) keeps the page frozen and the dot green:
 * ask the server for a pong when it has been quiet, and start over when nothing comes back.
 * @param {boolean} now check at once (tab shown again, network back)
 */
export function watchdog (now) {
  const socket = ws
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  const quiet = Date.now() - lastSeen
  if (quiet > 45_000) {
    // close() on a dead socket can take minutes to fire onclose, so drop it and reconnect now.
    socket.onclose = null
    socket.onmessage = null
    socket.close()
    lost()
    connect()
  } else if (now || quiet > 20_000) {
    send({ type: 'ping' })
  }
}

/** @param {any} body @returns {Promise<any>} */
export function send (body) {
  return new Promise(resolve => {
    if (ws?.readyState !== WebSocket.OPEN) return resolve({ ok: false, error: 'not connected' })
    const id = ++seq
    waiting.set(id, resolve)
    ws.send(JSON.stringify({ ...body, id }))
  })
}

/** @param {string} tile @param {string} action @param {unknown} input */
export function actionKey (tile, action, input) {
  return `${tile}:${action}:${JSON.stringify(input ?? null)}`
}

/** @param {string} tile @param {string} action @param {unknown} input */
export async function runAction (tile, action, input) {
  const key = actionKey(tile, action, input)
  pending.add(key)
  const r = await send({ type: 'action', tile, action, input })
  pending.delete(key)
  notify(r.ok ? 'Done' : r.error, r.ok ? 'ok' : 'error')
}

/** @param {string} tile */
export async function refresh (tile) {
  const r = await send({ type: 'refresh', tile })
  if (!r.ok) notify(r.error, 'error')
}

/** @param {string} text @param {string} tone */
export function notify (text, tone) {
  state.toast = { text, tone }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { state.toast = null }, 3500)
}

/** @param {string} id */
export function toggleExpanded (id) {
  if (!expanded.delete(id)) expanded.add(id)
  state.version++
}

/** @param {any} t */
export function isHidden (t) {
  const st = tiles.get(t.id)
  // Hidden until the first data too: these are usually empty, and showing them for a moment shifts the page.
  if (t.hideWhen === 'empty') return !st || st.loading || (!st.error && isEmpty(st.view))
  if (t.hideWhen === 'error') return !!st?.error
  return false
}

/** Visible tiles of a section; a band counts the tiles of its groups. @param {any} s */
export function visibleTiles (s) {
  return [...s.tiles, ...(s.groups ?? []).flatMap((/** @type {any} */ g) => g.tiles)].filter((/** @type {any} */ t) => !isHidden(t))
}
