import { describe, it, expect, vi, beforeEach } from 'vitest'

/** A WebSocket that the test opens, feeds and watches. */
class FakeSocket {
  static OPEN = 1
  /** @type {FakeSocket[]} */
  static all = []
  /** @param {string} url */
  constructor (url) {
    this.url = url
    this.readyState = 0
    /** @type {string[]} */
    this.sent = []
    this.closed = false
    /** @type {any} */ this.onopen = null
    /** @type {any} */ this.onclose = null
    /** @type {any} */ this.onmessage = null
    FakeSocket.all.push(this)
  }

  open () { this.readyState = 1; this.onopen?.() }
  /** @param {any} msg */
  message (msg) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  /** @param {string} data */
  send (data) { this.sent.push(data) }
  close () { this.closed = true }
}

/** A fresh store, with the WebSocket and fetch replaced. */
async function fresh () {
  vi.resetModules()
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ version: 1, pages: [], history: { step: 10_000, window: 3_600_000 } }) })))
  return await import('../../web/src/store.js')
}

beforeEach(() => { vi.useRealTimers() })

describe('store', () => {
  it('hello sets every tile and the history, tile updates replace one tile', async () => {
    const s = await fresh()
    s.receive({ type: 'hello', version: 1, tiles: [{ id: 'a', view: { type: 'text', text: 'one' } }], history: { a: { CPU: { t: [1], v: [5] } } } })
    expect(s.tiles.get('a').view.text).toBe('one')
    expect(s.history.get('a').CPU.v).toEqual([5])
    const before = s.state.version
    s.receive({ type: 'tiles', tiles: [{ id: 'a', view: { type: 'text', text: 'two' } }] })
    expect(s.tiles.get('a').view.text).toBe('two')
    expect(s.state.version).toBe(before + 1)
  })

  it('graph points: one per step, the newest of a step wins, old points leave the window', async () => {
    const s = await fresh()
    s.addPoints('a', { CPU: [100_000, 1] })
    s.addPoints('a', { CPU: [105_000, 2] })
    s.addPoints('a', { CPU: [112_000, 3] })
    expect(s.history.get('a').CPU).toEqual({ t: [105_000, 112_000], v: [2, 3] })
    s.addPoints('a', { CPU: [112_000 + 3_600_000 + 1, 4] })
    expect(s.history.get('a').CPU.v).toEqual([4])
  })

  it('hideWhen: empty keeps a tile hidden until it has something to show', async () => {
    const s = await fresh()
    const t = { id: 'plex', hideWhen: 'empty' }
    expect(s.isHidden(t)).toBe(true)
    s.tiles.set('plex', { id: 'plex', view: { type: 'list', items: [] } })
    expect(s.isHidden(t)).toBe(true)
    s.tiles.set('plex', { id: 'plex', view: { type: 'list', items: [{ title: 'Show' }] } })
    expect(s.isHidden(t)).toBe(false)
  })

  it('a socket quiet for 45 s is dropped and replaced; a quiet one before that gets a ping', async () => {
    vi.useFakeTimers()
    const s = await fresh()
    s.start()
    const first = FakeSocket.all[0]
    first.open()
    expect(s.state.conn).toBe('live')

    vi.advanceTimersByTime(25_000)
    s.watchdog(false)
    expect(first.sent.map(m => JSON.parse(m).type)).toEqual(['ping'])

    vi.advanceTimersByTime(25_000)
    s.watchdog(false)
    expect(first.closed).toBe(true)
    expect(FakeSocket.all).toHaveLength(2)
    expect(s.state.conn).toBe('offline')

    FakeSocket.all[1].open()
    expect(s.state.conn).toBe('live')
  })

  it('an action waits for its result and shows it', async () => {
    const s = await fresh()
    s.start()
    const ws = FakeSocket.all[0]
    ws.open()
    const done = s.runAction('sab', 'pause', null)
    expect(s.pending.has('sab:pause:null')).toBe(true)
    const { id } = JSON.parse(ws.sent[0])
    ws.message({ type: 'result', id, ok: true })
    await done
    expect(s.pending.size).toBe(0)
    expect(s.state.toast).toEqual({ text: 'Done', tone: 'ok' })
  })
})
