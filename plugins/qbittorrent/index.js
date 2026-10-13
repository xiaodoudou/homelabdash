import { createHash } from 'node:crypto'

const LEECHING = new Set(['downloading', 'stalledDL', 'metaDL', 'forcedDL', 'queuedDL', 'checkingDL', 'forcedMetaDL'])
const SEEDING = new Set(['uploading', 'stalledUP', 'forcedUP', 'queuedUP', 'checkingUP'])
const DOWNLOADING = new Set(['downloading', 'forcedDL', 'metaDL', 'forcedMetaDL'])
const ERRORS = new Set(['error', 'missingFiles'])
const PROBLEMS = [
  { state: 'missingFiles', id: 'missing-files', one: 'torrent has missing files', many: 'torrents have missing files', why: 'qBittorrent cannot find the downloaded files' },
  { state: 'error', id: 'error', one: 'torrent stopped after an error', many: 'torrents stopped after an error', why: 'qBittorrent stopped them after an error' }
]
const LABEL = /** @type {Record<string, string>} */ ({
  downloading: 'downloading',
  forcedDL: 'forced',
  metaDL: 'metadata',
  forcedMetaDL: 'metadata',
  stalledDL: 'stalled',
  queuedDL: 'queued',
  checkingDL: 'checking',
  pausedDL: 'paused',
  stoppedDL: 'stopped',
  uploading: 'seeding',
  forcedUP: 'seeding',
  stalledUP: 'seeding',
  queuedUP: 'queued',
  checkingUP: 'checking',
  pausedUP: 'paused',
  stoppedUP: 'stopped',
  missingFiles: 'missing files'
})

const NOT_ALLOWED = 'qBittorrent answered 403: add the dashboard\'s IP to the WebUI auth whitelist (Options > WebUI > Bypass authentication for clients in whitelisted IP subnets) or set username and password'

/** @param {import('homelabdash/sdk').Context} ctx */
const base = ctx => ctx.config.url.replace(/\/+$/, '')

/** @param {string} state */
function tone (state) {
  if (ERRORS.has(state)) return 'error'
  if (DOWNLOADING.has(state)) return 'info'
  if (state === 'uploading' || state === 'forcedUP') return 'ok'
  return 'neutral'
}

/** @param {import('homelabdash/sdk').Context} ctx */
async function login (ctx) {
  const res = await ctx.http.request(`${base(ctx)}/api/v2/auth/login`, {
    form: { username: ctx.config.username, password: ctx.config.password },
    throwOnError: false,
    parse: 'text'
  })
  if (res.status === 403) throw new Error('qBittorrent refused the login (403): this IP is banned after too many failed attempts')
  // The session cookie is SID, or QBT_SID_<port> on qBittorrent 5.1+.
  const m = /(?:^|[\s,;])((?:QBT_)?SID(?:_\d+)?)=([^;,\s]+)/.exec(res.headers['set-cookie'] ?? '')
  if (!m) throw new Error(`qBittorrent login failed (${res.status} ${String(res.body).trim().slice(0, 40)}): check username and password`)
  const cookie = `${m[1]}=${m[2]}`
  ctx.state.set('cookie', cookie)
  return cookie
}

