import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://tautulli.example:8181', apiKey: 'test-key' }

test('one row per stream with progress and time left', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.equal(r.view?.type, 'list')
  assert.equal(r.view.dense, undefined, 'title, then who and how, then the bar')
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => i.title), [
    'Example Show: S01E05 - The Fifth One',
    'Sample Movie (2024)',
    'Some Artist - Some Song'
  ])
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => i.subtitle), [
    'Alice - Living Room TV - transcode',
    'bob - Office PC - direct play',
    'Carol - Plexamp - direct stream'
  ])
  const [playing, paused] = r.view.items
  assert.equal(playing.format, 'until', 'a playing stream counts down in the browser')
  assert.equal(playing.value - r.data.at, 900_000, 'ends when duration minus view offset runs out')
  assert.deepEqual(playing.progress, { value: 40, max: 100, start: playing.value - 1_500_000, end: playing.value })
  assert.deepEqual([paused.format, paused.value, paused.progress], ['clock', 2100, { value: 65, max: 100 }], 'a paused stream stays put')
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => i.icon), ['mdi:play', 'mdi:pause', 'mdi:play'])
})

test('user names can be hidden', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { showUser: false } })
  assert.equal(r.view?.items[0].subtitle, 'Living Room TV - transcode')
})

test('summary converts kbps to bits per second', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'summary' } })
  assert.deepEqual(r.view?.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Streams', 3], ['Transcodes', 1], ['Bandwidth', 15360000]])
  assert.equal(r.view.items[2].format, 'bitrate')
})

test('nothing playing', async () => {
  const fixtures = { 'GET /api/v2?cmd=get_activity': { body: { response: { result: 'success', message: null, data: { stream_count: '0', sessions: [], stream_count_transcode: 0, total_bandwidth: 0 } } } } }
  const r = await runPlugin(import.meta.dirname, { config, fixtures })
  assert.deepEqual(r.view?.items, [])
  assert.equal(r.view.empty, 'Nothing playing')
})

test('an API error fails the fetch', async () => {
  const fixtures = { 'GET /api/v2?cmd=get_activity': { body: { response: { result: 'error', message: 'Invalid apikey', data: {} } } } }
  await assert.rejects(runPlugin(import.meta.dirname, { config, fixtures }), /Invalid apikey/)
})

test('with allowControl each stream gets a Stop button that asks first', async () => {
  const off = await runPlugin(import.meta.dirname, { config })
  assert.ok(off.view.items.every((/** @type {any} */ i) => !i.actions), 'no button unless allowControl is set')
  const on = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true } })
  assert.deepEqual(on.view.items[0].actions, [{ action: 'stop', title: 'Stop', confirm: 'Stop this stream?', input: { session_id: 'a1b2c3d4e5f6g7h8i9j0k1l2' } }])
})

test('Stop calls terminate_session, and only when allowed', async () => {
  const ok = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true, stopMessage: 'Bedtime' }, action: 'stop', input: { session_id: 'a1b2c3d4e5f6g7h8i9j0k1l2' } })
  assert.deepEqual(ok.result, { ok: true })
  await assert.rejects(runPlugin(import.meta.dirname, { config, action: 'stop', input: { session_id: 'x' } }), /allowControl/)
  const fixtures = { 'GET /api/v2?cmd=terminate_session': { body: { response: { result: 'error', message: 'Plex Pass required', data: null } } } }
  await assert.rejects(runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, fixtures, action: 'stop', input: { session_key: '12' } }), /could not stop the stream: Plex Pass required/)
})
