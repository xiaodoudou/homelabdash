/** @param {import('homelabdash/sdk').Context} ctx */
const base = ctx => ctx.config.url.replace(/\/+$/, '')

/** @param {import('homelabdash/sdk').Context} ctx @param {string} path @param {Record<string, string | number>} [query] */
const api = (ctx, path, query) => ctx.http.json(`${base(ctx)}/api/v1${path}`, { query, auth: { header: 'X-Api-Key', value: ctx.config.apiKey } })

/** @param {any} u */
const who = u => u?.displayName || u?.username || u?.plexUsername || u?.jellyfinUsername || 'someone'

/**
 * Request objects carry only a TMDB id, so titles come from the movie / tv endpoints, once per id.
 * @param {import('homelabdash/sdk').Context} ctx
 * @param {any[]} requests
 * @returns {Promise<Record<string, string>>}
 */
async function titles (ctx, requests) {
  const cache = ctx.state.get('titles', /** @type {Record<string, string>} */ ({}))
  /** @type {Record<string, string>} */
  const out = {}
  await Promise.all(requests.map(async r => {
    const type = r.type === 'tv' ? 'tv' : 'movie'
    const id = r.media?.tmdbId
    const key = `${type}:${id}`
    if (!id || key in out) return
    if (cache[key]) { out[key] = cache[key]; return }
    try {
      const m = await api(ctx, `/${type}/${id}`)
      const name = m.title ?? m.name ?? `TMDB ${id}`
      const year = String(m.releaseDate ?? m.firstAirDate ?? '').slice(0, 4)
      out[key] = year ? `${name} (${year})` : name
    } catch (err) {
      ctx.log.warn(`title of ${key}: ${/** @type {Error} */ (err).message}`)
    }
  }))
  const keys = Object.keys(out)
  if (keys.length !== Object.keys(cache).length || keys.some(k => cache[k] !== out[k])) ctx.state.set('titles', out)
  return out
}

/** @param {import('homelabdash/sdk').Context} ctx @param {unknown} id @param {'approve' | 'decline'} op */
async function decide (ctx, id, op) {
  if (!ctx.config.allowApprove) throw new Error('approving requests is off for this source (set allowApprove: true)')
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) throw new Error('input.id must be a request id')
  await ctx.http.request(`${base(ctx)}/api/v1/request/${n}/${op}`, { method: 'POST', auth: { header: 'X-Api-Key', value: ctx.config.apiKey } })
  return { ok: true }
}

