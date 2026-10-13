import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://router.example:9090', secret: 'test-secret' }
const fixtures = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'http.json'), 'utf8'))

test('summary shows the node with its emoji and the connection count', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => i.value), ['🇯🇵 Tokyo 01', 3, null, null])
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => i.label), ['Node', 'Conns', 'Down', 'Up'])
  assert.equal(r.data.connections, 3)
  assert.equal(r.data.downloadTotal, 52613349376)
  assert.equal(r.data.uploadTotal, 2147483648)
  assert.equal('metadata' in r.data, false)
})

test('traffic stream updates rates and totals live', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config,
    tiles: [{ id: 'summary', options: { view: 'summary' } }, { id: 'traffic', options: { view: 'traffic' } }],
    stream: { updates: 1, timeout: 3000 }
  })
  assert.equal(r.updates.length, 1)
  const data = r.updates[0].data
  assert.deepEqual([data.traffic.down, data.traffic.up], [3145728, 6144])
  assert.equal(data.node, '🇯🇵 Tokyo 01', 'the polled data is kept')
  const views = r.updates[0].derived.views
  assert.deepEqual(views.summary.view.items.slice(2).map((/** @type {any} */ i) => i.value), [3145728, 6144])
  assert.deepEqual(views.traffic.view.items.map((/** @type {any} */ i) => i.value), [3145728, 6144, 52617543680, 2147491840])
})

test('older builds without totals in the stream keep the polled totals', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config,
    options: { view: 'traffic' },
    fixtures: { ...fixtures, 'STREAM /traffic': { lines: [{ up: 10, down: 20 }, 'not json'] } },
    stream: { updates: 1, timeout: 3000 }
  })
  assert.deepEqual(r.updates[0].derived.views.tile.view.items.map((/** @type {any} */ i) => i.value), [20, 10, 52613349376, 2147483648])
})

test('empty connection list', async () => {
  const r = await runPlugin(import.meta.dirname, { config, fixtures: { ...fixtures, 'GET /connections': { body: { downloadTotal: 0, uploadTotal: 0, connections: null, memory: 0 } } } })
  assert.equal(r.data.connections, 0)
})

test('unknown group is reported', async () => {
  await assert.rejects(
    runPlugin(import.meta.dirname, { config: { ...config, group: 'Streaming' }, fixtures: { ...fixtures, 'GET /proxies/Streaming': { status: 404, body: { message: 'Resource not found' } } } }),
    /no proxy group "Streaming"/
  )
})

test('group names are escaped in the path', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config: { ...config, group: '🎬 Media' },
    fixtures: { ...fixtures, 'GET /proxies/%F0%9F%8E%AC%20Media': { body: { name: '🎬 Media', type: 'Selector', now: 'DIRECT' } } }
  })
  assert.equal(r.view.items[0].value, 'DIRECT')
})
