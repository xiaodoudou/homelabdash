const DAY = 86_400_000
const TONE = /** @type {Record<string, string>} */ ({ expired: 'error', expiring: 'warning', valid: 'ok', unknown: 'neutral' })

/** @param {unknown} v true/false in recent NPM versions, 1/0 in older ones */
const yes = v => v === true || v === 1 || v === '1'

/** @param {any} config */
const base = config => String(config.url).replace(/\/+$/, '')

/**
 * SQLite installs return "YYYY-MM-DD HH:mm:ss" (container time, usually UTC), MySQL ones an ISO string.
 * @param {unknown} v
 */
function iso (v) {
  if (typeof v !== 'string' || !v) return null
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v) ? v.replace(' ', 'T') + 'Z' : v)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** @param {{ expiresAt: string | null }} c @param {number} days */
function expiry (c, days) {
  if (!c.expiresAt) return 'unknown'
  const left = Date.parse(c.expiresAt) - Date.now()
  return left <= 0 ? 'expired' : left <= days * DAY ? 'expiring' : 'valid'
}

/** @param {import('homelabdash/sdk').Context} ctx */
async function login (ctx) {
  /** @type {any} */
  let res
  try {
    res = await ctx.http.json(`${base(ctx.config)}/api/tokens`, { json: { identity: ctx.config.email, secret: ctx.config.password } })
  } catch (err) {
    throw new Error(`Nginx Proxy Manager login failed: ${/** @type {Error} */ (err).message}`)
  }
  if (typeof res?.token !== 'string') throw new Error('Nginx Proxy Manager login returned no token')
  ctx.state.set('session', { token: res.token, expires: res.expires ?? null, url: base(ctx.config), email: ctx.config.email })
  return res.token
}

/**
 * @param {import('homelabdash/sdk').Context} ctx
 * @returns {Promise<{ token: string, fresh: boolean }>}
 */
async function session (ctx) {
  const s = ctx.state.get('session')
  // State survives config edits: never send a token to another server or for another user.
  if (s?.url === base(ctx.config) && s.email === ctx.config.email && Date.parse(s.expires) - 60_000 > Date.now()) return { token: s.token, fresh: false }
  return { token: await login(ctx), fresh: true }
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'npm',
  name: 'Nginx Proxy Manager',
  version: '1.0.0',
  description: 'Proxy hosts and SSL certificates from the Nginx Proxy Manager API; alerts on certificates about to expire',
  interval: '5m',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'email', 'password'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'Admin UI, e.g. http://proxy.example:81' },
      email: { type: 'string', minLength: 1, description: 'NPM user; an administrator sees every host' },
      password: { type: 'string', description: 'Use ${secret:...}' },
      certExpiryDays: { type: 'integer', minimum: 0, default: 14, description: 'Warn when a certificate expires within this many days; 0 turns it off' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['summary', 'certificates'], default: 'summary' },
      limit: { type: 'integer', minimum: 1, default: 10, description: 'Rows in the certificates view' }
    }
  },

  examples: [
    {
      title: 'Proxy hosts and certificates',
      config: { url: 'http://proxy.example:81', email: 'admin@proxy.example', password: '${secret:NPM_PASSWORD}', certExpiryDays: 14 },
      tiles: [
        { id: 'summary', options: { view: 'summary' } },
        { id: 'certificates', options: { view: 'certificates', limit: 10 } }
      ]
    }
  ],

  async fetch (ctx) {
    const url = base(ctx.config)
    const get = (/** @type {string} */ path, /** @type {string} */ token) => ctx.http.json(`${url}${path}`, { auth: { bearer: token } })
    const both = (/** @type {string} */ token) => Promise.all([get('/api/nginx/proxy-hosts', token), get('/api/nginx/certificates', token)])
    const { token, fresh } = await session(ctx)
    const [hosts, certs] = await both(token).catch(async err => {
      if (err?.status !== 401 || fresh) throw err
      return await both(await login(ctx))
    })
    if (!Array.isArray(hosts) || !Array.isArray(certs)) throw new Error('unexpected answer from the Nginx Proxy Manager API (expected lists of hosts and certificates)')
    return {
      hosts: hosts.map(h => ({
        id: h.id,
        domains: h.domain_names ?? [],
        enabled: h.enabled === undefined || yes(h.enabled),
        ssl: Number(h.certificate_id) > 0
      })),
      certificates: certs.map(c => ({
        id: c.id,
        name: c.nice_name || c.domain_names?.[0] || `#${c.id}`,
        domains: c.domain_names ?? [],
        expiresOn: c.expires_on ?? null,
        expiresAt: iso(c.expires_on)
      }))
    }
  },

  render (data, o, ctx) {
    const url = base(ctx.config)
    if (o.view === 'certificates') {
      const at = (/** @type {any} */ c) => c.expiresAt ? Date.parse(c.expiresAt) : Infinity
      const rows = [...data.certificates].sort((a, b) => at(a) - at(b))
      return {
        type: 'list',
        empty: 'No certificates',
        items: rows.slice(0, o.limit).map(c => {
          const state = expiry(c, ctx.config.certExpiryDays)
          return {
            key: String(c.id),
            title: c.name,
            subtitle: c.domains.join(', '),
            time: c.expiresAt ?? undefined,
            href: `${url}/nginx/certificates`,
            badge: { text: state, tone: TONE[state] }
          }
        })
      }
    }
    const enabled = data.hosts.filter((/** @type {any} */ h) => h.enabled)
    return {
      type: 'stats',
      items: [
        { label: 'Hosts', value: enabled.length, format: 'number', href: `${url}/nginx/proxy` },
        { label: 'SSL', value: enabled.filter((/** @type {any} */ h) => h.ssl).length, format: 'number' },
        { label: 'Disabled', value: data.hosts.length - enabled.length, format: 'number' }
      ]
    }
  },

  alerts (data, ctx) {
    const href = `${base(ctx.config)}/nginx/certificates`
    const out = []
    for (const c of data.certificates) {
      const state = expiry(c, ctx.config.certExpiryDays)
      if (state === 'expired') {
        out.push({ id: `cert:${c.id}:${c.expiresOn}:expired`, severity: 'error', title: `Certificate ${c.name} has expired`, message: c.domains.join(', '), href, time: c.expiresAt })
      } else if (state === 'expiring') {
        const days = Math.ceil((Date.parse(c.expiresAt) - Date.now()) / DAY)
        out.push({ id: `cert:${c.id}:${c.expiresOn}`, severity: 'warning', title: `Certificate ${c.name} expires in ${days} day${days === 1 ? '' : 's'}`, message: c.domains.join(', '), href, time: c.expiresAt })
      }
    }
    return out
  }
}
