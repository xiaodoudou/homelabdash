import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Registry } from '../src/plugins/registry.js'
import { Runtime } from '../src/runtime/runtime.js'
import { createStore } from '../src/runtime/store.js'
import { loadAndValidate } from '../src/config/validate.js'
import { tempConfig, until, FIXTURE_PLUGINS } from './helpers.js'

const quiet = { debug () {}, info () {}, warn () {}, error () {}, setSecrets () {} }

/** @param {string} yaml @param {Record<string, string>} [files] */
async function start (yaml, files = {}) {
  const registry = await new Registry({ builtinDir: FIXTURE_PLUGINS }).load()
  const res = loadAndValidate(tempConfig({ 'homelabdash.yaml': yaml, ...files }), registry)
  assert.deepEqual(res.errors, [])
  const runtime = new Runtime({ registry, store: createStore(null), log: quiet })
  runtime.setSecrets(res.secrets)
  /** @type {Map<string, any>} */
  const tiles = new Map()
  runtime.on('tile', st => tiles.set(st.id, st))
  await runtime.apply(/** @type {any} */ (res.config))
  const stop = async () => { await runtime.stop(); await registry.stop() }
  after(stop)
  return { runtime, tiles, registry, config: /** @type {import('../src/config/load.js').Config} */ (res.config), stop }
}

test('one fetch per source no matter how many tiles use it', async () => {
  const { tiles } = await start(`
sources:
  c: { plugin: counter, interval: 1h }
sections:
  - tiles:
      - { id: a, source: c, options: { label: first } }
      - { id: b, source: c, options: { label: second } }
`)
  await until(() => tiles.get('a')?.view && tiles.get('b')?.view)
  assert.equal(tiles.get('a').view.items[0].label, 'first')
  assert.equal(tiles.get('b').view.items[0].label, 'second')
  assert.equal(tiles.get('a').view.items[0].value, tiles.get('b').view.items[0].value)
})

test('a failing source reports the error with secrets redacted and backs off', async () => {
  const { runtime, tiles } = await start(`
sources:
  bad: { plugin: counter, interval: 1s, config: { fail: true, password: "\${secret:PW}" } }
sections:
  - tiles: [{ id: t, source: bad }]
`, { 'secrets.yaml': 'PW: hunter2-long' })
  const st = await until(() => tiles.get('t')?.error && tiles.get('t'))
  assert.match(st.error, /boom with \*\*\*/)
  const rt = /** @type {any} */ (runtime.sources.get('bad'))
  await until(() => rt.failures >= 2, 5000)
  assert.ok(rt.nextRun - Date.now() > 1000, 'second retry waits longer than the interval')
})

test('a hanging fetch is cut off and the worker comes back', async () => {
  const { runtime, tiles } = await start(`
sources:
  h: { plugin: counter, timeout: 200ms, interval: 1h, config: { hang: true } }
  ok: { plugin: counter, interval: 1h }
sections:
  - tiles: [{ id: h, source: h }, { id: ok, source: ok }]
`)
  const st = await until(() => tiles.get('h')?.error && tiles.get('h'), 10_000)
  assert.match(st.error, /did not answer fetch|timed out|exited/)
  await runtime.refreshTile('ok')
  assert.ok(tiles.get('ok').view, 'the other source on the same plugin recovers')
})

test('jobs run once on start when they never ran, then on schedule', async () => {
  const { runtime, tiles } = await start(`
sources:
  c: { plugin: counter, interval: 1h }
sections:
  - tiles: [{ id: t, source: c }]
`)
  await until(() => tiles.get('t')?.view?.items[1].value === 1, 5000)
  const job = /** @type {any} */ (runtime.sources.get('c')).jobs.get('tick')
  assert.ok(job.nextRun > Date.now() + 3_000_000, 'next run is an hour away')
  const r = await runtime.runJobNow('c', 'tick')
  assert.equal(r.ok, true)
  await until(() => tiles.get('t')?.view?.items[1].value === 2)
})

test('jobs can be turned off per source', async () => {
  const { runtime } = await start(`
sources:
  c: { plugin: counter, interval: 1h, jobs: { tick: { enabled: false } } }
sections:
  - tiles: [{ id: t, source: c }]
`)
  assert.equal(/** @type {any} */ (runtime.sources.get('c')).jobs.size, 0)
})

test('streams run only while someone watches', async () => {
  const { runtime, tiles } = await start(`
sources:
  c: { plugin: counter, interval: 1h }
sections:
  - tiles: [{ id: t, source: c }]
`)
  await until(() => tiles.get('t')?.view)
  assert.equal(tiles.get('t').view.items[2].value, null)
  runtime.setActive(true)
  await until(() => tiles.get('t')?.view?.items[2].value === 3, 5000)
  assert.equal(/** @type {any} */ (runtime.sources.get('c')).streamOn, true)
})

test('status dots, alerts and actions', async () => {
  const { runtime, tiles } = await start(`
sources:
  c: { plugin: counter, interval: 1h }
sections:
  - { source: alerts }
  - tiles:
      - { id: up, title: Up, status: { source: c, key: up } }
      - { id: down, title: Down, status: { source: c, key: other } }
      - { id: data, source: c }
`)
  await until(() => tiles.get('up')?.status && tiles.get('down')?.status)
  assert.equal(tiles.get('up').status.state, 'up')
  assert.deepEqual(tiles.get('down').status, { state: 'down', label: 'key other' })

  const alertsTile = /** @type {string} */ (Object.values(runtime.config?.tiles ?? {}).find(t => t.source === 'alerts')?.id)
  const r = await runtime.runAction('data', 'echo', { x: 1 })
  assert.deepEqual(r.result, { got: { x: 1 } })
  await assert.rejects(runtime.runAction('data', 'nope', {}), /has no action "nope"/)

  const items = await until(() => tiles.get(alertsTile)?.view?.items.length > 0 && tiles.get(alertsTile).view.items, 5000)
  assert.match(items[0].title, /n is odd/)
  await runtime.runAction(alertsTile, 'dismiss', { key: items[0].key })
  assert.equal(tiles.get(alertsTile).view.items.length, items.length - 1)
})

test('config changes restart only what changed', async () => {
  const { runtime, config, tiles } = await start(`
sources:
  a: { plugin: counter, interval: 1h }
  b: { plugin: counter, interval: 1h }
sections:
  - tiles: [{ id: a, source: a }, { id: b, source: b }]
`)
  await until(() => tiles.get('a')?.view && tiles.get('b')?.view)
  const a = runtime.sources.get('a')
  const b = runtime.sources.get('b')
  const next = structuredClone(config)
  next.sources.b.config = { tag: 'changed' }
  next.tiles.a.options = { label: 'renamed' }
  await runtime.apply(next)
  assert.equal(runtime.sources.get('a'), a, 'a is kept')
  assert.notEqual(runtime.sources.get('b'), b, 'b is restarted')
  await until(() => tiles.get('a')?.view?.items[0].label === 'renamed')
})
