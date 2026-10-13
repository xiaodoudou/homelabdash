import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runPlugin } from 'homelabdash/testing'
import plugin from './index.js'

const fixtures = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'http.json'), 'utf8'))
const A = { name: 'Provider A', url: 'https://sub-a.example/api/v1/client/subscribe?token=test-token-a' }
const B = { name: 'Provider B', url: 'https://sub-b.example/clash/config?token=test-token-b' }

/** @param {number} expire */
const quota = expire => ({ headers: { 'subscription-userinfo': `upload=0; download=10737418240; total=107374182400; expire=${expire}` }, body: '' })

/** @param {number} sec */
function localDay (sec) {
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('one bar per subscription with percent and expiry', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { subscriptions: [A, B] } })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.label, i.value, i.max, i.format]), [
    ['Provider A', 1073741824 + 29001613312, 107374182400, 'bytes'],
    ['Provider B', 98784247808, 107374182400, 'bytes']
  ])
  assert.equal(r.view.items[0].detail, `28% - expires ${localDay(1893499200)}`)
  assert.equal(r.view.items[1].detail, '92%', 'an empty expire means no expiry')
})

test('stats view shows the used percent', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { subscriptions: [A, B] }, options: { view: 'stats' } })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.label, i.value, i.format]), [['Provider A', 28, 'percent'], ['Provider B', 92, 'percent']])
})

test('usage at or above the limit raises a warning', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { subscriptions: [A, B] } })
  assert.deepEqual(r.alerts.map(a => [a.id, a.severity]), [['usage:Provider B', 'warning']])
  assert.equal(r.alerts[0].message, '92.0 GB of 100 GB')
  const off = await runPlugin(import.meta.dirname, { config: { subscriptions: [A, B], usageAlertPercent: 0 } })
  assert.deepEqual(off.alerts, [])
})

test('expiring soon warns, expired is an error', async () => {
  const now = Math.floor(Date.now() / 1000)
  const soon = now + 3 * 86400 - 60
  const past = now - 86400
  const r = await runPlugin(import.meta.dirname, {
    config: { subscriptions: [A, B] },
    fixtures: { 'GET /api/v1/client/subscribe': quota(soon), 'GET /clash/config': quota(past) }
  })
  assert.deepEqual(r.alerts.map(a => [a.id, a.severity, a.title]), [
    [`expiring:Provider A:${soon}`, 'warning', 'Provider A expires in 3 days'],
    [`expired:Provider B:${past}`, 'error', 'Provider B has expired']
  ])
  const later = await runPlugin(import.meta.dirname, { config: { subscriptions: [A], expiryAlertDays: 2 }, fixtures: { 'GET /api/v1/client/subscribe': quota(soon) } })
  assert.deepEqual(later.alerts, [])
})

test('a missing header or a failing URL only affects its own entry', async () => {
  const C = { name: 'Provider C', url: 'https://sub-c.example/link/test-token-c' }
  const D = { name: 'Provider D', url: 'not a url' }
  const r = await runPlugin(import.meta.dirname, {
    config: { subscriptions: [A, B, C, D] },
    fixtures: { ...fixtures, 'GET /clash/config': { body: 'proxies: []\n' }, 'GET /link/test-token-c': { status: 403, body: 'forbidden' } }
  })
  const [a, b, c, d] = r.view.items
  assert.equal(a.value, 30075355136)
  assert.deepEqual([b.value, b.detail], [null, 'no Subscription-Userinfo header in the answer (try another userAgent)'], 'no bar, a note')
  assert.equal(c.detail, 'the server answered HTTP 403')
  assert.equal(d.detail, 'Invalid URL')
  assert.ok(!JSON.stringify(r.data).includes('test-token'), 'no URL or token in the data')
  assert.deepEqual(r.alerts, [])
  const stats = await runPlugin(import.meta.dirname, { config: { subscriptions: [C] }, options: { view: 'stats' }, fixtures: { 'GET /link/test-token-c': { status: 500, body: '' } } })
  assert.deepEqual(stats.view.items[0], { label: 'Provider C', value: 'error', format: 'text' })
})

test('sends the configured user agent, clash.meta by default', async () => {
  /** @type {string[]} */
  const agents = []
  const ctx = /** @type {any} */ ({
    config: { subscriptions: [{ ...A, userAgent: 'clash.meta' }, { ...B, userAgent: 'mihomo' }], usageAlertPercent: 90, expiryAlertDays: 7 },
    http: {
      request: async (/** @type {string} */ _url, /** @type {any} */ o) => {
        agents.push(o.headers['user-agent'])
        return { status: 200, ok: true, headers: { 'subscription-userinfo': 'upload=1; download=2; total=4' }, body: '' }
      }
    }
  })
  const data = await plugin.fetch?.(ctx)
  assert.deepEqual(agents, ['clash.meta', 'mihomo'])
  assert.deepEqual(data.subscriptions[0], { name: 'Provider A', upload: 1, download: 2, total: 4, expire: 0 })
  assert.equal(plugin.config?.properties.subscriptions.items.properties.userAgent.default, 'clash.meta')
})

test('subscriptions come from OpenClash on the router, by name, skipping disabled ones', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { openclash: { url: 'http://router.example', password: 'pw' } } })
  assert.deepEqual(r.data.subscriptions.map((/** @type {any} */ s) => s.name), ['Provider A', 'Provider B'])
  assert.equal(r.state.session, '0123456789abcdef0123456789abcdef')
  assert.doesNotMatch(JSON.stringify(r.data), /token=/, 'URLs stay inside the plugin')
  const one = await runPlugin(import.meta.dirname, { config: { openclash: { url: 'http://router.example', password: 'pw', names: ['Provider B'] } } })
  assert.deepEqual(one.data.subscriptions.map((/** @type {any} */ s) => s.name), ['Provider B'])
})

test('an expired router session logs in again once', async () => {
  const fx = { ...fixtures, 'POST /ubus?call=uci.get': [{ body: { jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'Access denied' } } }, fixtures['POST /ubus?call=uci.get']] }
  const r = await runPlugin(import.meta.dirname, { config: { openclash: { url: 'http://router.example', password: 'pw' } }, state: { session: 'stale' }, fixtures: fx })
  assert.equal(r.data.subscriptions.length, 2)
  assert.equal(r.state.session, '0123456789abcdef0123456789abcdef')
})
