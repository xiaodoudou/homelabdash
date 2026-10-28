import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'

const config = { url: 'http://homeassistant.example:8123/', token: 'test-token' }
const rooms = ['light.kitchen', 'light.garage', 'switch.coffee_machine', 'sensor.outdoor_temperature', 'climate.living_room', { id: 'person.alex', name: 'Alex' }, 'light.attic']

test('the summary counts lights on, people at home and pending updates', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'summary' } })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.label, i.value]), [['Lights on', 1], ['At home', 1], ['Updates', 2]])
  assert.equal(r.view.items[2].href, 'http://homeassistant.example:8123/config/updates')
  const listed = await runPlugin(import.meta.dirname, { config, options: { view: 'summary', entities: ['light.living_room', 'light.garage'] } })
  assert.equal(listed.view.items[0].value, 0, 'listed lights replace every light, so status LEDs exposed as lights stay out')
})

test('entity rows show the state the way Home Assistant does, and say what is missing', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { entities: rooms } })
  const rows = r.view.items
  assert.deepEqual(rows.map((/** @type {any} */ i) => [i.title, i.value ?? i.badge?.text ?? i.subtitle]), [
    ['Kitchen', 'on'],
    ['Garage', 'unavailable'],
    ['Coffee machine', 'on'],
    ['Outdoor temperature', '12.5 °C'],
    ['Living room thermostat', '20.5° (set to 21°)'],
    ['Alex', 'home'],
    ['light.attic', 'not found in Home Assistant']
  ])
  assert.deepEqual(rows.map((/** @type {any} */ i) => i.icon), ['mdi:lightbulb', 'mdi:lightbulb-outline', 'mdi:coffee-maker', 'mdi:thermometer', 'mdi:thermostat', 'mdi:account', 'mdi:help-circle-outline'])
  assert.equal(rows[1].badge.tone, 'warning')
  assert.ok(rows.every((/** @type {any} */ i) => !i.actions), 'no buttons unless allowControl is set')
})

test('with allowControl, lights and switches get a button that fits their state', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, options: { entities: rooms } })
  const buttons = Object.fromEntries(r.view.items.filter((/** @type {any} */ i) => i.actions).map((/** @type {any} */ i) => [i.key, i.actions[0].title]))
  assert.deepEqual(buttons, { 'light.kitchen': 'Turn off', 'switch.coffee_machine': 'Turn off' }, 'nothing for an unavailable light, a sensor or a person')
})

test('the toggle action calls the service of the entity domain, and only when allowed', async () => {
  const ok = await runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, action: 'toggle', input: { entity: 'switch.coffee_machine' } })
  assert.deepEqual(ok.result, { ok: true })
  await assert.rejects(runPlugin(import.meta.dirname, { config, action: 'toggle', input: { entity: 'light.kitchen' } }), /allowControl/)
  await assert.rejects(runPlugin(import.meta.dirname, { config: { ...config, allowControl: true }, action: 'toggle', input: { entity: 'sensor.outdoor_temperature' } }), /can't be turned on or off/)
})

test('stats show numbers with their unit', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'stats', entities: ['sensor.outdoor_temperature', { id: 'sensor.living_room_humidity', name: 'Humidity' }, 'climate.living_room', 'light.garage'] } })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.label, i.value, i.unit]), [
    ['Outdoor temperature', 12.46, '°C'],
    ['Humidity', 48, '%'],
    ['Living room thermostat', 20.5, '°'],
    ['Garage', 'unavailable', undefined]
  ])
  assert.equal(r.view.items[3].tone, 'warning')
})

test('entities and stats views explain what to configure when no entity is listed', async () => {
  for (const view of ['entities', 'stats']) {
    const r = await runPlugin(import.meta.dirname, { config, options: { view } })
    assert.equal(r.view.type, 'text')
    assert.match(r.view.text, /options\.entities/)
  }
})

test('pending updates are listed, and raise one alert that keeps its id while the versions stay the same', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'updates' } })
  assert.deepEqual(r.view.items.map((/** @type {any} */ i) => [i.title, i.subtitle, i.href]), [
    ['Home Assistant Core', '2026.10.1 → 2026.10.3', 'https://release-notes.example/core/2026.10.3'],
    ['ESPHome', '2026.9.2 → 2026.10.0', 'http://homeassistant.example:8123/config/updates']
  ])
  assert.equal(r.alerts.length, 1)
  assert.equal(r.alerts[0].title, '2 updates available')
  assert.equal(r.alerts[0].message, 'Home Assistant Core, ESPHome')
  const again = await runPlugin(import.meta.dirname, { config })
  assert.equal(again.alerts[0].id, r.alerts[0].id)
  const off = await runPlugin(import.meta.dirname, { config: { ...config, updateAlerts: false } })
  assert.deepEqual(off.alerts, [])
})

test('status dots follow an entity', async () => {
  const r = await runPlugin(import.meta.dirname, {
    config,
    statusKeys: [{ tileId: 'a', key: 'light.kitchen' }, { tileId: 'b', key: 'light.living_room' }, { tileId: 'c', key: 'light.garage' }, { tileId: 'd', key: 'light.attic' }]
  })
  assert.deepEqual(Object.values(r.statuses).map(s => s.state), ['up', 'warn', 'down', 'unknown'])
})

test('the stream logs in, takes a snapshot, then follows state changes', async () => {
  const r = await runPlugin(import.meta.dirname, { config, options: { view: 'summary' }, stream: true })
  const states = r.updates.map(u => [u.data.entities['light.kitchen']?.state, u.data.entities['light.living_room']?.state])
  assert.deepEqual(states.at(-1), ['off', 'on'])
  assert.equal(Object.keys(r.updates.at(-1)?.data.entities ?? {}).length, 3, 'the snapshot from the WebSocket replaces the one from fetch')
})
