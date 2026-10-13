import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://glances.example:61208' }

test('summary tile', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.equal(r.view?.type, 'stats')
  assert.deepEqual(r.view.items.map(i => i.label), ['CPU', 'RAM', 'Load', 'Uptime'])
  assert.equal(r.view.items[0].value, 23.4)
  assert.equal(r.view.items[3].value, 12 * 86400 + 4 * 3600 + 5 * 60 + 31)
})

test('gpu tile and hot GPU alert', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { metric: 'gpu' } })
  assert.deepEqual(r.view?.items.map(i => i.value), [34, 12.5, 92, 70])
  assert.equal(r.alerts.length, 1)
  assert.match(r.alerts[0].id, /^gpu-hot:/)
})

test('fs tile skips bind mounts and duplicate devices', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { metric: 'fs' } })
  assert.deepEqual(r.view?.items.map(i => i.label), ['/', '/mnt/data'])
})

test('rejects an unknown metric', async () => {
  await assert.rejects(runPlugin(import.meta.dirname, { config, options: { metric: 'nope' } }), /must be one of/)
})
