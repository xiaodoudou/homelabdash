import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Alerts } from '../src/runtime/alerts.js'
import { createStore } from '../src/runtime/store.js'

/** @param {string} id @param {'info'|'warning'|'error'} severity @param {string} [time] */
const alert = (id, severity = 'warning', time) => ({ id, severity, message: id, time, actions: [] })

test('sorted by severity then newest first', () => {
  const a = new Alerts(createStore(null))
  a.set('s1', 'One', [alert('old', 'warning', '2026-01-01'), alert('new', 'warning', '2026-02-01')])
  a.set('s2', 'Two', [alert('bad', 'error')])
  assert.deepEqual(a.active().map(x => x.key), ['s2:bad', 's1:new', 's1:old'])
})

test('a dismissed alert stays hidden while it fires and comes back after it stopped', () => {
  const store = createStore(null)
  const a = new Alerts(store)
  a.set('s', 'S', [alert('x')])
  assert.equal(a.dismiss('s:x'), true)
  assert.equal(a.active().length, 0)
  a.set('s', 'S', [alert('x')])
  assert.equal(a.active().length, 0, 'still dismissed while firing')
  a.set('s', 'S', [])
  a.set('s', 'S', [alert('x')])
  assert.equal(a.active().length, 1, 'fires again after clearing')
})

test('a failed source keeps its previous alerts and dismissals', () => {
  const a = new Alerts(createStore(null))
  a.set('s', 'S', [alert('x'), alert('y')])
  a.dismiss('s:x')
  assert.equal(a.set('s', 'S', null), false)
  assert.deepEqual(a.active().map(x => x.id), ['y'])
  assert.ok(a.dismissed.has('s:x'))
})

test('dismissals survive a restart through the store', () => {
  const store = createStore(null)
  const a = new Alerts(store)
  a.set('s', 'S', [alert('x')])
  a.dismiss('s:x')
  const b = new Alerts(store)
  b.set('s', 'S', [alert('x')])
  assert.equal(b.active().length, 0)
})

test('the view offers plugin actions and dismiss', () => {
  const a = new Alerts(createStore(null))
  a.set('s', 'Server', [{ ...alert('x', 'error'), title: 'Disk', actions: [{ name: 'archive', title: 'Archive', input: { id: 1 } }] }])
  const v = a.view()
  assert.equal(v.limit, 6, 'long alert lists are collapsed in the page')
  assert.equal(v.items[0].subtitle, 'Server - x')
  assert.deepEqual(v.items[0].actions.map(x => x.action), ['run', 'dismiss'])
  assert.deepEqual(v.items[0].actions[0].input, { key: 's:x', name: 'archive', input: { id: 1 } })
})
