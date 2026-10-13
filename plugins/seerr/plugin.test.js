import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://requests.example:5055', apiKey: 'test-key' }
const recorded = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'http.json'), 'utf8'))

/** @param {string[]} keys */
function without (...keys) {
  const f = structuredClone(recorded)
  for (const k of keys) delete f[k]
  return f
}

test('summary counts', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.view?.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Pending', 2], ['Processing', 12], ['Available', 70], ['Open issues', 2]])
  assert.equal(r.view.items[3].href, 'http://requests.example:5055/issues')
})

test('pending requests get their titles from TMDB ids', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'pending' } })
  assert.deepEqual(r.view?.items.map((/** @type {any} */ i) => [i.title, i.subtitle]), [['Example Series (2024)', 'Carol'], ['Example Movie (2025)', 'Dave']])
  assert.equal(r.view.items[0].href, 'http://requests.example:5055/tv/2002')
  assert.equal(r.view.items[0].time, '2026-01-02T09:30:00.000Z')
  assert.deepEqual(r.view.items[1].badge, { text: '4K', tone: 'info' })
  assert.equal(r.view.items[0].actions, undefined, 'no buttons unless allowApprove')
  assert.deepEqual(r.state.titles, { 'tv:2002': 'Example Series (2024)', 'movie:1001': 'Example Movie (2025)' })
})

test('cached titles are not fetched again, stale ones are dropped', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config,
    options: { view: 'pending' },
    fixtures: without('GET /api/v1/movie/1001', 'GET /api/v1/tv/2002'),
    state: { titles: { 'tv:2002': 'Cached Series (2024)', 'movie:1001': 'Cached Movie (2025)', 'movie:9': 'Gone (1999)' } }
  })
  assert.deepEqual(r.view?.items.map((/** @type {any} */ i) => i.title), ['Cached Series (2024)', 'Cached Movie (2025)'])
  assert.deepEqual(Object.keys(r.state.titles).sort(), ['movie:1001', 'tv:2002'])
})

test('a title that cannot be fetched falls back to the TMDB id', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'pending' }, fixtures: { ...without('GET /api/v1/movie/1001'), 'GET /api/v1/movie/1001': { status: 404, body: { message: 'Unable to retrieve movie.' } } } })
  assert.equal(r.view?.items[1].title, 'TMDB 1001')
  assert.deepEqual(Object.keys(r.state.titles), ['tv:2002'])
})

test('alerts for pending requests and open issues', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.alerts.map(a => a.id), ['request:42', 'request:41', 'issues:2'])
  assert.equal(r.alerts[0].title, 'Request: Example Series (2024)')
  assert.equal(r.alerts[0].message, 'Requested by Carol')
  assert.equal(r.alerts[0].href, 'http://requests.example:5055/requests')
  assert.equal(r.alerts[1].title, 'Request: Example Movie (2025) (4K)')
  assert.equal(r.alerts[2].severity, 'warning')
  assert.deepEqual(r.alerts[0].actions, [])
})

test('alerts can be turned off, and then only the tiles are fetched', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config: { ...config, alerts: { pending: false, issues: false } },
    tiles: [{ id: 'summary', options: { view: 'summary' } }],
    fixtures: without('GET /api/v1/request?filter=pending')
  })
  assert.deepEqual(r.alerts, [])
  assert.equal(r.view?.items[0].value, 2)
})

test('approve and decline buttons only with allowApprove', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { ...config, allowApprove: true }, options: { view: 'pending' } })
  assert.deepEqual(r.view?.items[1].actions, [{ action: 'approve', title: 'Approve', input: { id: 41 } }, { action: 'decline', title: 'Decline', input: { id: 41 } }])
  assert.deepEqual(r.alerts[1].actions?.map(a => a.name), ['approve', 'decline'])
})

test('approve and decline are refused unless allowed', async () => {
  await assert.rejects(runPlugin(import.meta.dirname, { config, action: 'approve', input: { id: 41 } }), /allowApprove/)
  const allowed = { ...config, allowApprove: true }
  const approved = await runPlugin(import.meta.dirname, { config: allowed, action: 'approve', input: { id: 41 } })
  assert.deepEqual(approved.result, { ok: true })
  const declined = await runPlugin(import.meta.dirname, { config: allowed, action: 'decline', input: { id: 41 } })
  assert.deepEqual(declined.result, { ok: true })
  await assert.rejects(runPlugin(import.meta.dirname, { config: allowed, action: 'approve', input: { id: '41/../../settings' } }), /request id/)
})

test('the summary shows only the chosen counts, in that order', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'summary', stats: ['issues', 'pending'] } })
  assert.deepEqual(r.view?.items.map(i => i.label), ['Open issues', 'Pending'])
})
