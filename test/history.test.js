import { test } from 'node:test'
import assert from 'node:assert/strict'
import { History } from '../src/runtime/history.js'
import { createStore } from '../src/runtime/store.js'

const view = (/** @type {Record<string, any>} */ values) => ({
  type: 'stats',
  items: Object.entries(values).map(([label, value]) => ({ label, value, format: typeof value === 'string' ? 'text' : 'percent' }))
})

test('one point per step, the newest value of a step wins', () => {
  const h = new History(createStore(null), { window: 60_000, step: 10_000 })
  h.record('t', view({ CPU: 10 }), true, 1_000)
  h.record('t', view({ CPU: 20 }), true, 5_000)
  h.record('t', view({ CPU: 30 }), true, 12_000)
  assert.deepEqual(h.dump(['t']).t.CPU, { t: [5_000, 12_000], v: [20, 30] })
  assert.deepEqual(h.last('t'), { CPU: [12_000, 30] })
})

test('points older than the window are dropped', () => {
  const h = new History(createStore(null), { window: 30_000, step: 10_000 })
  for (let t = 0; t <= 100_000; t += 10_000) h.record('t', view({ CPU: t }), true, t)
  assert.deepEqual(h.dump(['t']).t.CPU.t, [70_000, 80_000, 90_000, 100_000])
})

test('only numeric stats, only the labels asked for', () => {
  const h = new History(createStore(null))
  h.record('t', view({ Load: 3, Status: 'online', Temp: 60 }), ['Load', 'Status'], 1)
  assert.deepEqual(Object.keys(h.dump(['t']).t), ['Load'])
  h.record('u', { type: 'list', items: [] }, true, 1)
  assert.equal(h.last('u'), null)
})

test('history survives a restart through the store, unused tiles are dropped', () => {
  const store = createStore(null)
  const a = new History(store)
  a.record('t', view({ CPU: 5 }), true, 1)
  a.record('gone', view({ CPU: 5 }), true, 1)
  a.flush()
  const b = new History(store)
  b.keep(new Map([['t', true]]))
  assert.deepEqual(Object.keys(b.dump(['t', 'gone'])), ['t'])
  assert.deepEqual(b.last('t'), { CPU: [1, 5] })
})

test('a repeated label keeps the first stat (percent, not bytes)', () => {
  const h = new History(createStore(null))
  h.record('ram', { type: 'stats', items: [{ label: 'Used', value: 25, format: 'percent' }, { label: 'Used', value: 34e9, format: 'bytes' }] }, true, 1)
  assert.deepEqual(h.last('ram'), { Used: [1, 25] })
})
