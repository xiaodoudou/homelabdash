import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://ai.example:8080/' }
const recorded = JSON.parse(readFileSync(new URL('./fixtures/http.json', import.meta.url), 'utf8'))

/** The recorded requests, made to have happened `ago` seconds before now. @param {number} ago */
function fixturesAt (ago) {
  const data = recorded['GET /api/metrics/activity'].body.data.map((/** @type {any} */ a, /** @type {number} */ i) => ({ ...a, timestamp: new Date(Date.now() - (ago + i * 10) * 1000).toISOString() }))
  return { ...recorded, 'GET /api/metrics/activity': { body: { data } } }
}

test('the model view shows what is loaded and the speed of the last request', async () => {
  const r = await runPlugin(import.meta.dirname, { config, fixtures: fixturesAt(5) })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.label, i.value, i.unit]), [['Model', 'example-coder-32b', undefined], ['Generation', 52.9135, 'tok/s'], ['Prompt', 776.53, 'tok/s']])
})

test('after idleAfter without a request, the speeds read idle; with nothing loaded the model reads so', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { ...config, idleAfter: 60 }, fixtures: fixturesAt(120) })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => i.value), ['example-coder-32b', 'idle', 'idle'])
  const none = await runPlugin(import.meta.dirname, { config, fixtures: { ...fixturesAt(5), 'GET /running': { body: { running: [] } } } })
  assert.equal(none.view.items[0].value, 'none loaded')
})

test('each GPU, and the host, from the gauges of /metrics', async () => {
  const r = await runPlugin(import.meta.dirname, { config, tiles: [{ id: 'g1', options: { view: 'gpu', gpu: 1 } }, { id: 'host', options: { view: 'host' } }, { id: 'g9', options: { view: 'gpu', gpu: 9 } }] })
  assert.deepEqual(r.views.g1.view?.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Load', 87], ['VRAM', (13006536704 / 25769803776) * 100], ['Used', 13006536704], ['Power', 345.37], ['Temp', 74]])
  assert.deepEqual(r.views.host.view?.items.map((/** @type {any} */ i) => [i.label, i.value]), [['CPU', 25], ['RAM', 16567500800], ['Load', 1.01]])
  assert.match(r.views.g9.view?.text, /No GPU 9 \(llama-swap reports 0, 1\)/)
})

test('the activity view lists the last requests with their speed, failures marked', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'activity' } })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.subtitle, i.value, i.tone]), [
    ['508 tokens out, 1167 in', '52.9 tok/s', undefined],
    ['183 tokens out, 19 in', '57.7 tok/s', undefined],
    ['0 tokens out, 26 in', undefined, 'error']
  ])
})

test('an older llama-swap without gauges or activity still shows the model', async () => {
  const fixtures = { 'GET /running': recorded['GET /running'], 'GET /metrics': { status: 404, body: 'not found' }, 'GET /api/metrics/activity': { status: 404, body: 'not found' } }
  const r = await runPlugin(import.meta.dirname, { config, fixtures, tiles: [{ id: 'm' }, { id: 'g', options: { view: 'gpu' } }] })
  assert.equal(r.views.m.view?.items[0].value, 'example-coder-32b')
  assert.equal(r.views.g.view?.text, 'llama-swap reports no GPU')
})

test('a status dot follows a model', async () => {
  const r = await runPlugin(import.meta.dirname, { config, statusKeys: [{ tileId: 'a', key: 'example-coder-32b' }, { tileId: 'b', key: 'other' }] })
  assert.deepEqual(Object.values(r.statuses).map(s => s.state), ['up', 'warn'])
})

test('with allowControl the model view offers Unload, which asks first and unloads that model only', async () => {
  assert.equal((await runPlugin(import.meta.dirname, { config })).view.actions, undefined)
  const r = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true } })
  assert.deepEqual(r.view.actions, [{ action: 'unload', title: 'Unload', confirm: 'Unload example-coder-32b?', input: { model: 'example-coder-32b' } }])
  const none = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, fixtures: { ...recorded, 'GET /running': { body: { running: [] } } } })
  assert.equal(none.view.actions, undefined, 'nothing to unload')
  const done = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, action: 'unload', input: { model: 'example-coder-32b' } })
  assert.deepEqual(done.result, { ok: true })
  await assert.rejects(runPlugin(import.meta.dirname, { config, action: 'unload', input: { model: 'example-coder-32b' } }), /allowControl/)
})

test('several models loaded: the model view names them and offers Unload all, the models view a row each', async () => {
  const two = { ...fixturesAt(5), 'GET /running': { body: { running: [{ model: 'example-coder-32b', state: 'ready', ttl: 900 }, { model: 'example-embed', state: 'starting', ttl: 0 }] } } }
  const r = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, fixtures: two, tiles: [{ id: 'model' }, { id: 'models', options: { view: 'models' } }] })
  assert.deepEqual(r.views.model.view?.items[0], { label: '2 models', value: 'example-coder-32b, example-embed', format: 'text' })
  assert.deepEqual(r.views.model.view?.actions, [{ action: 'unloadAll', title: 'Unload all', confirm: 'Unload all 2 models?' }])
  assert.deepEqual(r.views.models.view?.items.map((/** @type {any} */ i) => [i.title, i.subtitle, i.value, i.actions[0].input.model]), [
    ['example-coder-32b', 'ready, unloads after 15 min idle', '52.9 tok/s', 'example-coder-32b'],
    ['example-embed', 'starting', 'idle', 'example-embed']
  ])
  assert.deepEqual((await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, action: 'unloadAll' })).result, { ok: true })
})
