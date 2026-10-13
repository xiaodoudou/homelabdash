import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://service.example', apiKey: 'test-key' }

test('summary counts problems', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.view?.type === 'stats' && r.view.items.map(i => i.value), [2, 1])
})

test('one alert per item that is not ok', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.alerts.map(a => a.id), ['item:second'])
})
