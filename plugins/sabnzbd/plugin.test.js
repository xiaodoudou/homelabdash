import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://sabnzbd.example:8080', apiKey: 'test-key' }
const fixtures = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'http.json'), 'utf8'))
const queue = fixtures['GET /api?mode=queue'].body.queue

/** @param {Record<string, unknown>} patch */
const withQueue = patch => ({ ...fixtures, 'GET /api?mode=queue': { body: { queue: { ...queue, ...patch } } } })

test('summary: rate, queue size, time left (D:HH:MM:SS) and bytes left', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.view?.items.map(i => i.value), [2048 * 1024, 3, 86400 + 4 * 3600 + 26 * 60 + 40, 204800 * 1024 * 1024])
  assert.deepEqual(r.alerts, [])
})

test('queue rows with status, progress and time left', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'queue' } })
  assert.deepEqual(r.view?.items.map(i => i.title), ['Linux.Distro.2026.x64', 'Open.Movie.Project.2160p', 'Podcast.Archive.2026'])
  assert.deepEqual(r.view.items[0].badge, { text: 'downloading', tone: 'ok' })
  assert.deepEqual(r.view.items[0].progress, { value: 50, max: 100 })
  assert.deepEqual(r.view.items.map(i => i.value), [1024, 5120, undefined])
  assert.equal(r.view.items[2].badge.tone, 'warning')
})

test('queue limit: each tile slices, the request asks for the largest', async () => {
  const fx = { ...fixtures, 'GET /api?mode=queue&limit=25': fixtures['GET /api?mode=queue'] }
  delete fx['GET /api?mode=queue']
  const r = await runPlugin(import.meta.dirname, {
    config,
    fixtures: fx,
    tiles: [{ id: 'small', options: { view: 'queue', limit: 2 } }, { id: 'big', options: { view: 'queue', limit: 25 } }]
  })
  assert.equal(r.views.small.view?.items.length, 2)
  assert.equal(r.views.big.view?.items.length, 3)
})

test('empty queue', async () => {
  const r = await runPlugin(import.meta.dirname, { config, fixtures: withQueue({ slots: [], noofslots: 0 }), options: { view: 'queue' } })
  assert.deepEqual(r.view?.items, [])
  assert.equal(r.view.empty, 'Queue is empty')
})

test('paused queue raises an alert, with Resume only when control is allowed', async () => {
  const paused = withQueue({ paused: true, pause_int: '9:58' })
  const r = await runPlugin(import.meta.dirname, { config, fixtures: paused })
  assert.equal(r.alerts.length, 1)
  assert.equal(r.alerts[0].id, 'paused')
  assert.equal(r.alerts[0].severity, 'warning')
  assert.equal(r.alerts[0].href, 'http://sabnzbd.example:8080')
  assert.equal(r.alerts[0].message, 'The queue resumes in 10 min')
  assert.deepEqual(r.alerts[0].actions, [])
  const c = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, fixtures: paused })
  assert.deepEqual(c.alerts[0].actions?.map(a => a.name), ['resume'])
})

test('low disk space alert names the fullest folder', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { ...config, diskSpaceAlertGb: 600 } })
  assert.deepEqual(r.alerts.map(a => a.id), ['diskspace'])
  assert.equal(r.alerts[0].message, '512 GB free in the incomplete folder (alert below 600 GB)')
  const off = await runPlugin(import.meta.dirname, { config: { ...config, diskSpaceAlertGb: 0 }, fixtures: withQueue({ diskspace1: '1.00' }) })
  assert.deepEqual(off.alerts, [])
})

test('pause and resume are refused unless allowControl', async () => {
  await assert.rejects(runPlugin(import.meta.dirname, { config, action: 'pause' }), /allowControl/)
  const p = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, action: 'pause' })
  assert.deepEqual(p.result, { paused: true })
  const r = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, action: 'resume' })
  assert.deepEqual(r.result, { paused: false })
})

test('the tile offers pause or resume depending on the queue, only with allowControl', async () => {
  const on = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true } })
  assert.deepEqual(on.view?.actions, [on.data.paused ? { action: 'resume', title: 'Resume' } : { action: 'pause', title: 'Pause' }])
  const off = await runPlugin(import.meta.dirname, { config })
  assert.equal(off.view?.actions, undefined)
})

test('an API error in a 200 response fails the fetch', async () => {
  const fx = { ...fixtures, 'GET /api?mode=queue': { body: { status: false, error: 'API Key Incorrect' } } }
  await assert.rejects(runPlugin(import.meta.dirname, { config, fixtures: fx }), /SABnzbd: API Key Incorrect/)
})
