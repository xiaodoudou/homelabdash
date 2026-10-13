const NEEDS = /** @type {Record<string, string[]>} */ ({
  missing: ['missing'],
  queue: ['queue'],
  summary: ['missing', 'queue', 'health'],
  health: ['health']
})
const SEVERITY = /** @type {Record<string, 'info'|'warning'|'error'>} */ ({ error: 'error', warning: 'warning', notice: 'info' })
const TONE = /** @type {Record<string, string>} */ ({ error: 'error', warning: 'warning', notice: 'info', ok: 'ok' })

/** @param {import('homelabdash/sdk').Context} ctx */
const base = ctx => ctx.config.url.replace(/\/+$/, '')

/** @param {import('homelabdash/sdk').Context} ctx @param {string} path @param {Record<string, number>} [query] */
const api = (ctx, path, query) => ctx.http.json(`${base(ctx)}/api/${ctx.config.apiVersion}${path}`, { query, auth: { header: 'X-Api-Key', value: ctx.config.apiKey } })

/** @param {any[] | null} health */
const problems = health => (health ?? []).filter(h => h.type !== 'ok')

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'arr',
  name: 'Radarr / Sonarr',
  version: '1.0.0',
  description: 'Missing items, download queue and health checks from Radarr, Sonarr, Lidarr or Readarr; each health check becomes an alert',
  interval: '1m',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'apiKey'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'App address, e.g. http://radarr.example:7878' },
      apiKey: { type: 'string', description: 'Settings > General > API Key; use ${secret:...}' },
      apiVersion: { type: 'string', pattern: '^v[0-9]+$', default: 'v3', description: 'v3 for Radarr and Sonarr, v1 for Lidarr, Readarr and Prowlarr' },
      healthAlerts: { type: 'boolean', default: true, description: 'One alert per health check the app reports' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: Object.keys(NEEDS), default: 'missing' }
    }
  },

  examples: [
    {
      title: 'Every view of one Radarr',
      config: { url: 'http://radarr.example:7878', apiKey: '${secret:RADARR_API_KEY}' },
      tiles: [
        { id: 'missing', options: { view: 'missing' } },
        { id: 'queue', options: { view: 'queue' } },
        { id: 'summary', options: { view: 'summary' } },
        { id: 'health', options: { view: 'health' } }
      ]
    },
    {
      title: 'Lidarr (API v1)',
      config: { url: 'http://lidarr.example:8686', apiKey: '${secret:LIDARR_API_KEY}', apiVersion: 'v1' },
      options: { view: 'summary' }
    }
  ],

  async fetch (ctx) {
    const wanted = new Set(ctx.tiles.flatMap(t => NEEDS[t.options.view ?? 'missing'] ?? []))
    if (ctx.config.healthAlerts) wanted.add('health')
    if (!wanted.size) NEEDS.missing.forEach(e => wanted.add(e))
    const [missing, queue, health] = await Promise.all([
      wanted.has('missing') ? api(ctx, '/wanted/missing', { pageSize: 1 }) : null,
      wanted.has('queue') ? api(ctx, '/queue/status') : null,
      wanted.has('health') ? api(ctx, '/health') : null
    ])
    // The app name only titles alerts, so it is fetched only while there is something to alert on.
    const status = ctx.config.healthAlerts && problems(health).length ? await api(ctx, '/system/status') : null
    return {
      appName: status?.appName ?? null,
      missing: missing ? missing.totalRecords ?? null : null,
      queue: queue ? { total: queue.totalCount ?? null, errors: !!queue.errors, warnings: !!queue.warnings } : null,
      health: health
        ? health.map((/** @type {any} */ h) => ({ source: h.source ?? null, type: h.type ?? 'warning', message: h.message ?? '', wikiUrl: h.wikiUrl || null }))
        : null
    }
  },

  render (data, o, ctx) {
    const url = base(ctx)
    const missing = { label: 'Missing', value: data.missing, format: 'number', href: `${url}/wanted/missing` }
    const queue = { label: 'Queue', value: data.queue?.total ?? null, format: 'number', href: `${url}/activity/queue` }
    switch (o.view) {
      case 'queue': {
        const yesNo = (/** @type {boolean | undefined} */ b) => b === undefined ? null : b ? 'yes' : 'no'
        return {
          type: 'stats',
          items: [
            queue,
            { label: 'Errors', value: yesNo(data.queue?.errors), format: 'text', tone: data.queue?.errors ? 'error' : undefined },
            { label: 'Warnings', value: yesNo(data.queue?.warnings), format: 'text', tone: data.queue?.warnings ? 'warning' : undefined }
          ]
        }
      }
      case 'summary':
        return {
          type: 'stats',
          items: [
            missing,
            queue,
            { label: 'Health issues', value: data.health ? problems(data.health).length : null, format: 'number', warn: 1, href: `${url}/system/status` }
          ]
        }
      case 'health':
        return {
          type: 'list',
          empty: 'Healthy',
          items: problems(data.health).map((/** @type {any} */ h) => ({
            key: `${h.source}:${h.message}`,
            title: h.message,
            href: h.wikiUrl ?? undefined,
            badge: { text: h.type, tone: TONE[h.type] ?? 'warning' }
          }))
        }
      default:
        return { type: 'stats', items: [missing] }
    }
  },

  alerts (data, ctx) {
    if (!ctx.config.healthAlerts) return []
    const app = data.appName ?? 'Arr'
    return problems(data.health).map((/** @type {any} */ h) => ({
      id: `${h.source}:${h.message}`,
      severity: SEVERITY[h.type] ?? 'warning',
      title: `${app}: ${h.message}`,
      href: h.wikiUrl ?? undefined
    }))
  }
}
