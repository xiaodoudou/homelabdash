import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://ai.example:8188/', apiKey: 'test-key' }

test('the queue view says whether ComfyUI is generating, what waits, and how long the last job took', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Status', 'generating'], ['Queued', 2], ['Last job', 42.5]])
  const idle = await runPlugin(import.meta.dirname, { config, fixtures: { 'GET /queue': { body: { queue_running: [], queue_pending: [] } }, 'GET /history': { body: {} }, 'GET /system_stats': { body: {} } } })
  assert.deepEqual(idle.view.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Status', 'idle'], ['Queued', 0], ['Last job', null]])
})

test('the history lists finished jobs newest first, without anything from the prompt', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'history' } })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.title, i.value, i.subtitle]), [
    ['Done, 2 outputs', 42.5, undefined],
    ['Failed', 3.2, 'KSampler: Allocation on device'],
    ['Done, 1 output', 61, undefined]
  ])
  assert.equal(r.view.items[1].tone, 'error')
  assert.doesNotMatch(JSON.stringify(r.view), /KSampler"|out_0\.png|class_type/, 'no workflow or file names on the tile')
})

test('the system view shows the VRAM in use, free RAM and the version', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'system' } })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.label, i.value]), [['VRAM', 25769803776 - 9663676416], ['RAM free', 41000000000], ['Version', '0.3.70']])
})

test('failed jobs raise one alert that keeps its id until another job fails', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.equal(r.alerts.length, 1)
  assert.equal(r.alerts[0].title, 'A ComfyUI job failed')
  assert.equal(r.alerts[0].message, 'KSampler: Allocation on device')
  assert.equal((await runPlugin(import.meta.dirname, { config })).alerts[0].id, r.alerts[0].id)
  assert.deepEqual((await runPlugin(import.meta.dirname, { config: { ...config, failureAlerts: false } })).alerts, [])
})

test('with allowControl the queue view offers Interrupt while generating and Free VRAM, both asking first', async () => {
  assert.equal((await runPlugin(import.meta.dirname, { config })).view.actions, undefined)
  const r = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true } })
  assert.deepEqual(r.view.actions.map((/** @type {any} */ a) => [a.action, a.confirm]), [['interrupt', 'Stop the running job?'], ['free', 'Unload the ComfyUI models?']])
  const idle = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, fixtures: { 'GET /queue': { body: { queue_running: [], queue_pending: [] } }, 'GET /history': { body: {} }, 'GET /system_stats': { body: {} } } })
  assert.deepEqual(idle.view.actions.map((/** @type {any} */ a) => a.action), ['free'])
  for (const action of ['interrupt', 'free']) {
    assert.deepEqual((await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, action })).result, { ok: true })
    await assert.rejects(runPlugin(import.meta.dirname, { config, action }), /allowControl/)
  }
})
