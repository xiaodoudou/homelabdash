import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import { startMocks } from '../dev/mock-upstreams.js'
import { Homelabdash } from '../src/core.js'
import { sameOrigin } from '../src/server/app.js'
import { tempConfig, until } from './helpers.js'

const quiet = { debug () {}, info () {}, warn () {}, error () {}, setSecrets () {} }

/** @type {Awaited<ReturnType<typeof startMocks>>} */
let mocks
/** @type {Homelabdash} */
let app
let configDir = ''
let dataDir = ''
let base = ''

/** @param {string} [extra] */
const yaml = (extra = '') => `
settings: { title: Test }
sources:
  host: { plugin: glances, interval: 1s, config: { url: "http://127.0.0.1:${mocks.httpPort}/glances" } }
  tower: { plugin: unraid, interval: 1h, config: { url: "http://127.0.0.1:${mocks.httpPort}/unraid", apiKey: "\${secret:UNRAID}" } }
  docker: { plugin: docker, interval: 1h, config: { url: "http://127.0.0.1:${mocks.httpPort}/docker", expected: [backup] } }
  router:
    plugin: ssh
    interval: 1h
    config: { host: 127.0.0.1, port: ${mocks.sshPort}, username: t, password: "\${secret:PW}", follow: { command: logread -f } }
sections:
  - { title: Alerts, source: alerts }
  - title: Main
    tiles:
      - { id: cpu, source: host, options: { metric: cpu }, graph: [CPU] }
      - { id: arr, source: tower, options: { metric: array } }
      - { id: plex, title: Plex, container: media-server }
      - { id: log, source: router, options: { view: log } }
${extra}`

async function boot () {
  app = new Homelabdash({ configDir, dataDir, port: 0, host: '127.0.0.1', log: quiet })
  await app.start()
  base = `http://127.0.0.1:${app.port}`
}

