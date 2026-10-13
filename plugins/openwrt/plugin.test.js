import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runPlugin } from 'homelabdash/testing'
import plugin from './index.js'

const config = { url: 'http://router.example', username: 'root', password: 'test-password' }
const fixtures = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'http.json'), 'utf8'))
const DENIED = { body: { jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Access denied' } } }

/** @param {Record<string, any>} over */
const withFixtures = over => ({ ...fixtures, ...over })

test('wan, conntrack and system views', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config,
    tiles: [{ id: 'wan', options: { view: 'wan' } }, { id: 'ct', options: { view: 'conntrack' } }, { id: 'sys', options: { view: 'system' } }]
  })
  assert.deepEqual(r.views.wan.view.items.map((/** @type {any} */ i) => i.value), [864000, '192.0.2.10', 512000000000, 64000000000, null, null])
  assert.deepEqual(r.views.ct.view.items.map((/** @type {any} */ i) => i.value), [3200, 3200 / 65536 * 100])
  assert.deepEqual(r.views.sys.view.items.map((/** @type {any} */ i) => i.value), [0.5, 25, 864030])
  assert.deepEqual(r.data.system.load, [0.5, 0.4, 0.3])
  assert.equal(r.state.session, 'fixture-session-0001')
  assert.equal(r.state.counters.rx, 512000000000)
  assert.deepEqual(r.alerts, [])
})

test('rates from the previous counters in state', async () => {
  const counters = { device: 'pppoe-wan', rx: 512000000000 - 10_000_000, tx: 64000000000 - 1_000_000, at: Date.now() - 10_000 }
  const r = await runPlugin(import.meta.dirname, { config, state: { session: 'fixture-session-0001', counters } })
  const elapsed = (Date.now() - counters.at) / 1000
  const [down, up] = r.view.items.slice(4).map((/** @type {any} */ i) => i.value)
  assert.ok(down >= 10_000_000 / elapsed && down <= 1_000_000, `down ${down} over ${elapsed}s`)
  assert.ok(up >= 1_000_000 / elapsed && up <= 100_000, `up ${up} over ${elapsed}s`)
})

test('counters that went backwards give no rate', async () => {
  const counters = { device: 'pppoe-wan', rx: 600000000000, tx: 70000000000, at: Date.now() - 10_000 }
  const r = await runPlugin(import.meta.dirname, { config, state: { counters } })
  assert.equal(r.data.traffic.rxRate, null)
  assert.equal(r.state.counters.rx, 512000000000)
})

test('interface down raises wan-down', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config,
    fixtures: withFixtures({ 'POST /ubus?call=network.interface.wan.status': { body: { jsonrpc: '2.0', id: 2, result: [0, { up: false, pending: false, available: true, proto: 'pppoe', device: 'eth1', data: {} }] } } })
  })
  assert.deepEqual(r.view.items.slice(0, 2).map((/** @type {any} */ i) => [i.value, i.tone]), [['down', 'error'], [null, undefined]])
  assert.deepEqual(r.alerts.map(a => [a.id, a.severity]), [['wan-down', 'error']])
})

test('conntrack above the limit raises conntrack-high', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config: { ...config, conntrackAlertPercent: 85 },
    fixtures: withFixtures({ 'POST /ubus?call=file.read&path=/proc/sys/net/netfilter/nf_conntrack_count': { body: { jsonrpc: '2.0', id: 4, result: [0, { data: '60000\n' }] } } })
  })
  assert.deepEqual(r.alerts.map(a => [a.id, a.severity]), [['conntrack-high', 'warning']])
  assert.match(r.alerts[0].title ?? '', /92% full/)
})

test('conntrack refused by the ACL leaves the counters null', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config,
    options: { view: 'conntrack' },
    fixtures: withFixtures({ 'POST /ubus?call=file.read&path=/proc/sys/net/netfilter/nf_conntrack_max': { body: { jsonrpc: '2.0', id: 5, result: [6] } } })
  })
  assert.deepEqual([r.data.conntrack.count, r.data.conntrack.max], [null, null])
  assert.equal(r.view.type, 'text')
  assert.match(r.view.text, /rpcd ACL/)
})

