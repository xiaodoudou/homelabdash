import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://radarr.example:7878', apiKey: 'test-key' }
const lidarr = { url: 'http://lidarr.example:8686', apiKey: 'test-key', apiVersion: 'v1' }
const recorded = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'http.json'), 'utf8'))

/** @param {string[]} keys */
function only (...keys) {
  return Object.fromEntries(keys.map(k => [k, recorded[k]]))
}

test('missing is the default view', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.view?.items, [{ label: 'Missing', value: 17, format: 'number', href: 'http://radarr.example:7878/wanted/missing' }])
})

test('queue and summary stats', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config,
    tiles: [{ id: 'queue', options: { view: 'queue' } }, { id: 'summary', options: { view: 'summary' } }]
  })
  assert.deepEqual(r.views.queue.view?.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Queue', 3], ['Errors', 'yes'], ['Warnings', 'no']])
  assert.deepEqual(r.views.summary.view?.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Missing', 17], ['Queue', 3], ['Health issues', 3]])
})

test('health checks as a list with type badges and wiki links', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'health' } })
  assert.deepEqual(r.view?.items.map((/** @type {any} */ i) => i.badge), [{ text: 'warning', tone: 'warning' }, { text: 'error', tone: 'error' }, { text: 'notice', tone: 'info' }])
  assert.equal(r.view.items[1].title, 'Unable to communicate with Example Client.')
  assert.equal(r.view.items[1].href, 'https://wiki.servarr.com/radarr/system#unable-to-communicate-with-download-client')
  assert.equal(r.view.items[2].href, undefined, 'empty wikiUrl gives no link')
})

test('one alert per health check, titled with the app name', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.alerts.map(a => a.severity), ['warning', 'error', 'info'])
  assert.equal(r.alerts[0].id, 'IndexerStatusCheck:Indexers unavailable due to failures: Example Indexer')
  assert.equal(r.alerts[0].title, 'Radarr: Indexers unavailable due to failures: Example Indexer')
  assert.equal(r.alerts[0].href, 'https://wiki.servarr.com/radarr/system#indexers-are-unavailable-due-to-failures')
})

test('only what the tiles and alerts need is fetched', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config: { ...config, healthAlerts: false },
    fixtures: only('GET /api/v3/wanted/missing?pageSize=1')
  })
  assert.equal(r.view?.items[0].value, 17)
  assert.deepEqual(r.alerts, [])
})

test('apiVersion v1 (Lidarr), healthy: no system status call, no alerts', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config: lidarr,
    tiles: [{ id: 'summary', options: { view: 'summary' } }, { id: 'health', options: { view: 'health' } }],
    fixtures: only('GET /api/v1/wanted/missing?pageSize=1', 'GET /api/v1/queue/status', 'GET /api/v1/health')
  })
  assert.deepEqual(r.views.summary.view?.items.map((/** @type {any} */ i) => i.value), [5, 0, 0])
  assert.deepEqual(r.views.health.view?.items, [])
  assert.equal(r.views.health.view?.empty, 'Healthy')
  assert.deepEqual(r.alerts, [])
})

test('apiVersion must look like v3', async () => {
  await assert.rejects(runPlugin(import.meta.dirname, { config: { ...config, apiVersion: '3' } }), /invalid config/)
})
