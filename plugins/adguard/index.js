/** @param {import('homelabdash/sdk').Context} ctx */
const base = ctx => ctx.config.url.replace(/\/+$/, '')

/**
 * @param {import('homelabdash/sdk').Context} ctx
 * @param {string} path
 * @param {import('homelabdash/sdk').HttpOptions} [o]
 */
async function call (ctx, path, o = {}) {
  const { username, password } = ctx.config
  try {
    return await ctx.http.request(`${base(ctx)}${path}`, { ...o, auth: username ? { basic: { username, password } } : undefined })
  } catch (err) {
    const status = /** @type {any} */ (err).status
    if (status === 401 || status === 403) throw new Error(`AdGuard Home answered ${status} to ${path}: check username and password`, { cause: err })
    throw err
  }
}

/** @param {import('homelabdash/sdk').Context} ctx @param {boolean} enabled */
async function protection (ctx, enabled) {
  if (!ctx.config.allowControl) throw new Error('protection control is off for this source (set allowControl: true)')
  await call(ctx, '/control/protection', { json: { enabled }, parse: 'text' })
  return { enabled }
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'adguard',
  name: 'AdGuard Home',
  version: '1.0.0',
  description: 'AdGuard Home queries, blocked and filtered counts, latency and top blocked domains; alert when protection is off; optional enable / disable',
  interval: '30s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    dependentRequired: { username: ['password'], password: ['username'] },
    properties: {
      url: { type: 'string', format: 'uri', description: 'AdGuard Home web UI, e.g. http://adguard.example' },
      username: { type: 'string', description: 'AdGuard Home user (basic auth)' },
      password: { type: 'string', description: 'Use ${secret:...}' },
      allowControl: { type: 'boolean', default: false, description: 'Enable the enable / disable protection actions' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['summary', 'blocked'], default: 'summary' },
      period: {
        enum: ['all', 'today'],
        default: 'all',
        description: 'Summary counts over the whole statistics retention (all), or today (the last day bucket; the last 24 hours when AdGuard keeps hourly stats)'
      },
      limit: { type: 'integer', minimum: 1, default: 5, description: 'Rows in the blocked view' }
    }
  },

  examples: [
    {
      title: 'Summary and top blocked domains',
      config: { url: 'http://adguard.example', username: 'admin', password: '${secret:ADGUARD_PASSWORD}' },
      tiles: [
        { id: 'summary', options: { view: 'summary' } },
        { id: 'today', options: { view: 'summary', period: 'today' } },
        { id: 'blocked', options: { view: 'blocked', limit: 5 } }
      ]
    },
    {
      title: 'With enable / disable protection buttons',
      config: { url: 'http://adguard.example', username: 'admin', password: '${secret:ADGUARD_PASSWORD}', allowControl: true },
      options: { view: 'summary' }
    }
  ],

  async fetch (ctx) {
    const [{ body: stats }, { body: status }] = await Promise.all([call(ctx, '/control/stats'), call(ctx, '/control/status')])
    const limit = Math.max(1, ...ctx.tiles.filter(t => t.options.view === 'blocked').map(t => t.options.limit))
    // Daily buckets end with today; hourly ones already cover only the last 24 hours.
    const last = (/** @type {number[] | undefined} */ a) => stats.time_units === 'days' ? (a ?? []).at(-1) ?? 0 : (a ?? []).reduce((x, y) => x + y, 0)
    return {
      queries: stats.num_dns_queries ?? null,
      blocked: stats.num_blocked_filtering ?? null,
      filtered: (stats.num_replaced_safebrowsing ?? 0) + (stats.num_replaced_parental ?? 0) + (stats.num_replaced_safesearch ?? 0),
      today: {
        queries: last(stats.dns_queries),
        blocked: last(stats.blocked_filtering),
        filtered: last(stats.replaced_safebrowsing) + last(stats.replaced_parental)
      },
      latencyMs: stats.avg_processing_time == null ? null : stats.avg_processing_time * 1000,
      // Each entry is a one-key object: { "domain": count }.
      topBlocked: (stats.top_blocked_domains ?? []).slice(0, limit).map((/** @type {Record<string, number>} */ e) => {
        const [domain, count] = Object.entries(e)[0] ?? ['', 0]
        return { domain, count }
      }),
      protection: status.protection_enabled !== false,
      resumesInMs: status.protection_disabled_duration || null
    }
  },

  render (data, o, ctx) {
    const actions = ctx.config.allowControl
      ? [data.protection ? { action: 'disable', title: 'Disable protection' } : { action: 'enable', title: 'Enable protection' }]
      : undefined
    if (o.view === 'blocked') {
      return {
        type: 'list',
        actions,
        empty: 'Nothing blocked yet',
        items: data.topBlocked.slice(0, o.limit).map((/** @type {any} */ d) => ({ key: d.domain, title: d.domain, value: d.count, format: 'number' }))
      }
    }
    return {
      type: 'stats',
      actions,
      items: [
        ...o.period === 'today'
          ? [
              { label: 'Queries today', value: data.today.queries, format: 'number' },
              { label: 'Blocked today', value: data.today.blocked, format: 'number' },
              { label: 'Filtered today', value: data.today.filtered, format: 'number' }
            ]
          : [
              { label: 'Queries', value: data.queries, format: 'number' },
              { label: 'Blocked', value: data.blocked, format: 'number' },
              { label: 'Filtered', value: data.filtered, format: 'number' }
            ],
        { label: 'Latency', value: data.latencyMs, format: 'number', unit: 'ms' }
      ]
    }
  },

  alerts (data, ctx) {
    if (data.protection) return []
    return [{
      id: 'protection-off',
      severity: 'error',
      title: 'AdGuard Home protection is off',
      message: data.resumesInMs ? `Protection comes back in ${Math.ceil(data.resumesInMs / 60000)} min` : 'DNS filtering is disabled until someone turns it back on',
      href: base(ctx),
      actions: ctx.config.allowControl ? [{ name: 'enable', title: 'Enable protection' }] : []
    }]
  },

  actions: {
    enable: { title: 'Enable protection', description: 'Turn DNS filtering on (needs allowControl)', run: ctx => protection(ctx, true) },
    disable: { title: 'Disable protection', description: 'Turn DNS filtering off until enabled again (needs allowControl)', run: ctx => protection(ctx, false) }
  }
}
