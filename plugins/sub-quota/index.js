const DAY = 86400

/** @param {any} s */
const used = s => s.upload + s.download

/** @param {any} s */
const usedPercent = s => (used(s) / s.total) * 100

/** @param {number} seconds unix time, shown as a local YYYY-MM-DD */
function day (seconds) {
  const d = new Date(seconds * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** @param {number} n */
function bytes (n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
}

/**
 * "upload=1; download=2; total=3; expire=4" into numbers; unknown or empty fields are skipped.
 * @param {string} header
 */
function parseUserinfo (header) {
  /** @type {Record<string, number>} */
  const out = {}
  for (const part of header.split(';')) {
    const m = /^\s*([a-z]+)\s*=\s*(\S+)\s*$/i.exec(part)
    const n = m ? Number(m[2]) : NaN
    if (m && Number.isFinite(n)) out[m[1].toLowerCase()] = n
  }
  return out
}

/**
 * Subscription URLs carry a token: keep URLs out of messages that reach the tile.
 * @param {any} err
 */
function describe (err) {
  if (err?.status) return `the server answered HTTP ${err.status}`
  return String(err?.message ?? err).replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, '<url>')
}

const NO_SESSION = '00000000000000000000000000000000'

/**
 * One ubus JSON-RPC call; `?call=` only labels the request for fixtures, uhttpd ignores it.
 * @param {import('homelabdash/sdk').Context} ctx
 * @param {string} session
 * @param {string} object
 * @param {string} method
 * @param {Record<string, unknown>} params
 */
async function ubus (ctx, session, object, method, params) {
  const oc = ctx.config.openclash
  const r = await ctx.http.json(`${oc.url.replace(/\/+$/, '')}/ubus`, {
    query: { call: `${object}.${method}` },
    json: { jsonrpc: '2.0', id: 1, method: 'call', params: [session, object, method, params] },
    insecure: oc.insecure
  })
  const code = r?.error ? r.error.code : r?.result?.[0]
  if (code) {
    const err = /** @type {Error & { denied?: boolean }} */ (new Error(`router ${object}.${method}: ${r?.error?.message ?? `status ${code}`}`))
    err.denied = code === -32002 || code === 6
    throw err
  }
  return r.result[1] ?? {}
}

/**
 * Subscriptions as OpenClash stores them on the router, so renamed or rotated URLs are picked up.
 * @param {import('homelabdash/sdk').Context} ctx
 */
async function fromOpenClash (ctx) {
  const oc = ctx.config.openclash
  const login = async () => {
    const r = await ubus(ctx, NO_SESSION, 'session', 'login', { username: oc.username, password: oc.password, timeout: 600 })
    ctx.state.set('session', r.ubus_rpc_session)
    return r.ubus_rpc_session
  }
  let session = ctx.state.get('session') ?? await login()
  let res
  try {
    res = await ubus(ctx, session, 'uci', 'get', { config: 'openclash', type: 'config_subscribe' })
  } catch (err) {
    if (!/** @type {any} */ (err).denied) throw err
    session = await login()
    res = await ubus(ctx, session, 'uci', 'get', { config: 'openclash', type: 'config_subscribe' })
  }
  return Object.values(res.values ?? {})
    .filter((/** @type {any} */ v) => v.address && v.enabled !== '0' && (!oc.names?.length || oc.names.includes(v.name)))
    .map((/** @type {any} */ v) => ({ name: v.name ?? v['.name'], url: v.address, userAgent: oc.userAgent }))
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'sub-quota',
  name: 'Subscription quota',
  version: '1.0.0',
  description: 'Traffic used, quota and expiry of proxy subscriptions, read from their Subscription-Userinfo header',
  interval: '30m',
  timeout: '30s',

  config: {
    type: 'object',
    additionalProperties: false,
    anyOf: [{ required: ['subscriptions'] }, { required: ['openclash'] }],
    properties: {
      openclash: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'password'],
        description: 'Read the subscriptions from OpenClash on an OpenWrt router (ubus), instead of listing URLs',
        properties: {
          url: { type: 'string', format: 'uri', description: 'Router web UI, e.g. http://router.example' },
          username: { type: 'string', default: 'root' },
          password: { type: 'string', description: 'Use ${secret:...}' },
          names: { type: 'array', items: { type: 'string' }, description: 'Only these subscriptions (OpenClash names); default every enabled one' },
          userAgent: { type: 'string', default: 'clash.meta' },
          insecure: { type: 'boolean', description: 'Accept a self-signed certificate' }
        }
      },
      subscriptions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'url'],
          properties: {
            name: { type: 'string', minLength: 1, description: 'Label on the tile; also part of the alert ids, so keep names unique' },
            url: { type: 'string', minLength: 1, description: 'Subscription URL; it carries a token, so use ${secret:...}' },
            userAgent: { type: 'string', default: 'clash.meta', description: 'Some providers only send the quota header to Clash clients' }
          }
        }
      },
      usageAlertPercent: { type: 'number', minimum: 0, maximum: 100, default: 90, description: 'Alert when a subscription has used this much of its quota; 0 turns it off' },
      expiryAlertDays: { type: 'number', minimum: 0, default: 7, description: 'Alert this many days before a subscription expires; 0 turns it off (expired still alerts)' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['progress', 'stats'], default: 'progress' }
    }
  },

  examples: [
    {
      title: 'Two providers as bars and as percentages',
      config: {
        subscriptions: [
          { name: 'Provider A', url: 'https://sub-a.example/api/v1/client/subscribe?token=${secret:SUB_A_TOKEN}' },
          { name: 'Provider B', url: 'https://sub-b.example/clash/config?token=${secret:SUB_B_TOKEN}', userAgent: 'mihomo' }
        ]
      },
      tiles: [
        { id: 'bars', options: { view: 'progress' } },
        { id: 'percent', options: { view: 'stats' } }
      ]
    },
    {
      title: 'Subscriptions read from OpenClash on the router',
      config: { openclash: { url: 'http://router.example', password: '${secret:ROUTER_PASSWORD}', names: ['Provider A', 'Provider B'] } },
      options: { view: 'progress' }
    }
  ],

  async fetch (ctx) {
    const list = [...(ctx.config.subscriptions ?? []), ...(ctx.config.openclash ? await fromOpenClash(ctx) : [])]
    const subscriptions = await Promise.all(list.map(async (/** @type {any} */ s) => {
      try {
        const res = await ctx.http.request(s.url, { headers: { 'user-agent': s.userAgent }, parse: 'text', timeout: 25_000 })
        const header = res.headers['subscription-userinfo']
        if (!header) return { name: s.name, error: 'no Subscription-Userinfo header in the answer (try another userAgent)' }
        const q = parseUserinfo(header)
        if (!(q.total > 0)) return { name: s.name, error: 'Subscription-Userinfo has no total' }
        return { name: s.name, upload: q.upload ?? 0, download: q.download ?? 0, total: q.total, expire: q.expire ?? 0 }
      } catch (err) {
        return { name: s.name, error: describe(err) }
      }
    }))
    return { subscriptions }
  },

  render (data, o, ctx) {
    const subs = data.subscriptions ?? []
    const warn = ctx.config.usageAlertPercent || undefined
    if (o.view === 'stats') {
      return {
        type: 'stats',
        items: subs.map((/** @type {any} */ s) => s.error
          ? { label: s.name, value: 'error', format: 'text' }
          : { label: s.name, value: Math.round(usedPercent(s) * 10) / 10, format: 'percent', warn, crit: 100 })
      }
    }
    return {
      type: 'progress',
      items: subs.map((/** @type {any} */ s) => s.error
        ? { label: s.name, value: null, detail: s.error }
        : {
            label: s.name,
            value: used(s),
            max: s.total,
            format: 'bytes',
            detail: `${Math.round(usedPercent(s))}%${s.expire ? ` - expires ${day(s.expire)}` : ''}`,
            warn,
            crit: 100
          })
    }
  },

  alerts (data, ctx) {
    const now = Date.now() / 1000
    const { usageAlertPercent: limit, expiryAlertDays: days } = ctx.config
    const out = []
    for (const s of data.subscriptions ?? []) {
      if (s.error) continue
      const pct = usedPercent(s)
      if (limit && pct >= limit) {
        out.push({ id: `usage:${s.name}`, severity: 'warning', title: `${s.name} has used ${Math.round(pct)}% of its quota`, message: `${bytes(used(s))} of ${bytes(s.total)}` })
      }
      if (s.expire && s.expire <= now) {
        out.push({ id: `expired:${s.name}:${s.expire}`, severity: 'error', title: `${s.name} has expired`, message: `The subscription expired on ${day(s.expire)}` })
      } else if (s.expire && days && s.expire - now <= days * DAY) {
        const left = Math.ceil((s.expire - now) / DAY)
        out.push({ id: `expiring:${s.name}:${s.expire}`, severity: 'warning', title: `${s.name} expires in ${left} day${left === 1 ? '' : 's'}`, message: `The subscription expires on ${day(s.expire)}` })
      }
    }
    return out
  }
}