/** @param {boolean} allowed @param {number} id */
const buttons = (allowed, id) => allowed
  ? [{ action: 'approve', title: 'Approve', input: { id } }, { action: 'decline', title: 'Decline', input: { id } }]
  : undefined

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'seerr',
  name: 'Seerr',
  version: '1.0.0',
  description: 'Request and issue counts and pending requests from Overseerr, Jellyseerr or Seerr; pending requests and open issues become alerts, approve / decline on opt-in',
  interval: '1m',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'apiKey'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'Overseerr, Jellyseerr or Seerr address, e.g. http://requests.example:5055' },
      apiKey: { type: 'string', description: 'Settings > General > API Key; use ${secret:...}' },
      alerts: {
        type: 'object',
        additionalProperties: false,
        default: {},
        properties: {
          pending: { type: 'boolean', default: true, description: 'One alert per pending request' },
          issues: { type: 'boolean', default: true, description: 'An alert while issues are open' }
        }
      },
      allowApprove: { type: 'boolean', default: false, description: 'Enable the approve / decline actions on pending requests' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['summary', 'pending'], default: 'summary' },
      stats: {
        type: 'array',
        items: { enum: ['pending', 'processing', 'available', 'issues'] },
        uniqueItems: true,
        minItems: 1,
        default: ['pending', 'processing', 'available', 'issues'],
        description: 'Counts the summary shows, in this order'
      }
    }
  },

  examples: [
    {
      title: 'Counts and pending requests',
      config: { url: 'http://requests.example:5055', apiKey: '${secret:SEERR_API_KEY}' },
      tiles: [
        { id: 'summary', options: { view: 'summary' } },
        { id: 'triage', options: { view: 'summary', stats: ['pending', 'issues'] } },
        { id: 'pending', options: { view: 'pending' } }
      ]
    },
    {
      title: 'Pending requests with approve / decline, no issue alert',
      config: { url: 'http://requests.example:5055', apiKey: '${secret:SEERR_API_KEY}', allowApprove: true, alerts: { issues: false } },
      options: { view: 'pending' }
    }
  ],

  async fetch (ctx) {
    const views = new Set(ctx.tiles.map(t => t.options.view ?? 'summary'))
    const needIssues = views.has('summary') || ctx.config.alerts.issues
    const needPending = views.has('pending') || ctx.config.alerts.pending
    const needCounts = views.has('summary') || (!needIssues && !needPending)
    const [counts, issues, page] = await Promise.all([
      needCounts ? api(ctx, '/request/count') : null,
      needIssues ? api(ctx, '/issue/count') : null,
      needPending ? api(ctx, '/request', { take: 10, skip: 0, filter: 'pending', sort: 'added' }) : null
    ])
    const results = page?.results ?? []
    const names = page ? await titles(ctx, results) : {}
    return {
      counts,
      issues,
      pending: page
        ? results.map((/** @type {any} */ r) => {
          const type = r.type === 'tv' ? 'tv' : 'movie'
          const tmdbId = r.media?.tmdbId ?? null
          return { id: r.id, type, tmdbId, title: names[`${type}:${tmdbId}`] ?? `TMDB ${tmdbId}`, by: who(r.requestedBy), at: r.createdAt ?? null, is4k: !!r.is4k }
        })
        : null
    }
  },

  render (data, o, ctx) {
    const url = base(ctx)
    if (o.view === 'pending') {
      return {
        type: 'list',
        empty: 'No pending requests',
        items: (data.pending ?? []).map((/** @type {any} */ r) => ({
          key: String(r.id),
          title: r.title,
          subtitle: r.by,
          time: r.at ?? undefined,
          href: r.tmdbId ? `${url}/${r.type}/${r.tmdbId}` : `${url}/requests`,
          badge: r.is4k ? { text: '4K', tone: 'info' } : undefined,
          actions: buttons(ctx.config.allowApprove, r.id)
        }))
      }
    }
    /** @type {Record<string, import('homelabdash/sdk').StatItem>} */
    const stats = {
      pending: { label: 'Pending', value: data.counts?.pending ?? null, format: 'number', warn: 1, href: `${url}/requests` },
      processing: { label: 'Processing', value: data.counts?.processing ?? null, format: 'number' },
      available: { label: 'Available', value: data.counts?.available ?? null, format: 'number' },
      issues: { label: 'Open issues', value: data.issues?.open ?? null, format: 'number', warn: 1, href: `${url}/issues` }
    }
    return { type: 'stats', items: (o.stats ?? Object.keys(stats)).map((/** @type {string} */ k) => stats[k]) }
  },

  alerts (data, ctx) {
    const url = base(ctx)
    const out = []
    if (ctx.config.alerts.pending) {
      for (const r of data.pending ?? []) {
        out.push({
          id: `request:${r.id}`,
          severity: 'info',
          title: `Request: ${r.title}${r.is4k ? ' (4K)' : ''}`,
          message: `Requested by ${r.by}`,
          href: `${url}/requests`,
          time: r.at ?? undefined,
          actions: ctx.config.allowApprove ? [{ name: 'approve', title: 'Approve', input: { id: r.id } }, { name: 'decline', title: 'Decline', input: { id: r.id } }] : []
        })
      }
    }
    const open = data.issues?.open ?? 0
    if (ctx.config.alerts.issues && open > 0) {
      out.push({ id: `issues:${open}`, severity: 'warning', title: `${open} open issue${open === 1 ? '' : 's'}`, message: `${open} of ${data.issues.total} reported issues are open`, href: `${url}/issues` })
    }
    return out
  },

  actions: {
    approve: {
      title: 'Approve',
      description: 'Approve a pending request (needs allowApprove: true)',
      input: { type: 'object', properties: { id: { type: 'integer' } } },
      run: (ctx, input) => decide(ctx, input?.id, 'approve')
    },
    decline: {
      title: 'Decline',
      description: 'Decline a pending request (needs allowApprove: true)',
      input: { type: 'object', properties: { id: { type: 'integer' } } },
      run: (ctx, input) => decide(ctx, input?.id, 'decline')
    }
  }
}
