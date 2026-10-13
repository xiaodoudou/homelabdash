import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://qbittorrent.example:8080' }
const login = { ...config, username: 'admin', password: 'test-password' }
const fixtures = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'http.json'), 'utf8'))
const forbidden = { ...fixtures, 'GET /api/v2/transfer/info': { status: 403, body: 'Forbidden' } }

test('summary: leeching and seeding counts with speeds', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.view?.items.map(i => [i.label, i.value]), [['Leech', 4], ['Download', 5242880], ['Seed', 2], ['Upload', 1114112]])
})

test('active: downloading or moving data, fastest first', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'active' } })
  assert.deepEqual(r.view?.items.map(i => i.title), ['debian-13.1.0-amd64-netinst.iso', 'ubuntu-26.04-desktop-amd64.iso', 'Big Buck Bunny 4K'])
  assert.deepEqual(r.view.items.map(i => i.badge.text), ['downloading', 'seeding', 'metadata'])
  assert.deepEqual(r.view.items[0].progress, { value: 42.5, max: 100 })
  assert.deepEqual(r.view.items.map(i => i.value), [5242880, 0, 0])
  const one = await runPlugin(import.meta.dirname, { config, options: { view: 'active', limit: 1 } })
  assert.equal(one.view?.items.length, 1)
})

test('nothing active', async () => {
  const fx = { ...fixtures, 'GET /api/v2/torrents/info': { body: [] } }
  const r = await runPlugin(import.meta.dirname, { config, fixtures: fx, options: { view: 'active' } })
  assert.deepEqual(r.view?.items, [])
  assert.equal(r.view.empty, 'Nothing active')
})

test('one alert per kind of problem, naming its torrents', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.alerts.map(a => a.title), ['1 torrent has missing files', '1 torrent stopped after an error'])
  assert.match(r.alerts[0].message ?? '', /: Old Dataset 2019$/)
})

test('torrents with the same problem share an alert that changes id when one joins', async () => {
  const torrents = fixtures['GET /api/v2/torrents/info'].body
  const missing = torrents.find((/** @type {any} */ t) => t.state === 'missingFiles')
  const more = (/** @type {number} */ n) => ({ ...fixtures, 'GET /api/v2/torrents/info': { body: [...torrents, ...Array.from({ length: n }, (_, i) => ({ ...missing, hash: `${i}`.repeat(40), name: `Extra ${i}` }))] } })
  const two = await runPlugin(import.meta.dirname, { config, fixtures: more(1) })
  const five = await runPlugin(import.meta.dirname, { config, fixtures: more(4) })
  assert.equal(two.alerts[0].title, '2 torrents have missing files')
  assert.equal(five.alerts[0].title, '5 torrents have missing files')
  assert.match(five.alerts[0].message ?? '', /Extra 1 and 2 more$/)
  assert.notEqual(two.alerts[0].id, five.alerts[0].id)
})

test('403 without credentials explains the whitelist', async () => {
  await assert.rejects(runPlugin(import.meta.dirname, { config, fixtures: forbidden }), /WebUI auth whitelist .* or set username and password/)
})

test('with credentials: logs in and keeps the session cookie', async () => {
  const r = await runPlugin(import.meta.dirname, { config: login })
  assert.equal(r.state.cookie, 'SID=fixture-session-id')
  assert.equal(r.view?.items[0].value, 4)
})

test('a stored session is reused without logging in', async () => {
  const fx = { ...fixtures }
  delete fx['POST /api/v2/auth/login']
  const r = await runPlugin(import.meta.dirname, { config: login, fixtures: fx, state: { cookie: 'SID=kept' } })
  assert.equal(r.state.cookie, 'SID=kept')
})

test('a 403 with credentials logs in again once, then gives up', async () => {
  await assert.rejects(runPlugin(import.meta.dirname, { config: login, fixtures: forbidden, state: { cookie: 'SID=expired' } }), /still answers 403 .* after logging in/)
})

test('per-port cookie name of newer versions', async () => {
  const fx = { ...fixtures, 'POST /api/v2/auth/login': { headers: { 'set-cookie': 'QBT_SID_8080=abc123; HttpOnly; path=/' }, body: 'Ok.' } }
  const r = await runPlugin(import.meta.dirname, { config: login, fixtures: fx })
  assert.equal(r.state.cookie, 'QBT_SID_8080=abc123')
})

test('wrong credentials', async () => {
  const fx = { ...fixtures, 'POST /api/v2/auth/login': { body: 'Fails.' } }
  await assert.rejects(runPlugin(import.meta.dirname, { config: login, fixtures: fx }), /login failed \(200 Fails\.\): check username and password/)
})

test('username needs a password', async () => {
  await assert.rejects(runPlugin(import.meta.dirname, { config: { ...config, username: 'admin' } }), /invalid config/)
})
