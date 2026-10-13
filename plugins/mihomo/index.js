// A traffic sample older than this is from a stream that stopped; polls drop it instead of showing a stale rate.
const FRESH_MS = 10_000

/** @param {unknown} v */
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null

/** @param {import('homelabdash/sdk').Context} ctx */
function api (ctx) {
  return {
    base: ctx.config.url.replace(/\/+$/, ''),
    opts: ctx.config.secret ? { auth: { bearer: ctx.config.secret } } : {}
  }
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'mihomo',
  name: 'mihomo',
  version: '1.0.0',
  description: 'Current node of a proxy group, open connections, live download and upload rates and totals from the mihomo (Clash Meta) REST API',
  interval: '15s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'external-controller address, e.g. http://router.example:9090' },
      secret: { type: 'string', description: 'external-controller secret, sent as a bearer token; use ${secret:...}' },
      group: { type: 'string', default: 'Proxy', description: 'Proxy group (selector) whose current node the summary shows' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['summary', 'traffic'], default: 'summary' }
    }
  },

  examples: [
    {
      title: 'Node, connections and live traffic',
      config: { url: 'http://router.example:9090', secret: '${secret:MIHOMO_SECRET}', group: 'Proxy' },
      tiles: [
        { id: 'summary', options: { view: 'summary' } },
        { id: 'traffic', options: { view: 'traffic' } }
      ]
    }
  ],

  async fetch (ctx) {
    const { base, opts } = api(ctx)
    const group = ctx.config.group
    const [proxy, conns] = await Promise.all([
      ctx.http.json(`${base}/proxies/${encodeURIComponent(group)}`, opts).catch(err => {
        throw err?.status === 404 ? new Error(`mihomo has no proxy group "${group}"`) : err
      }),
      ctx.http.json(`${base}/connections`, opts)
    ])
    const traffic = ctx.data?.traffic
    return {
      group,
      node: typeof proxy?.now === 'string' ? proxy.now : null,
      connections: Array.isArray(conns?.connections) ? conns.connections.length : 0,
      downloadTotal: num(conns?.downloadTotal),
      uploadTotal: num(conns?.uploadTotal),
      traffic: traffic && Date.now() - traffic.at < FRESH_MS ? traffic : null
    }
  },

  async stream (ctx, emit) {
    const { base, opts } = api(ctx)
    for await (const line of ctx.http.stream(`${base}/traffic`, opts)) {
      const up = num(line?.up)
      const down = num(line?.down)
      if (up === null || down === null) continue
      /** @type {Record<string, number>} */
      const totals = {}
      // Recent mihomo builds add running totals to each line; older ones only send the rates.
      if (num(line.downTotal) !== null) totals.downloadTotal = line.downTotal
      if (num(line.upTotal) !== null) totals.uploadTotal = line.upTotal
      const traffic = { up, down, at: Date.now() }
      emit((/** @type {any} */ prev) => ({ ...prev, ...totals, traffic }))
    }
  },

  render (data, o) {
    const t = data?.traffic
    if (o.view === 'traffic') {
      return {
        type: 'stats',
        items: [
          { label: 'Down', value: t?.down ?? null, format: 'byterate' },
          { label: 'Up', value: t?.up ?? null, format: 'byterate' },
          { label: 'Total down', value: data?.downloadTotal ?? null, format: 'bytes' },
          { label: 'Total up', value: data?.uploadTotal ?? null, format: 'bytes' }
        ]
      }
    }
    return {
      type: 'stats',
      items: [
        { label: 'Node', value: data?.node ?? null, format: 'text' },
        { label: 'Conns', value: data?.connections ?? null, format: 'number' },
        { label: 'Down', value: t?.down ?? null, format: 'byterate' },
        { label: 'Up', value: t?.up ?? null, format: 'byterate' }
      ]
    }
  }
}
