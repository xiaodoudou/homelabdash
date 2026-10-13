import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://tower.example', apiKey: 'test-key' }

test('one fetch feeds several tiles', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config,
    tiles: [
      { id: 'cpu', options: { metric: 'cpu' } },
      { id: 'array', options: { metric: 'array' } },
      { id: 'cache', options: { metric: 'pool', pool: 'cache' } },
      { id: 'status' }
    ]
  })
  assert.equal(r.views.cpu.view?.items[0].value, 7.5)
  assert.equal(r.views.array.view?.items[0].value, 75)
  assert.equal(r.views.array.view?.items[2].value, 2000000000 * 1000, 'API kilobytes are 1000 bytes')
  assert.equal(r.views.cache.view?.items[0].value, 25)
  assert.equal(r.views.status.view?.items[0].value, 'started')
})

test('notifications from WARNING up become alerts, repeats grouped by title', async () => {
  const r = await runPlugin(import.meta.dirname, { config })
  assert.deepEqual(r.alerts.map(a => a.severity), ['error', 'warning'])
  assert.equal(r.alerts[0].title, 'Docker image disk utilization (2 times)')
  assert.equal(r.alerts[0].href, 'http://tower.example/Docker')
  assert.deepEqual(r.alerts[0].actions?.[0], { name: 'archive', title: 'Archive all', input: { ids: ['abc:Docker_image_disk_utilization_1.notify', 'abc:Docker_image_disk_utilization_0.notify'] } })
  assert.deepEqual(r.alerts[1].actions?.[0].input, { id: 'abc:Parity_Check_2.notify' })
})

test('grouping can be turned off', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { ...config, notifications: { group: false } } })
  assert.equal(r.alerts.length, 3)
})

test('archive one or many', async () => {
  const one = await runPlugin(import.meta.dirname, { config, action: 'archive', input: { id: 'abc:Parity_Check_2.notify' } })
  assert.deepEqual(one.result, { archived: 1 })
  const many = await runPlugin(import.meta.dirname, { config, action: 'archive', input: { ids: ['a', 'b'] } })
  assert.deepEqual(many.result, { archived: 2 })
  await assert.rejects(runPlugin(import.meta.dirname, { config, action: 'archive', input: {} }), /input.id or input.ids/)
})

test('unknown pool is explained', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { metric: 'pool', pool: 'fast' } })
  assert.match(r.view?.text ?? '', /pools: cache/)
})

test('archive buttons can be turned off for a read-only key', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { ...config, notifications: { archive: false } }, options: { metric: 'notifications' } })
  assert.ok(r.alerts.every(a => !a.actions?.length))
  assert.ok(r.view?.items.every((/** @type {any} */ i) => !i.actions))
})

test('a key without write access gets an explanation, not "Forbidden resource"', async () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/http.json', import.meta.url), 'utf8'))
  fixtures['POST /graphql#Archive'] = { body: { errors: [{ message: 'Forbidden resource' }], data: null } }
  await assert.rejects(
    runPlugin(import.meta.dirname, { config, fixtures, action: 'archive', input: { id: 'x' } }),
    /may not archive notifications/
  )
})
