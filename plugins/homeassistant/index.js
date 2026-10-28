import { createHash } from 'node:crypto'

// Domains whose entities can be turned on and off with <domain>.toggle
const TOGGLE = new Set(['light', 'switch', 'input_boolean', 'fan', 'automation'])
const ON = new Set(['on', 'home', 'open', 'unlocked', 'playing', 'cleaning'])
const DEAD = new Set(['unavailable', 'unknown'])
const ICON = /^(mdi|si):[a-z0-9-]+$/
/** @type {Record<string, string | [string, string]>} glyph by domain, as [on, off] where the state matters */
const DOMAIN_ICONS = {
  light: ['mdi:lightbulb', 'mdi:lightbulb-outline'],
  switch: ['mdi:toggle-switch', 'mdi:toggle-switch-off-outline'],
  input_boolean: ['mdi:toggle-switch', 'mdi:toggle-switch-off-outline'],
  fan: ['mdi:fan', 'mdi:fan-off'],
  automation: ['mdi:robot', 'mdi:robot-off'],
  person: ['mdi:account', 'mdi:account-outline'],
  binary_sensor: ['mdi:checkbox-marked-circle', 'mdi:checkbox-blank-circle-outline'],
  cover: ['mdi:window-shutter-open', 'mdi:window-shutter'],
  lock: ['mdi:lock-open', 'mdi:lock'],
  climate: 'mdi:thermostat',
  vacuum: 'mdi:robot-vacuum',
  media_player: 'mdi:cast',
  camera: 'mdi:cctv',
  weather: 'mdi:weather-partly-cloudy',
  update: 'mdi:package-up'
}
/** @type {Record<string, string>} */
const SENSOR_ICONS = {
  temperature: 'mdi:thermometer',
  humidity: 'mdi:water-percent',
  battery: 'mdi:battery',
  power: 'mdi:flash',
  energy: 'mdi:lightning-bolt',
  illuminance: 'mdi:brightness-5',
  timestamp: 'mdi:clock-outline'
}
const ENTITY_ID = '^[a-z0-9_]+\\.[a-z0-9_]+$'

/** @param {any} ctx */
const base = ctx => ctx.config.url.replace(/\/+$/, '')
/** @param {any} ctx */
const http = ctx => ({ auth: { bearer: ctx.config.token }, insecure: ctx.config.insecure })
/** @param {string} id */
const domainOf = id => id.split('.')[0]

/**
 * Keeps what the views need from one state object, so the data stays small with a thousand entities.
 * @param {any} e state object from /api/states or a state_changed event
 */
function compact (e) {
  const a = e.attributes ?? {}
  /** @type {Record<string, any>} */
  const c = { state: e.state, name: a.friendly_name ?? e.entity_id }
  if (a.unit_of_measurement) c.unit = a.unit_of_measurement
  if (a.device_class) c.deviceClass = a.device_class
  if (typeof a.icon === 'string' && ICON.test(a.icon)) c.icon = a.icon
  if (a.current_temperature != null) c.current = a.current_temperature
  if (domainOf(e.entity_id) === 'climate' && a.temperature != null) c.target = a.temperature
  if (domainOf(e.entity_id) === 'update') Object.assign(c, { title: a.title ?? null, installed: a.installed_version ?? null, latest: a.latest_version ?? null, notes: a.release_url ?? null })
  return c
}

/** @param {any[]} states */
const snapshot = states => ({ entities: Object.fromEntries(states.map(e => [e.entity_id, compact(e)])) })

/** @param {string | { id: string, name?: string }} ref */
const refOf = ref => typeof ref === 'string' ? { id: ref, name: undefined } : ref

/** @param {string} state */
function number (state) {
  const n = Number(state)
  return state !== '' && Number.isFinite(n) ? n : null
}

/** @param {string} id @param {any} e */
function iconOf (id, e) {
  if (e.icon) return e.icon
  const domain = domainOf(id)
  if (domain === 'sensor') return SENSOR_ICONS[e.deviceClass] ?? 'mdi:gauge'
  const icon = DOMAIN_ICONS[domain] ?? 'mdi:eye'
  return Array.isArray(icon) ? icon[ON.has(e.state) ? 0 : 1] : icon
}

/** @param {string} id @param {any} e */
function stateText (id, e) {
  const n = number(e.state)
  if (n != null) return `${n.toLocaleString('en', { maximumFractionDigits: 1 })}${e.unit ? ` ${e.unit}` : ''}`
  if (domainOf(id) === 'climate' && e.current != null) return `${e.current}°${e.target != null ? ` (set to ${e.target}°)` : ''}`
  if (domainOf(id) === 'person') return e.state === 'not_home' ? 'away' : e.state.replace(/_/g, ' ')
  return e.state.replace(/_/g, ' ')
}

