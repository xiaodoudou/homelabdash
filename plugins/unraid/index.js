const QUERY = `query Dashboard($limit: Int!) {
  metrics { cpu { percentTotal } memory { total available percentTotal } }
  array { state capacity { kilobytes { free used total } } caches { name fsSize fsUsed fsFree } }
  notifications {
    overview { unread { info warning alert total } }
    list(filter: { type: UNREAD, offset: 0, limit: $limit }) { id title subject description importance link timestamp }
  }
  info { os { uptime } }
}`

const ARCHIVE = 'mutation Archive($id: PrefixedID!) { archiveNotification(id: $id) { id } }'
const ARCHIVE_MANY = 'mutation ArchiveMany($ids: [PrefixedID!]!) { archiveNotifications(ids: $ids) { unread { total } } }'
const SEVERITY = /** @type {Record<string, 'info'|'warning'|'error'>} */ ({ INFO: 'info', WARNING: 'warning', ALERT: 'error' })
const RANK = /** @type {Record<string, number>} */ ({ INFO: 0, WARNING: 1, ALERT: 2 })

/**
 * @param {import('homelabdash/sdk').Context} ctx
 * @param {string} query
 * @param {Record<string, unknown>} variables
 * @param {string} operationName
 */
async function gql (ctx, query, variables, operationName) {
  const res = await ctx.http.json(`${ctx.config.url.replace(/\/+$/, '')}/graphql`, {
    json: { operationName, query, variables },
    auth: { header: 'x-api-key', value: ctx.config.apiKey },
    insecure: ctx.config.insecure
  })
  if (res?.errors?.length) throw new Error(`Unraid API: ${res.errors.map((/** @type {any} */ e) => e.message).join('; ')}`)
  return res.data
}

// The API's "kilobytes" are 1000 bytes: total * 1000 matches `df -B1` on the array and pools.
/** @param {unknown} v */
const kb = v => v === null || v === undefined ? null : Number(v) * 1000

/**
 * One entry per title: Unraid repeats the same warning (e.g. docker image usage) every few hours.
 * @param {any[]} list newest first
 */