test('conntrack off skips the file reads', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config: { ...config, conntrack: false },
    options: { view: 'conntrack' },
    fixtures: Object.fromEntries(Object.entries(fixtures).filter(([k]) => !k.includes('file.read')))
  })
  assert.equal(r.data.conntrack, null)
  assert.match(r.view.text, /off/)
})

test('wrong password is reported', async () => {
  await assert.rejects(
    runPlugin(import.meta.dirname, { config, fixtures: withFixtures({ 'POST /ubus?call=session.login': { body: { jsonrpc: '2.0', id: 1, result: [6] } } }) }),
    /login as "root" refused/
  )
})

test('unknown interface is reported', async () => {
  await assert.rejects(
    runPlugin(import.meta.dirname, { config: { ...config, interface: 'lte' }, fixtures: withFixtures({ 'POST /ubus?call=network.interface.lte.status': { body: { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'Object not found' } } } }) }),
    /no interface "lte"/
  )
})

// Fixtures answer the same way every time, so the expired-session sequence runs against a scripted ctx.
/**
 * @param {Record<string, any>} state
 * @param {(session: string, call: string) => any} [override] response for a call, or undefined for the fixture
 */
function scripted (state, override = () => undefined) {
  /** @type {{ session: string, call: string }[]} */
  const calls = []
  /** @type {Record<string, any>} */
  const store = { ...state }
  const ctx = {
    source: 'test',
    config: { ...config, interface: 'wan', conntrack: true, conntrackAlertPercent: 90, insecure: false },
    tiles: [],
    signal: new AbortController().signal,
    state: {
      get: (/** @type {string} */ k, /** @type {any} */ f) => k in store ? store[k] : f,
      set: (/** @type {string} */ k, /** @type {any} */ v) => { store[k] = v },
      delete: (/** @type {string} */ k) => { delete store[k] },
      all: () => store
    },
    log: { debug () {}, info () {}, warn () {}, error () {} },
    http: {
      json: async (/** @type {string} */ _url, /** @type {any} */ o) => {
        const call = new URLSearchParams(o.query).toString().replace(/%2F/g, '/')
        const session = o.json.params[0]
        calls.push({ session, call })
        return override(session, call) ?? fixtures[`POST /ubus?${call}`].body
      }
    }
  }
  return { ctx: /** @type {any} */ (ctx), calls, store }
}

for (const [what, answer] of [['error -32002', DENIED.body], ['result code 6', { jsonrpc: '2.0', id: 2, result: [6] }]]) {
  test(`expired session (${what}) logs in again once and retries`, async () => {
    const { ctx, calls, store } = scripted({ session: 'stale' }, session => session === 'stale' ? answer : undefined)
    const data = await plugin.fetch?.(ctx)
    assert.equal(data.interface.up, true)
    assert.equal(data.conntrack.count, 3200)
    assert.equal(store.session, 'fixture-session-0001')
    assert.deepEqual(calls.slice(0, 3).map(c => [c.session, c.call]), [
      ['stale', 'call=network.interface.wan.status'],
      ['00000000000000000000000000000000', 'call=session.login'],
      ['fixture-session-0001', 'call=network.interface.wan.status']
    ])
    assert.equal(calls.filter(c => c.call === 'call=session.login').length, 1)
  })
}

test('a denial that survives the new login fails after one retry', async () => {
  const { ctx, calls } = scripted({ session: 'stale' }, (_s, call) => call === 'call=network.interface.wan.status' ? DENIED.body : undefined)
  await assert.rejects(async () => plugin.fetch?.(ctx), /Access denied/)
  assert.equal(calls.filter(c => c.call === 'call=session.login').length, 1)
  assert.equal(calls.length, 3)
})

test('a denial after the session proved valid is the ACL, not a reason to log in', async () => {
  const { ctx, calls } = scripted({ session: 'valid' }, (_s, call) => call.startsWith('call=file.read') ? DENIED.body : undefined)
  const data = await plugin.fetch?.(ctx)
  assert.equal(data.conntrack.count, null)
  assert.match(data.conntrack.unavailable, /ACL/)
  assert.equal(calls.filter(c => c.call === 'call=session.login').length, 0)
})

test('no stored session logs in first', async () => {
  const { ctx, calls, store } = scripted({})
  await plugin.fetch?.(ctx)
  assert.equal(calls[0].call, 'call=session.login')
  assert.equal(store.session, 'fixture-session-0001')
})