/** @param {any} data */
const pendingUpdates = data => Object.entries(data.entities).filter(([id, e]) => domainOf(id) === 'update' && e.state === 'on')

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'homeassistant',
  name: 'Home Assistant',
  version: '0.1.0',
  description: 'Entities from Home Assistant: lights, switches, sensors, people and pending updates, live over its WebSocket API; lights and switches can be turned on and off',
  interval: '1m',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'token'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'Home Assistant address, e.g. http://homeassistant.example:8123' },
      token: { type: 'string', description: 'Long-lived access token (your Home Assistant profile > Security); use ${secret:...}' },
      insecure: { type: 'boolean', description: 'Accept a self-signed certificate' },
      allowControl: { type: 'boolean', default: false, description: 'Offer Turn on / Turn off on lights, switches, fans, input booleans and automations' },
      updateAlerts: { type: 'boolean', default: true, description: 'Raise an alert while Home Assistant has updates to install' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: {
        enum: ['entities', 'stats', 'summary', 'updates'],
        default: 'entities',
        description: 'entities: one row per entity; stats: the entities as numbers side by side; summary: lights on, people at home, updates; updates: what can be updated'
      },
      entities: {
        type: 'array',
        description: 'Entity ids such as light.kitchen, or { id, name } to show another name: the rows of the entities view, the numbers of the stats view, and for the summary the lights that count',
        items: {
          anyOf: [
            { type: 'string', pattern: ENTITY_ID },
            { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', pattern: ENTITY_ID }, name: { type: 'string' } } }
          ]
        }
      }
    }
  },

  examples: [
    {
      title: 'A home at a glance',
      config: { url: 'http://homeassistant.example:8123', token: 'test-token', allowControl: true },
      tiles: [
        { id: 'summary', options: { view: 'summary' } },
        { id: 'rooms', options: { view: 'entities', entities: ['light.kitchen', 'light.living_room', 'light.garage', 'switch.coffee_machine', 'climate.living_room', { id: 'person.alex', name: 'Alex' }] } },
        { id: 'climate', options: { view: 'stats', entities: [{ id: 'sensor.outdoor_temperature', name: 'Outside' }, { id: 'sensor.living_room_humidity', name: 'Humidity' }] } },
        { id: 'updates', options: { view: 'updates' } }
      ]
    }
  ],

  async fetch (ctx) {
    return snapshot(await ctx.http.json(`${base(ctx)}/api/states`, http(ctx)))
  },

  // Every state change arrives on Home Assistant's WebSocket, so the tiles follow lights and sensors as they change.
  async stream (ctx, emit) {
    const ws = ctx.ws.connect(`${base(ctx).replace(/^http/, 'ws')}/api/websocket`, { insecure: ctx.config.insecure })
    for await (const m of ws) {
      switch (m?.type) {
        case 'auth_required':
          await ws.send({ type: 'auth', access_token: ctx.config.token })
          break
        case 'auth_invalid':
          throw new Error(`Home Assistant refused the token: ${m.message ?? 'invalid'}`)
        case 'auth_ok':
          await ws.send({ id: 1, type: 'get_states' })
          await ws.send({ id: 2, type: 'subscribe_events', event_type: 'state_changed' })
          break
        case 'result':
          if (!m.success) throw new Error(`Home Assistant: ${m.error?.message ?? 'request failed'}`)
          if (m.id === 1) emit(snapshot(m.result))
          break
        case 'event': {
          const d = m.event?.data
          if (!d?.entity_id) break
          emit((/** @type {any} */ prev) => {
            if (!prev) return prev
            const entities = { ...prev.entities }
            if (d.new_state) entities[d.entity_id] = compact(d.new_state)
            else delete entities[d.entity_id]
            return { ...prev, entities }
          })
        }
      }
    }
  },

  render (data, o, ctx) {
    const refs = (o.entities ?? []).map(refOf)
    /** @type {import('homelabdash/sdk').View} */
    const missing = { type: 'text', text:'List the entities to show in options.entities, e.g. [light.kitchen, sensor.outdoor_temperature]', tone: 'info' }
    switch (o.view) {
      case 'summary': {
        const all = Object.entries(data.entities)
        const people = all.filter(([id]) => domainOf(id) === 'person')
        // devices often expose their status LEDs as lights, so a list of the real ones can replace "every light"
        const listed = refs.map((/** @type {{ id: string }} */ r) => r.id).filter((/** @type {string} */ id) => domainOf(id) === 'light')
        const lights = listed.length ? listed.map((/** @type {string} */ id) => data.entities[id]).filter(Boolean) : all.filter(([id]) => domainOf(id) === 'light').map(([, e]) => e)
        return {
          type: 'stats',
          items: [
            { label: 'Lights on', value: lights.filter((/** @type {any} */ e) => e.state === 'on').length, format: 'number' },
            ...(people.length ? [{ label: 'At home', value: people.filter(([, e]) => e.state === 'home').length, format: 'number' }] : []),
            { label: 'Updates', value: pendingUpdates(data).length, format: 'number', warn: 1, href: `${base(ctx)}/config/updates` }
          ]
        }
      }
      case 'updates':
        return {
          type: 'list',
          empty: 'Everything is up to date',
          items: pendingUpdates(data).map(([id, e]) => ({
            key: id,
            title: e.title ?? e.name,
            subtitle: e.installed && e.latest ? `${e.installed} → ${e.latest}` : undefined,
            icon: 'mdi:package-up',
            href: e.notes ?? `${base(ctx)}/config/updates`
          }))
        }
      case 'stats':
        if (!refs.length) return missing
        return {
          type: 'stats',
          items: refs.map((/** @type {{ id: string, name?: string }} */ { id, name }) => {
            const e = data.entities[id]
            if (!e) return { label: name ?? id, value: 'not found', format: 'text', tone: 'warning' }
            const n = number(e.state)
            if (n != null) return { label: name ?? e.name, value: n, format: 'number', unit: e.unit }
            if (domainOf(id) === 'climate' && e.current != null) return { label: name ?? e.name, value: e.current, format: 'number', unit: '°' }
            return { label: name ?? e.name, value: stateText(id, e), format: 'text', tone: DEAD.has(e.state) ? 'warning' : undefined }
          })
        }
      default:
        if (!refs.length) return missing
        return {
          type: 'list',
          items: refs.map((/** @type {{ id: string, name?: string }} */ { id, name }) => {
            const e = data.entities[id]
            if (!e) return { key: id, title: name ?? id, subtitle: 'not found in Home Assistant', icon: 'mdi:help-circle-outline', tone: 'warning' }
            const dead = DEAD.has(e.state)
            const on = e.state === 'on'
            return {
              key: id,
              title: name ?? e.name,
              icon: iconOf(id, e),
              value: dead ? undefined : stateText(id, e),
              format: 'text',
              badge: dead ? { text: e.state, tone: 'warning' } : undefined,
              actions: ctx.config.allowControl && !dead && TOGGLE.has(domainOf(id))
                ? [{ action: 'toggle', title: on ? 'Turn off' : 'Turn on', input: { entity: id } }]
                : undefined
            }
          })
        }
    }
  },

  status (data, key) {
    const e = data.entities[key]
    if (!e) return { state: 'unknown', label: 'no such entity' }
    if (DEAD.has(e.state)) return { state: 'down', label: e.state }
    if (e.state === 'off' || e.state === 'not_home') return { state: 'warn', label: e.state.replace(/_/g, ' ') }
    return { state: 'up', label: e.state.replace(/_/g, ' ') }
  },

  alerts (data, ctx) {
    const ups = pendingUpdates(data)
    if (!ctx.config.updateAlerts || !ups.length) return []
    const names = ups.map(([, e]) => e.title ?? e.name)
    return [{
      // the same set of versions keeps its id, so a dismissed alert comes back only when something new is out
      id: `updates:${createHash('sha1').update(ups.map(([id, e]) => `${id}@${e.latest}`).sort().join(',')).digest('hex').slice(0, 12)}`,
      severity: 'info',
      title: ups.length === 1 ? `Update available: ${names[0]}` : `${ups.length} updates available`,
      message: names.slice(0, 5).join(', ') + (names.length > 5 ? ` and ${names.length - 5} more` : ''),
      href: `${base(ctx)}/config/updates`
    }]
  },

  actions: {
    toggle: {
      title: 'Turn on or off',
      input: { type: 'object', additionalProperties: false, required: ['entity'], properties: { entity: { type: 'string', pattern: ENTITY_ID } } },
      async run (ctx, input) {
        if (!ctx.config.allowControl) throw new Error('control is off for this source (set allowControl: true)')
        const domain = domainOf(input.entity)
        if (!TOGGLE.has(domain)) throw new Error(`${input.entity} can't be turned on or off from the dashboard`)
        await ctx.http.json(`${base(ctx)}/api/services/${domain}/toggle`, { ...http(ctx), json: { entity_id: input.entity } })
        return { ok: true }
      }
    }
  }
}