function groupByTitle (list) {
  /** @type {Map<string, { latest: any, ids: string[] }>} */
  const groups = new Map()
  for (const n of list) {
    const g = groups.get(n.title)
    if (g) g.ids.push(n.id)
    else groups.set(n.title, { latest: n, ids: [n.id] })
  }
  return [...groups.values()]
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'unraid',
  name: 'Unraid',
  version: '1.0.0',
  description: 'CPU, memory, array, pools, uptime and notifications from the Unraid API (GraphQL); notifications become alerts that can be archived',
  interval: '15s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'apiKey'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'Unraid web UI, e.g. http://tower.example' },
      apiKey: { type: 'string', description: 'API key (Settings > Management Access > API Keys); use ${secret:...}' },
      insecure: { type: 'boolean', description: 'Accept a self-signed certificate' },
      notifications: {
        type: 'object',
        additionalProperties: false,
        default: {},
        properties: {
          limit: { type: 'integer', minimum: 0, maximum: 100, default: 20 },
          minImportance: { enum: ['INFO', 'WARNING', 'ALERT'], default: 'WARNING', description: 'Lowest importance raised as an alert' },
          group: { type: 'boolean', default: true, description: 'One alert per notification title; Archive then archives the whole group' },
          archive: { type: 'boolean', default: true, description: 'Offer Archive buttons; needs an API key allowed to update notifications' }
        }
      }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      metric: { enum: ['cpu', 'memory', 'array', 'pool', 'status', 'uptime', 'notifications'], default: 'status' },
      pool: { type: 'string', default: 'cache', description: 'Pool name (metric: pool)' }
    }
  },

  examples: [
    {
      title: 'Every tile of one server',
      config: { url: 'http://tower.example', apiKey: '${secret:UNRAID_API_KEY}', notifications: { minImportance: 'WARNING' } },
      tiles: [
        { id: 'status', options: { metric: 'status' } },
        { id: 'cpu', options: { metric: 'cpu' } },
        { id: 'memory', options: { metric: 'memory' } },
        { id: 'array', options: { metric: 'array' } },
        { id: 'cache', options: { metric: 'pool', pool: 'cache' } },
        { id: 'uptime', options: { metric: 'uptime' } },
        { id: 'notifications', options: { metric: 'notifications' } }
      ]
    }
  ],

  async fetch (ctx) {
    const d = await gql(ctx, QUERY, { limit: ctx.config.notifications.limit }, 'Dashboard')
    const cap = d.array?.capacity?.kilobytes ?? {}
    const mem = d.metrics?.memory ?? {}
    return {
      cpu: d.metrics?.cpu?.percentTotal ?? null,
      memory: { total: mem.total ?? null, available: mem.available ?? null, used: mem.total != null && mem.available != null ? mem.total - mem.available : null, percent: mem.percentTotal ?? null },
      array: { state: d.array?.state ?? null, total: kb(cap.total), used: kb(cap.used), free: kb(cap.free) },
      pools: (d.array?.caches ?? []).map((/** @type {any} */ p) => ({ name: p.name, size: kb(p.fsSize), used: kb(p.fsUsed), free: kb(p.fsFree) })),
      bootedAt: d.info?.os?.uptime ?? null,
      unread: d.notifications?.overview?.unread ?? { info: 0, warning: 0, alert: 0, total: 0 },
      notifications: d.notifications?.list ?? []
    }
  },

  render (data, o, ctx) {
    const base = ctx.config.url.replace(/\/+$/, '')
    const pct = (/** @type {number | null} */ used, /** @type {number | null} */ total) => used != null && total ? (used / total) * 100 : null
    switch (o.metric) {
      case 'cpu':
        return { type: 'stats', items: [{ label: 'CPU', value: data.cpu, format: 'percent', warn: 80, crit: 95 }] }
      case 'memory':
        return {
          type: 'stats',
          items: [
            { label: 'Used', value: data.memory.percent, format: 'percent', warn: 85, crit: 95 },
            { label: 'Used', value: data.memory.used, format: 'bytes' },
            { label: 'Free', value: data.memory.available, format: 'bytes' }
          ]
        }
      case 'array':
        return {
          type: 'stats',
          items: [
            { label: 'Used', value: pct(data.array.used, data.array.total), format: 'percent', warn: 85, crit: 95 },
            { label: 'Used', value: data.array.used, format: 'bytes' },
            { label: 'Free', value: data.array.free, format: 'bytes' }
          ]
        }
      case 'pool': {
        const p = data.pools.find((/** @type {any} */ x) => x.name === o.pool)
        if (!p) return { type: 'text', text: `No pool "${o.pool}" (pools: ${data.pools.map((/** @type {any} */ x) => x.name).join(', ') || 'none'})`, tone: 'warning' }
        return {
          type: 'stats',
          items: [
            { label: 'Used', value: pct(p.used, p.size), format: 'percent', warn: 85, crit: 95 },
            { label: 'Used', value: p.used, format: 'bytes' },
            { label: 'Free', value: p.free, format: 'bytes' }
          ]
        }
      }
      case 'uptime':
        return { type: 'stats', items: [{ label: 'Uptime', value: data.bootedAt, format: 'since' }] }
      case 'notifications': {
        return {
          type: 'list',
          empty: 'No unread notifications',
          items: data.notifications.map((/** @type {any} */ n) => ({
            key: n.id,
            title: n.title,
            subtitle: n.description || n.subject,
            time: n.timestamp,
            href: n.link ? base + n.link : undefined,
            badge: { text: n.importance.toLowerCase(), tone: SEVERITY[n.importance] },
            actions: ctx.config.notifications.archive ? [{ action: 'archive', title: 'Archive', input: { id: n.id } }] : undefined
          }))
        }
      }
      default:
        return {
          type: 'stats',
          items: [
            { label: 'Array', value: data.array.state ? data.array.state.toLowerCase() : null, format: 'text', href: `${base}/Main` },
            // Unraid has no page for unread notifications: they open from the bell in the header of its dashboard
            { label: 'Unread', value: data.unread.total, format: 'number', warn: 1, crit: data.unread.alert ? data.unread.total : undefined, href: `${base}/Dashboard` }
          ]
        }
    }
  },

  alerts (data, ctx) {
    const min = RANK[ctx.config.notifications.minImportance]
    const base = ctx.config.url.replace(/\/+$/, '')
    const kept = data.notifications.filter((/** @type {any} */ n) => (RANK[n.importance] ?? 0) >= min)
    const groups = ctx.config.notifications.group ? groupByTitle(kept) : kept.map((/** @type {any} */ n) => ({ latest: n, ids: [n.id] }))
    return groups.map((/** @type {{ latest: any, ids: string[] }} */ { latest: n, ids }) => ({
      id: n.id,
      severity: SEVERITY[n.importance] ?? 'warning',
      title: ids.length > 1 ? `${n.title} (${ids.length} times)` : n.title,
      message: n.description || n.subject,
      href: n.link ? base + n.link : undefined,
      time: n.timestamp,
      actions: ctx.config.notifications.archive ? [{ name: 'archive', title: ids.length > 1 ? 'Archive all' : 'Archive', input: ids.length > 1 ? { ids } : { id: n.id } }] : []
    }))
  },

  actions: {
    archive: {
      title: 'Archive',
      description: 'Archive one notification (id) or several (ids) in Unraid',
      input: { type: 'object', properties: { id: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } } },
      async run (ctx, input) {
        try {
          return await archive(ctx, input)
        } catch (err) {
          if (/forbidden/i.test(/** @type {Error} */ (err).message)) {
            throw new Error('this API key may not archive notifications: give it notification update rights (Settings > Management Access > API Keys) or set notifications.archive: false')
          }
          throw err
        }
      }
    }
  }
}

/** @param {import('homelabdash/sdk').Context} ctx @param {any} input */
async function archive (ctx, input) {
  if (Array.isArray(input?.ids) && input.ids.length && input.ids.every((/** @type {unknown} */ x) => typeof x === 'string')) {
    await gql(ctx, ARCHIVE_MANY, { ids: input.ids }, 'ArchiveMany')
    return { archived: input.ids.length }
  }
  if (typeof input?.id !== 'string') throw new Error('input.id or input.ids is required')
  await gql(ctx, ARCHIVE, { id: input.id }, 'Archive')
  return { archived: 1 }
}