/** Opens the dashboard WebSocket and records every message. */
function client (headers = {}) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/api/ws`, { headers })
  /** @type {any[]} */
  const messages = []
  ws.on('message', d => messages.push(JSON.parse(String(d))))
  const tile = (/** @type {string} */ id) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      const t = m.type === 'tiles' || m.type === 'hello' ? m.tiles.find((/** @type {any} */ x) => x.id === id) : null
      if (t) return t
    }
    return null
  }
  return { ws, messages, tile, opened: new Promise(resolve => ws.once('open', resolve)) }
}

/** @param {string} p @param {RequestInit} [init] */
const api = (p, init) => fetch(base + p, init)
const post = (/** @type {string} */ p, /** @type {any} */ body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

before(async () => {
  mocks = await startMocks({ httpPort: 0, sshPort: 0, quiet: true })
  configDir = tempConfig({ 'secrets.yaml': 'UNRAID: secret-unraid-value\nPW: secret-pw-value\n' })
  fs.writeFileSync(path.join(configDir, 'homelabdash.yaml'), yaml())
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homelabdash-data-'))
  await boot()
})

after(async () => {
  await app?.stop()
  await mocks?.close()
})

test('dashboard and debug APIs never contain secret values', async () => {
  const dash = await (await api('/api/dashboard')).text()
  assert.match(dash, /"title":"Test"/)
  await until(async () => (await (await api('/api/debug')).json()).sources.every((/** @type {any} */ s) => s.lastRun || s.stream))
  const debug = await (await api('/api/debug?data=1')).text()
  for (const body of [dash, debug, JSON.stringify(app.runtime.snapshot())]) {
    assert.doesNotMatch(body, /secret-unraid-value|secret-pw-value/)
  }
})

test('the WebSocket sends a snapshot, then live updates, and streams only while connected', async () => {
  const c = client()
  await c.opened
  await until(() => c.messages[0]?.type === 'hello')
  assert.ok(c.tile('arr')?.view, 'snapshot has data')
  const first = await until(() => c.tile('cpu')?.view?.items[0].value != null && c.tile('cpu'))
  await until(() => c.tile('cpu') !== first && c.tile('cpu').view.items[0].value !== first.view.items[0].value, 6000)
  const point = c.tile('cpu').point
  assert.deepEqual(Object.keys(point), ['CPU'], 'graphed tiles carry their newest history point')
  assert.equal(c.tile('arr').point, undefined, 'tiles without graph carry none')
  const log = await until(() => c.tile('log')?.view?.lines.length >= 2 && c.tile('log'), 8000)
  assert.equal(log.view.type, 'log')
  assert.equal(app.runtime.active, true)
  c.ws.close()
  await until(() => app.runtime.active === false)
})

test('status dots come from the docker source', async () => {
  const c = client()
  await c.opened
  const plex = await until(() => c.tile('plex')?.status && c.tile('plex'))
  assert.equal(plex.status.state, 'up')
  c.ws.close()
})

test('POST guards: JSON only, same origin only', async () => {
  assert.equal((await api('/api/tiles/cpu/refresh', { method: 'POST' })).status, 415)
  const cross = await api('/api/tiles/cpu/refresh', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' })
  assert.equal(cross.status, 403)
  assert.equal((await post('/api/tiles/cpu/refresh', {})).status, 200)
  assert.equal((await post('/api/tiles/nope/refresh', {})).status, 404)
})

test('same origin behind a proxy that drops the port from Host', () => {
  const ok = (/** @type {Record<string, string>} */ headers) => sameOrigin({ headers })
  assert.ok(ok({ host: 'dash.example', origin: 'https://dash.example:9443' }), 'nginx $host has no port')
  assert.ok(ok({ host: '192.0.2.10:3000', origin: 'http://192.0.2.10:3000' }))
  assert.ok(ok({ host: 'dash.example:443', origin: 'https://dash.example' }), 'default port')
  assert.ok(ok({ host: '192.0.2.10:3000', 'x-forwarded-host': 'dash.example:9443', origin: 'https://dash.example:9443' }))
  assert.ok(!ok({ host: 'dash.example:3000', origin: 'https://dash.example:9443' }), 'an explicit port must match')
  assert.ok(!ok({ host: 'dash.example', origin: 'https://evil.example' }))
  assert.ok(!ok({ host: 'dash.example', origin: 'null' }))
})

test('dismissing an alert is stored server-side and survives a restart', async () => {
  const alertsTile = /** @type {string} */ (Object.values(app.config?.tiles ?? {}).find(t => t.source === 'alerts')?.id)
  const before = await until(() => app.runtime.tileStates.get(alertsTile)?.view?.items.length > 1 && app.runtime.tileStates.get(alertsTile)?.view.items)
  const key = before.find((/** @type {any} */ i) => i.key.startsWith('tower:')).key
  const r = await post(`/api/tiles/${encodeURIComponent(alertsTile)}/actions/dismiss`, { input: { key } })
  assert.equal(r.status, 200)
  const count = app.runtime.tileStates.get(alertsTile)?.view.items.length
  assert.equal(count, before.length - 1)

  await app.stop()
  await boot()
  await until(() => app.runtime.tileStates.get(alertsTile)?.view?.items.length === count, 8000)
  assert.ok(!app.runtime.tileStates.get(alertsTile)?.view.items.some((/** @type {any} */ i) => i.key === key))
})

test('a mistake inside one tile switches off only that tile', async () => {
  const file = path.join(configDir, 'homelabdash.yaml')
  const version = app.version
  fs.writeFileSync(file, yaml().replace('metric: cpu', 'metric: cpux').replace('settings: { title: Test }', 'settings: { title: Test 2 }'))
  await until(() => app.version > version, 8000)
  const health = await (await api('/api/health')).json()
  assert.equal(health.status, 'degraded')
  assert.equal(health.configErrors, 1)
  const dash = await (await api('/api/dashboard')).json()
  assert.equal(dash.title, 'Test 2', 'the rest of the edit is applied')
  assert.match(JSON.stringify(dash.configErrors), /options\.metric.*must be one of/)
  await until(() => /^config error: .*options\.metric/.test(app.runtime.tileStates.get('cpu')?.error ?? ''))
  await until(() => app.runtime.tileStates.get('arr')?.view)
  fs.writeFileSync(file, yaml())
  await until(() => app.configErrors.length === 0 && !app.runtime.tileStates.get('cpu')?.error, 8000)
})

test('a missing secret switches off its source, not the dashboard', async () => {
  const file = path.join(configDir, 'homelabdash.yaml')
  const version = app.version
  fs.writeFileSync(file, yaml().replace('${secret:UNRAID}', '${secret:NOT_THERE}'))
  await until(() => app.version > version, 8000)
  const arr = await until(() => /^config error/.test(app.runtime.tileStates.get('arr')?.error ?? '') && app.runtime.tileStates.get('arr'))
  assert.match(arr.error ?? '', /config error: .*secret NOT_THERE is not defined/)
  await until(() => app.runtime.tileStates.get('cpu')?.view)
  fs.writeFileSync(file, yaml())
  await until(() => app.configErrors.length === 0, 8000)
})

test('a broken file keeps the last good config and reports where it broke', async () => {
  const file = path.join(configDir, 'homelabdash.yaml')
  const version = app.version
  fs.writeFileSync(file, yaml().replace('settings: { title: Test }', 'settings: { title: Test, theme: purple }'))
  const health = await until(async () => { const h = await (await api('/api/health')).json(); return h.configErrors > 0 && h }, 8000)
  assert.equal(health.status, 'degraded')
  assert.equal(app.version, version)
  const dash = await (await api('/api/dashboard')).json()
  assert.equal(dash.pages[0].sections.length, 2, 'still serving the old layout')
  assert.match(JSON.stringify(dash.configErrors), /settings\.theme.*must be one of/)
  fs.writeFileSync(file, yaml())
  await until(() => app.version > version, 8000)
})

test('a user plugin is picked up and hot-reloaded when its file changes', async () => {
  const file = path.join(configDir, 'plugins', 'hello', 'index.js')
  const source = (/** @type {string} */ word) => `export default { id: 'hello', version: '1.0.0', description: 'test', fetch: () => ({ type: 'text', text: '${word}' }) }\n`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, source('first'))
  fs.writeFileSync(path.join(configDir, 'homelabdash.yaml'), yaml('  - tiles: [{ id: hello, plugin: hello }]'))
  await until(() => app.runtime.tileStates.get('hello')?.view?.text === 'first', 10_000)
  fs.writeFileSync(file, source('second'))
  await until(() => app.runtime.tileStates.get('hello')?.view?.text === 'second', 10_000)
})

test('basic auth protects pages, API and WebSocket but not the health check', async () => {
  const file = path.join(configDir, 'homelabdash.yaml')
  const version = app.version
  fs.writeFileSync(file, yaml().replace('settings: { title: Test }', 'settings: { title: Test, auth: { type: basic, username: me, password: "${secret:PW}" } }'))
  await until(() => app.version > version, 8000)
  assert.equal((await api('/api/dashboard')).status, 401)
  assert.equal((await api('/')).status, 401)
  assert.equal((await api('/api/health')).status, 200)
  const auth = { authorization: 'Basic ' + Buffer.from('me:secret-pw-value').toString('base64') }
  assert.equal((await api('/api/dashboard', { headers: auth })).status, 200)
  const denied = new WebSocket(`${base.replace('http', 'ws')}/api/ws`)
  await assert.rejects(new Promise((resolve, reject) => { denied.once('open', resolve); denied.once('error', reject) }))
  const ok = client(auth)
  await ok.opened
  ok.ws.close()
})
