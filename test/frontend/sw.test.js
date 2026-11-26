import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const SOURCE = fs.readFileSync(path.resolve('web/public/sw.js'), 'utf8')
const ORIGIN = 'https://dash.example'

/** @param {any} k */
const keyOf = k => typeof k === 'string' ? k : new URL(k.url).pathname + new URL(k.url).search

/** Runs sw.js against a fake worker global, cache and network; returns a function that fetches through it. */
function worker (/** @type {(req: any) => Promise<Response>} */ net) {
  /** @type {Map<string, Response>} */
  const store = new Map()
  const cache = {
    match: async (/** @type {any} */ k) => store.get(keyOf(k))?.clone(),
    put: async (/** @type {any} */ k, /** @type {Response} */ r) => { store.set(keyOf(k), r) },
    keys: async () => [...store.keys()].map(p => ({ url: ORIGIN + p })),
    delete: async (/** @type {any} */ k) => store.delete(keyOf(k))
  }
  /** @type {Record<string, Function>} */
  const on = {}
  const self = { location: { origin: ORIGIN }, addEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => { on[t] = f }, skipWaiting () {}, clients: { claim () {} } }
  new Function('self', 'caches', 'fetch', SOURCE)(self, { open: async () => cache }, net)
  /** @param {string} path @param {string} [mode] @returns {Promise<Response> | undefined} */
  const get = (path, mode = 'cors') => {
    let out
    on.fetch({ request: { method: 'GET', url: ORIGIN + path, mode }, respondWith: (/** @type {any} */ p) => { out = p } })
    return out
  }
  return { get, store }
}

const page = (/** @type {string} */ body) => new Response(body, { status: 200 })

beforeEach(() => { vi.useRealTimers() })

describe('service worker', () => {
  it('serves the page from the server and keeps a copy', async () => {
    const w = worker(async () => page('<script src="/assets/a.js">'))
    const res = await w.get('/', 'navigate')
    expect(await res?.text()).toContain('/assets/a.js')
    expect(w.store.has('/')).toBe(true)
  })

  it('falls back to the copy when the proxy answers 502 or the network fails', async () => {
    let down = false
    const w = worker(async () => {
      if (down) throw new TypeError('network')
      return page('cached page')
    })
    await w.get('/', 'navigate')
    down = true
    expect(await (await w.get('/', 'navigate'))?.text()).toBe('cached page')

    const proxy = worker(async () => new Response('bad gateway', { status: 502 }))
    proxy.store.set('/api/dashboard', page('{"pages":[]}'))
    expect(await (await proxy.get('/api/dashboard'))?.text()).toBe('{"pages":[]}')
  })

  it('shows the copy after 4 s when the server accepts the request but never answers', async () => {
    vi.useFakeTimers()
    const w = worker(() => new Promise(() => {}))
    w.store.set('/api/dashboard', page('old layout'))
    const res = w.get('/api/dashboard')
    await vi.advanceTimersByTimeAsync(4000)
    expect(await (await res)?.text()).toBe('old layout')
  })

  it('passes a 401 through, so the login prompt still shows', async () => {
    const w = worker(async () => new Response('', { status: 401 }))
    w.store.set('/', page('cached page'))
    expect((await w.get('/', 'navigate'))?.status).toBe(401)
  })

  it('leaves the WebSocket, actions and other origins alone, and drops assets the new page no longer loads', async () => {
    const w = worker(async () => page('<script src="/assets/new.js">'))
    expect(w.get('/api/ws')).toBeUndefined()
    expect(w.get('/api/state')).toBeUndefined()
    w.store.set('/assets/old.js', page('old'))
    await w.get('/', 'navigate')
    expect(w.store.has('/assets/old.js')).toBe(false)
  })
})
