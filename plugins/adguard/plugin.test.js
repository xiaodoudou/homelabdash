import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://adguard.example', username: 'admin', password: 'test-password' }
const fixtures = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'http.json'), 'utf8'))
const status = fixtures['GET /control/status'].body

/** @param {Record<string, unknown>} patch */
const withStatus = patch => ({ ...fixtures, 'GET /control/status': { body: { ...status, ...patch } } })

test('summary: queries, blocked, filtered and latency in ms', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.view?.items.map(i => [i.label, i.value]), [['Queries', 12840], ['Blocked', 1693], ['Filtered', 50], ['Latency', 12.5]])
  assert.equal(r.view.items[3].unit, 'ms')
  assert.deepEqual(r.alerts, [])
})

test('top blocked domains with counts, default limit 5', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'blocked' } })
  assert.equal(r.view?.items.length, 5)
  assert.deepEqual(r.view.items[0], { key: 'ads.tracker.example', title: 'ads.tracker.example', value: 812, format: 'number' })
  const two = await runPlugin(import.meta.dirname, { config, options: { view: 'blocked', limit: 2 } })
  assert.deepEqual(two.view?.items.map(i => i.title), ['ads.tracker.example', 'telemetry.example'])
})

test('protection off raises an error alert, with Enable only when control is allowed', async () => {
  const off = withStatus({ protection_enabled: false, protection_disabled_duration: 540000 })
  const r = await runPlugin(import.meta.dirname, { config, fixtures: off })
  assert.equal(r.alerts.length, 1)
  assert.equal(r.alerts[0].id, 'protection-off')
  assert.equal(r.alerts[0].severity, 'error')
  assert.equal(r.alerts[0].message, 'Protection comes back in 9 min')
  assert.deepEqual(r.alerts[0].actions, [])
  const c = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, fixtures: withStatus({ protection_enabled: false }) })
  assert.match(c.alerts[0].message ?? '', /until someone turns it back on/)
  assert.deepEqual(c.alerts[0].actions?.map(a => a.name), ['enable'])
})

test('enable and disable are refused unless allowControl', async () => {
  await assert.rejects(runPlugin(import.meta.dirname, { config, action: 'disable' }), /allowControl/)
  const d = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, action: 'disable' })
  assert.deepEqual(d.result, { enabled: false })
  const e = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, action: 'enable' })
  assert.deepEqual(e.result, { enabled: true })
})

test('the tile offers the button that fits the current state, only with allowControl', async () => {
  const on = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true } })
  assert.deepEqual(on.view?.actions, [{ action: on.data.protection ? 'disable' : 'enable', title: on.data.protection ? 'Disable protection' : 'Enable protection' }])
  const off = await runPlugin(import.meta.dirname, { config })
  assert.equal(off.view?.actions, undefined)
})

test('rejected credentials are named', async () => {
  const fx = { ...fixtures, 'GET /control/stats': { status: 401, body: 'Unauthorized' } }
  await assert.rejects(runPlugin(import.meta.dirname, { config, fixtures: fx }), /answered 401 to \/control\/stats: check username and password/)
})

test('username needs a password', async () => {
  await assert.rejects(runPlugin(import.meta.dirname, { config: { url: 'http://adguard.example', username: 'admin' } }), /invalid config/)
})

test('today: the last daily bucket, or all hourly buckets', async () => {
  const stats = fixtures['GET /control/stats'].body
  const daily = { ...stats, time_units: 'days', dns_queries: [900, 120], blocked_filtering: [90, 12], replaced_safebrowsing: [5, 1], replaced_parental: [0, 2] }
  const days = await runPlugin(import.meta.dirname, { config, options: { view: 'summary', period: 'today' }, fixtures: { ...fixtures, 'GET /control/stats': { body: daily } } })
  assert.deepEqual(days.view?.items.slice(0, 3).map(i => [i.label, i.value]), [['Queries today', 120], ['Blocked today', 12], ['Filtered today', 3]])
  const hours = await runPlugin(import.meta.dirname, { config, options: { view: 'summary', period: 'today' } })
  const sum = (/** @type {number[]} */ a) => a.reduce((x, y) => x + y, 0)
  assert.equal(hours.view?.items[0].value, sum(stats.dns_queries))
})
