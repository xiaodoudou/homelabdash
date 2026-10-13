import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runPlugin } from 'homelabdash/testing'

const config = { expected: ['backup'] }
const fixtures = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'http.json'), 'utf8'))

test('summary counts and alerts', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.view?.items.map(i => i.value), [3, 1, 1, 1])
  assert.deepEqual(r.alerts.map(a => a.id).sort(), ['down:backup', 'unhealthy:downloader'])
  assert.deepEqual(r.alerts[0].actions, [], 'no control actions unless allowControl')
})

test('a stopped container is not unhealthy, whatever its last health status', async () => {
  const list = fixtures['GET /containers/json'].body.map((/** @type {any} */ c) => c.Names[0] === '/backup' ? { ...c, Health: { Status: 'unhealthy' } } : c)
  const r = await runPlugin(import.meta.dirname, { config: {}, fixtures: { ...fixtures, 'GET /containers/json': { body: list } } })
  assert.deepEqual(r.view?.items.map(i => i.value), [3, 1, 1, 0])
  assert.deepEqual(r.alerts.map(a => a.id), ['unhealthy:downloader'])
})

test('status dots for tiles', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config,
    statusKeys: [{ tileId: 'a', key: 'media-server' }, { tileId: 'b', key: 'backup' }, { tileId: 'c', key: 'downloader' }, { tileId: 'd', key: 'nope' }]
  })
  assert.deepEqual(Object.fromEntries(Object.entries(r.statuses).map(([k, v]) => [k, v.state])), { a: 'up', b: 'down', c: 'down', d: 'unknown' })
})

test('problems list with control actions', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, options: { view: 'list', show: 'problems' } })
  assert.deepEqual(r.view?.items.map(i => i.title), ['backup', 'downloader'])
  assert.equal(r.view.items[0].actions[0].action, 'start')
})

test('a container whose healthcheck is still starting is not a problem', async () => {
  const list = fixtures['GET /containers/json'].body.map((/** @type {any} */ c) => c.Names[0] === '/dns' ? { ...c, Status: 'Up 2 seconds (health: starting)', Health: { Status: 'starting' } } : c)
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'list', show: 'problems' }, fixtures: { ...fixtures, 'GET /containers/json': { body: list } } })
  assert.deepEqual(r.view?.items.map(i => i.title), ['backup', 'downloader'])
})

test('df job feeds the disk view', async () => {
  const r = await runPlugin(import.meta.dirname, { config, job: 'df', options: { view: 'disk' } })
  assert.equal(r.view?.items[0].value, 21474836480)
  assert.equal(r.view.items[1].value, 536870912)
  assert.ok(r.state.df.at)
})

test('events stream re-lists containers', async () => {
  const r = await runPlugin(import.meta.dirname, { config, stream: { updates: 1, timeout: 3000 } })
  assert.equal(r.updates.length, 1)
  assert.equal(r.updates[0].data.containers.length, 4)
})

test('start action is refused unless allowed', async () => {
  await assert.rejects(runPlugin(import.meta.dirname, { config, action: 'start', input: { name: 'backup' } }), /allowControl/)
  const r = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, action: 'start', input: { name: 'backup' } })
  assert.deepEqual(r.result, { ok: true })
})
