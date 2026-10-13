const NULL_SESSION = '00000000000000000000000000000000'
const SESSION_TIMEOUT = 600
const CONNTRACK = '/proc/sys/net/netfilter/nf_conntrack_'
const MAX_RATE_GAP_MS = 3_600_000
// JSON-RPC errors uhttpd answers for an unknown or expired session (or a call the ACL refuses).
const SESSION_ERRORS = new Set([-32001, -32002])
const STATUS = ['ok', 'invalid command', 'invalid argument', 'method not found', 'not found', 'no data', 'permission denied', 'timeout', 'not supported', 'unknown error', 'connection failed']

class UbusError extends Error {
  /** @param {string} message @param {'denied' | 'missing' | 'failed'} reason */
  constructor (message, reason) {
    super(message)
    this.reason = reason
  }
}

/** @param {unknown} v */
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null

/** @param {number | null} part @param {number | null} whole */
const percent = (part, whole) => part !== null && whole ? (part / whole) * 100 : null

/**
 * ubus over JSON-RPC with the session kept in ctx.state. A denial before any call of this fetch
 * succeeded means the stored session expired; after one succeeded it means the ACL refuses that call.
 * @param {import('homelabdash/sdk').Context} ctx
 */
function ubus (ctx) {
  const url = `${ctx.config.url.replace(/\/+$/, '')}/ubus`
  let id = 0
  let verified = false

  /**
   * @param {string} session @param {string} object @param {string} method @param {object} args
   * @param {Record<string, string>} [tag] extra query parameters: uhttpd ignores them, fixtures match on them
   */
  async function post (session, object, method, args, tag) {
    const res = await ctx.http.json(url, {
      query: { call: `${object}.${method}`, ...tag },
      json: { jsonrpc: '2.0', id: ++id, method: 'call', params: [session, object, method, args] },
      insecure: ctx.config.insecure
    })
    const what = `ubus ${object} ${method}`
    if (res?.error) {
      const { code, message } = res.error
      if (SESSION_ERRORS.has(code)) throw new UbusError(`${what}: ${message} (the rpcd ACL of "${ctx.config.username}" must allow it)`, 'denied')
      throw new UbusError(`${what}: ${message} (${code})`, code === -32000 ? 'missing' : 'failed')
    }
    const [status, data] = Array.isArray(res?.result) ? res.result : [9]
    if (status === 0) return data ?? {}
    throw new UbusError(`${what}: ${STATUS[status] ?? `status ${status}`}`, status === 6 ? 'denied' : status === 4 ? 'missing' : 'failed')
  }

  async function login () {
    const { username, password } = ctx.config
    const r = await post(NULL_SESSION, 'session', 'login', { username, password, timeout: SESSION_TIMEOUT }).catch(err => {
      throw err instanceof UbusError && err.reason === 'denied' ? new Error(`login as "${username}" refused: check username and password`) : err
    })
    if (typeof r.ubus_rpc_session !== 'string') throw new Error('session.login answered without a session')
    ctx.state.set('session', r.ubus_rpc_session)
    verified = true
    return r.ubus_rpc_session
  }

  /** @param {string} object @param {string} method @param {object} [args] @param {Record<string, string>} [tag] */
  return async function call (object, method, args = {}, tag) {
    const stored = ctx.state.get('session')
    const session = stored ?? await login()
    try {
      const out = await post(session, object, method, args, tag)
      verified = true
      return out
    } catch (err) {
      if (!(err instanceof UbusError) || err.reason !== 'denied' || verified || !stored) throw err
    }
    return await post(await login(), object, method, args, tag)
  }
}

/**
 * @param {(object: string, method: string, args?: object, tag?: Record<string, string>) => Promise<any>} call
 * @returns {Promise<{ count: number | null, max: number | null, unavailable?: string }>}
 */
