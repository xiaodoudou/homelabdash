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
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.label, i.value, i.unit]), [['Model', 'example-coder-32b', undefined], ['Generation', 52.9135, 'tok/s'], ['Prompt', 776.53, 'tok/s'], ['Active', 0, undefined]])
})

test('after idleAfter without a request, the speeds read idle; with nothing loaded the model reads so', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { ...config, idleAfter: 60 }, fixtures: fixturesAt(120) })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => i.value), ['example-coder-32b', 'idle', 'idle', 0])
  const none = await runPlugin(import.meta.dirname, { config, fixtures: { ...fixturesAt(5), 'GET /running': { body: { running: [] } } } })
  assert.equal(none.view.items[0].value, 'none loaded')
})

test('each GPU, and the host, from the gauges of /metrics', async () => {
  const r = await runPlugin(import.meta.dirname, { config, tiles: [{ id: 'g1', options: { view: 'gpu', gpu: 1 } }, { id: 'host', options: { view: 'host' } }, { id: 'g9', options: { view: 'gpu', gpu: 9 } }] })
  assert.deepEqual(r.views.g1.view?.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Load', 87], ['VRAM', (13006536704 / 25769803776) * 100], ['Power', 345.37], ['Temp', 74]])
  assert.equal(r.views.g1.view?.items[1].detail, '12.1 / 24.0 GB')
  assert.deepEqual(r.views.host.view?.items.map((/** @type {any} */ i) => [i.label, i.value, i.detail]), [['CPU', 25, undefined], ['RAM', (16567500800 / 65741520896) * 100, '15.4 / 61.2 GB'], ['Load', 1.01, undefined]])
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

test('a vLLM backend reports no speed: generation is estimated from tokens and duration, and Prompt is left out', async () => {
  const fx = fixturesAt(5)
  const first = { ...fx['GET /api/metrics/activity'].body.data[0], id: 99, model: 'example-vllm', duration_ms: 2858, tokens: { cache_tokens: -1, draft_tokens: -1, draft_acc_tokens: -1, input_tokens: 17007, output_tokens: 415, prompt_per_second: -1, tokens_per_second: -1 } }
  const fixtures = { ...fx, 'GET /api/metrics/activity': { body: { data: [first, ...fx['GET /api/metrics/activity'].body.data] } } }
  const r = await runPlugin(import.meta.dirname, { config, fixtures })
  assert.deepEqual(r.view.items.slice(1).map((/** @type {any} */ i) => [i.label, i.value]), [['Generation', 415 / 2.858], ['Active', 0]], 'no Prompt stat when the backend gives none')
  assert.equal(r.data.requests[0].estimated, true)
  assert.equal(r.data.requests[0].cached, null, 'the -1 placeholders are read as unknown')
})

test('the stream follows requests in flight: Active counts them and the speeds read running', async () => {
  const r = await runPlugin(import.meta.dirname, { config, fixtures: fixturesAt(600), stream: true })
  const last = r.updates.at(-1)
  assert.deepEqual(last?.data.inflight.map((/** @type {any} */ q) => q.id), ['2'], 'the snapshot, then upserts, then a removal')
  const view = last?.derived.views.tile.view
  assert.deepEqual(view.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Model', 'example-coder-32b'], ['Generation', 'running'], ['Prompt', 'running'], ['Active', 1]])
})

test('while a request runs, the speed is the byte rate over the bytes per token learned from finished requests', async () => {
  const { default: plugin } = await import('./index.js')
  const ctx = (/** @type {any} */ http) => ({ source: 'unit', config: { url: 'http://ai.example:8080', idleAfter: 300 }, http, refresh () {} })
  const line = (/** @type {any} */ p) => 'data:' + JSON.stringify({ type: 'inflight', data: JSON.stringify(p) })
  const upd = (/** @type {string} */ id, /** @type {number} */ ms, /** @type {number} */ bytes) => line({ operation: 'upsert', request: { id, model: 'm', elapsed_ms: ms, resp_bytes: bytes } })
  /** @type {any} */
  let data = { at: Date.now(), running: [{ model: 'm', state: 'ready', ttl: 900 }], gpus: [], host: {}, requests: [], inflight: [] }
  const emit = (/** @type {any} */ f) => { data = typeof f === 'function' ? f(data) : f }
  const stream = (/** @type {string[]} */ lines) => plugin.stream?.(ctx({ async * stream () { yield * lines } }), emit)
  // a first request streams 2000 bytes, then ends; the activity log says it made 10 tokens in 2 s: 200 bytes per token
  await stream([upd('a', 1000, 1000), upd('a', 2000, 2000), line({ operation: 'remove', id: 'a' })])
  const finished = { id: 1, timestamp: new Date().toISOString(), model: 'm', resp_status_code: 200, tokens: { input_tokens: 5, output_tokens: 10, tokens_per_second: -1, prompt_per_second: -1 }, duration_ms: 2000 }
  data = await plugin.fetch(ctx({ json: async () => ({ running: data.running }), request: async (/** @type {string} */ u) => u.endsWith('/metrics') ? { status: 200, body: '' } : { status: 200, body: { data: [finished] } } }))
  // a second request streams 4000 bytes a second: 20 tokens per second
  await stream([upd('b', 1000, 4000), upd('b', 2000, 8000)])
  const view = /** @type {any} */ (plugin.render(data, { view: 'model', gpu: 0 }, /** @type {any} */ (ctx({}))))
  assert.deepEqual(view.items.map((/** @type {any} */ i) => [i.label, i.value]).slice(1, 3), [['Generation', 20], ['Active', 1]])
})