/** @param {import('homelabdash/sdk').Context} ctx @param {string} path */
async function api (ctx, path) {
  const creds = !!ctx.config.username
  /** @type {string | null} */
  let cookie = creds ? ctx.state.get('cookie', null) : null
  if (creds && !cookie) cookie = await login(ctx)
  const get = (/** @type {string | null} */ c) => ctx.http.request(`${base(ctx)}${path}`, { headers: c ? { cookie: c } : {}, throwOnError: false })
  let res = await get(cookie)
  if (res.status === 403 && creds) res = await get(await login(ctx))
  if (res.status === 403) throw new Error(creds ? `qBittorrent still answers 403 to ${path} after logging in` : NOT_ALLOWED)
  if (!res.ok) throw new Error(`GET ${path} returned ${res.status}`)
  if (typeof res.body !== 'object' || res.body === null) throw new Error(`GET ${path} did not return JSON`)
  return res.body
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'qbittorrent',
  name: 'qBittorrent',
  version: '1.0.0',
  description: 'qBittorrent leeching and seeding counts, transfer speeds and active torrents (WebUI API v2); alerts for torrents in error',
  interval: '10s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    dependentRequired: { username: ['password'], password: ['username'] },
    properties: {
      url: { type: 'string', format: 'uri', description: 'qBittorrent WebUI, e.g. http://qbittorrent.example:8080' },
      username: { type: 'string', description: 'WebUI user; leave out when the dashboard\'s IP is in the WebUI auth whitelist' },
      password: { type: 'string', description: 'WebUI password; use ${secret:...}' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['summary', 'active'], default: 'summary' },
      limit: { type: 'integer', minimum: 1, default: 10, description: 'Rows in the active view' }
    }
  },

  examples: [
    {
      title: 'Whitelisted dashboard, summary and active torrents',
      config: { url: 'http://qbittorrent.example:8080' },
      tiles: [
        { id: 'summary', options: { view: 'summary' } },
        { id: 'active', options: { view: 'active', limit: 5 } }
      ]
    },
    {
      title: 'With a WebUI login',
      config: { url: 'http://qbittorrent.example:8080', username: 'admin', password: '${secret:QBT_PASSWORD}' },
      options: { view: 'summary' }
    }
  ],

  async fetch (ctx) {
    const transfer = await api(ctx, '/api/v2/transfer/info')
    const torrents = /** @type {any[]} */ (await api(ctx, '/api/v2/torrents/info'))
    const limit = Math.max(1, ...ctx.tiles.filter(t => t.options.view === 'active').map(t => t.options.limit))
    return {
      download: transfer.dl_info_speed ?? null,
      upload: transfer.up_info_speed ?? null,
      leech: torrents.filter(t => LEECHING.has(t.state)).length,
      seed: torrents.filter(t => SEEDING.has(t.state)).length,
      active: torrents
        .filter(t => DOWNLOADING.has(t.state) || t.dlspeed > 0 || t.upspeed > 0)
        .sort((a, b) => b.dlspeed - a.dlspeed || b.upspeed - a.upspeed)
        .slice(0, limit)
        .map(t => ({ hash: t.hash, name: t.name, state: t.state, progress: t.progress, dlspeed: t.dlspeed })),
      errors: torrents.filter(t => ERRORS.has(t.state)).map(t => ({ hash: t.hash, name: t.name, state: t.state }))
    }
  },

  render (data, o) {
    if (o.view === 'active') {
      return {
        type: 'list',
        empty: 'Nothing active',
        items: data.active.slice(0, o.limit).map((/** @type {any} */ t) => ({
          key: t.hash,
          title: t.name,
          badge: { text: LABEL[t.state] ?? t.state, tone: tone(t.state) },
          progress: { value: Math.round(t.progress * 1000) / 10, max: 100 },
          value: t.dlspeed,
          format: 'byterate'
        }))
      }
    }
    return {
      type: 'stats',
      items: [
        { label: 'Leech', value: data.leech, format: 'number' },
        { label: 'Download', value: data.download, format: 'byterate' },
        { label: 'Seed', value: data.seed, format: 'number' },
        { label: 'Upload', value: data.upload, format: 'byterate' }
      ]
    }
  },

  alerts (data, ctx) {
    // One alert per kind of problem; the id covers its torrents, so a dismissed alert returns when another one joins.
    return PROBLEMS.flatMap(p => {
      const hit = data.errors.filter((/** @type {any} */ t) => t.state === p.state)
      if (!hit.length) return []
      const names = hit.slice(0, 3).map((/** @type {any} */ t) => t.name).join(', ') + (hit.length > 3 ? ` and ${hit.length - 3} more` : '')
      return [{
        id: `${p.id}:${createHash('sha1').update(hit.map((/** @type {any} */ t) => t.hash).sort().join(',')).digest('hex').slice(0, 12)}`,
        severity: /** @type {const} */ ('error'),
        title: `${hit.length} ${hit.length === 1 ? p.one : p.many}`,
        message: `${p.why}: ${names}`,
        href: base(ctx)
      }]
    })
  }
}