async function conntrack (call) {
  try {
    const [count, max] = await Promise.all(['count', 'max'].map(async key => {
      const path = CONNTRACK + key
      const n = Number.parseInt((await call('file', 'read', { path }, { path })).data, 10)
      return Number.isFinite(n) ? n : null
    }))
    return { count, max }
  } catch (err) {
    if (!(err instanceof UbusError) || err.reason === 'failed') throw err
    return { count: null, max: null, unavailable: err.reason === 'denied' ? 'the rpcd ACL does not allow file read of /proc/sys/net/netfilter/nf_conntrack_*' : 'the router has no /proc/sys/net/netfilter/nf_conntrack_*' }
  }
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'openwrt',
  name: 'OpenWrt',
  version: '1.0.0',
  description: 'WAN status, traffic and rates, conntrack usage, load, memory and uptime of an OpenWrt router over ubus (JSON-RPC)',
  interval: '10s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'password'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'Router web address (LuCI), e.g. http://router.example' },
      username: { type: 'string', default: 'root', description: 'rpcd login (root, or a read-only user from /etc/config/rpcd)' },
      password: { type: 'string', description: 'Use ${secret:...}' },
      insecure: { type: 'boolean', default: false, description: 'Accept the self-signed certificate of uhttpd' },
      interface: { type: 'string', default: 'wan', description: 'Logical interface to watch (network.interface.<name>)' },
      conntrack: { type: 'boolean', default: true, description: 'Read the conntrack counters from /proc/sys/net/netfilter' },
      conntrackAlertPercent: { type: 'number', minimum: 0, maximum: 100, default: 90, description: 'Raise an alert when the conntrack table is this full; 0 turns it off' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['wan', 'conntrack', 'system'], default: 'wan' }
    }
  },

  examples: [
    {
      title: 'WAN, conntrack and system of one router',
      config: { url: 'http://router.example', username: 'root', password: '${secret:ROUTER_PASSWORD}' },
      tiles: [
        { id: 'wan', options: { view: 'wan' } },
        { id: 'conntrack', options: { view: 'conntrack' } },
        { id: 'system', options: { view: 'system' } }
      ]
    },
    {
      title: 'Read-only user over HTTPS, without conntrack',
      config: { url: 'https://router.example', username: 'homelabdash', password: '${secret:ROUTER_PASSWORD}', insecure: true, conntrack: false },
      options: { view: 'wan' }
    }
  ],

  async fetch (ctx) {
    const call = ubus(ctx)
    const name = ctx.config.interface
    const iface = await call(`network.interface.${name}`, 'status').catch(err => {
      throw err instanceof UbusError && err.reason === 'missing' ? new Error(`the router has no interface "${name}"`) : err
    })
    const device = typeof iface.l3_device === 'string' ? iface.l3_device : null
    const [dev, ct, info] = await Promise.all([
      device
        ? call('network.device', 'status', { name: device }).catch(err => {
          if (err instanceof UbusError && err.reason === 'missing') return null
          throw err
        })
        : null,
      ctx.config.conntrack ? conntrack(call) : null,
      call('system', 'info')
    ])

    const rx = num(dev?.statistics?.rx_bytes)
    const tx = num(dev?.statistics?.tx_bytes)
    const now = Date.now()
    let rxRate = null
    let txRate = null
    if (rx !== null && tx !== null) {
      const prev = ctx.state.get('counters')
      // Counters restart when the device is recreated (PPPoE redial, reboot): skip that sample.
      if (prev && prev.device === device && rx >= prev.rx && tx >= prev.tx && now > prev.at && now - prev.at <= MAX_RATE_GAP_MS) {
        const seconds = (now - prev.at) / 1000
        rxRate = (rx - prev.rx) / seconds
        txRate = (tx - prev.tx) / seconds
      }
      ctx.state.set('counters', { device, rx, tx, at: now })
    }

    const mem = info.memory ?? {}
    const available = num(mem.available) ?? (num(mem.free) !== null ? mem.free + (num(mem.buffered) ?? 0) + (num(mem.cached) ?? 0) : null)
    const total = num(mem.total)
    const used = total !== null && available !== null ? total - available : null
    // ubus reports load as fixed point with 16 fractional bits.
    const load = Array.isArray(info.load) ? info.load.map((/** @type {number} */ l) => Math.round((l / 65536) * 100) / 100) : []

    return {
      interface: { name, up: iface.up === true, uptime: iface.up ? num(iface.uptime) : null, ipv4: (iface.up && iface['ipv4-address']?.[0]?.address) || null, device, proto: iface.proto ?? null },
      traffic: { rx, tx, rxRate, txRate },
      conntrack: ct,
      system: { uptime: num(info.uptime), load, memory: { total, used, percent: percent(used, total) } }
    }
  },

  render (data, o) {
    switch (o.view) {
      case 'conntrack': {
        const c = data.conntrack
        if (!c) return { type: 'text', text: 'Conntrack counters are off for this source (conntrack: false)', tone: 'neutral' }
        if (c.unavailable) return { type: 'text', text: `No conntrack counters: ${c.unavailable}`, tone: 'warning' }
        return {
          type: 'stats',
          items: [
            { label: 'Active', value: c.count, format: 'number' },
            { label: 'Of max', value: percent(c.count, c.max), format: 'percent', warn: 80, crit: 90 }
          ]
        }
      }
      case 'system':
        return {
          type: 'stats',
          items: [
            { label: 'Load', value: data.system.load[0] ?? null, format: 'number' },
            { label: 'Memory', value: data.system.memory.percent, format: 'percent', warn: 85, crit: 95 },
            { label: 'Uptime', value: data.system.uptime, format: 'duration' }
          ]
        }
      default:
        return {
          type: 'stats',
          items: [
            data.interface.up
              ? { label: 'Uptime', value: data.interface.uptime, format: 'duration' }
              : { label: 'Uptime', value: 'down', format: 'text', tone: 'error' },
            { label: 'IPv4', value: data.interface.ipv4, format: 'text' },
            { label: 'Received', value: data.traffic.rx, format: 'bytes' },
            { label: 'Sent', value: data.traffic.tx, format: 'bytes' },
            { label: 'Down', value: data.traffic.rxRate, format: 'byterate' },
            { label: 'Up', value: data.traffic.txRate, format: 'byterate' }
          ]
        }
    }
  },

  alerts (data, ctx) {
    const out = []
    const i = data.interface
    if (!i.up) out.push({ id: 'wan-down', severity: 'error', title: `${i.name} is down`, message: `The router reports interface "${i.name}" down` })
    const c = data.conntrack
    const used = c ? percent(c.count, c.max) : null
    const limit = ctx.config.conntrackAlertPercent
    if (limit && used !== null && used >= limit) {
      out.push({ id: 'conntrack-high', severity: 'warning', title: `Conntrack table ${Math.round(used)}% full`, message: `${c.count} of ${c.max} entries; the router drops new connections once it is full` })
    }
    return out
  }
}
