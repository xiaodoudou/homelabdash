const EVENTS = new Set(['create', 'start', 'restart', 'stop', 'die', 'kill', 'pause', 'unpause', 'destroy', 'rename', 'health_status', 'oom'])

/** @param {any} config */
function conn (config) {
  return config.url
    ? { base: config.url.replace(/\/+$/, ''), opts: {} }
    : { base: 'http://docker', opts: { socketPath: config.socket } }
}

/** @param {any} c */
function health (c) {
  // Docker reports a stopped container's health as unhealthy.
  if (c.State !== 'running') return null
  const h = c.Health?.Status
  if (h && h !== 'none') return h
  const m = /\((healthy|unhealthy|health: starting)\)/.exec(c.Status ?? '')
  return m ? (m[1] === 'health: starting' ? 'starting' : m[1]) : null
}

/** @param {import('homelabdash/sdk').Context} ctx */
async function list (ctx) {
  const { base, opts } = conn(ctx.config)
  const raw = await ctx.http.json(`${base}/containers/json`, { ...opts, query: { all: 1 } })
  const ignore = new Set(ctx.config.ignore ?? [])
  const label = ctx.config.expectedLabel
  const containers = raw
    .map((/** @type {any} */ c) => ({
      name: String(c.Names?.[0] ?? c.Id).replace(/^\//, ''),
      image: c.Image,
      state: c.State,
      status: c.Status,
      health: health(c),
      created: c.Created,
      expected: (ctx.config.expected ?? []).includes(String(c.Names?.[0] ?? '').replace(/^\//, '')) || (!!label && /^(1|true|yes)$/i.test(c.Labels?.[label] ?? ''))
    }))
    .filter((/** @type {any} */ c) => !ignore.has(c.name))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => a.name.localeCompare(b.name))
  return { containers, df: ctx.state.get('df', null) }
}

/** @param {any} c */
function tone (c) {
  if (c.health === 'unhealthy') return 'error'
  if (c.state === 'running') return c.health === 'starting' ? 'warning' : 'ok'
  if (c.state === 'paused' || c.state === 'restarting') return 'warning'
  return c.expected ? 'error' : 'neutral'
}

/** @param {import('homelabdash/sdk').Context} ctx @param {string} name @param {string} op */
async function control (ctx, name, op) {
  if (!ctx.config.allowControl) throw new Error('container control is off for this source (set allowControl: true)')
  if (!/^[\w.-]+$/.test(String(name))) throw new Error('invalid container name')
  const { base, opts } = conn(ctx.config)
  await ctx.http.request(`${base}/containers/${encodeURIComponent(name)}/${op}`, { ...opts, method: 'POST' })
  return { ok: true }
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'docker',
  name: 'Docker',
  version: '1.0.0',
  description: 'Container states (live through Docker events), status dots for tiles, disk usage, optional start/stop/restart',
  interval: '1m',

  config: {
    type: 'object',
    additionalProperties: false,
    properties: {
      socket: { type: 'string', default: '/var/run/docker.sock', description: 'Docker socket mounted into the container. Mounting it :ro does not limit the API; use url with a socket proxy for least privilege' },
      url: { type: 'string', format: 'uri', description: 'Instead of the socket: a Docker API or socket proxy, e.g. http://docker-proxy:2375' },
      expected: { type: 'array', items: { type: 'string' }, description: 'Containers that must be running; an alert fires when one is not' },
      expectedLabel: { type: 'string', default: 'homelabdash.expected', description: 'Containers with this label set to true are expected too' },
      ignore: { type: 'array', items: { type: 'string' }, description: 'Containers to leave out entirely' },
      allowControl: { type: 'boolean', default: false, description: 'Enable start/stop/restart actions on list rows' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['summary', 'list', 'disk'], default: 'summary' },
      show: { enum: ['all', 'running', 'stopped', 'problems'], default: 'all', description: 'Rows to show in the list view' },
      containers: { type: 'array', items: { type: 'string' }, description: 'Only these containers (list view)' },
      limit: { type: 'integer', minimum: 1, default: 50 }
    }
  },

  examples: [
    {
      title: 'Local Docker host',
      config: { socket: '/var/run/docker.sock', expected: ['backup'] },
      tiles: [
        { id: 'summary', options: { view: 'summary' } },
        { id: 'problems', options: { view: 'list', show: 'problems' } },
        { id: 'running', options: { view: 'list', show: 'running' } },
        { id: 'stopped', options: { view: 'list', show: 'stopped' } },
        { id: 'some', options: { view: 'list', show: 'all', containers: ['dns', 'media-server'] } },
        { id: 'disk', options: { view: 'disk' } }
      ],
      statusKeys: [{ tileId: 'summary', key: 'media-server' }]
    },
    {
      title: 'Through a socket proxy, with start/stop/restart',
      config: { url: 'http://docker-proxy.example:2375', allowControl: true },
      options: { view: 'list' }
    }
  ],

  async fetch (ctx) {
    return await list(ctx)
  },

  // Re-list on every container event so status dots flip within a second instead of at the next poll.
  async stream (ctx, emit) {
    const { base, opts } = conn(ctx.config)
    /** @type {NodeJS.Timeout | undefined} */
    let timer
    const flush = () => list(ctx).then(emit, err => ctx.log.warn(`relist failed: ${err.message}`))
    const relist = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { timer = undefined; flush() }, 300)
    }
    // Events missed while no browser was connected (the stream was off) leave the last list stale.
    relist()
    try {
      for await (const ev of ctx.http.stream(`${base}/events`, { ...opts, query: { filters: JSON.stringify({ type: ['container'] }) } })) {
        if (EVENTS.has(String(ev?.Action ?? ev?.status ?? '').split(':')[0])) relist()
      }
    } finally {
      if (timer) {
        clearTimeout(timer)
        if (!ctx.signal.aborted) await flush()
      }
    }
  },

  jobs: {
    df: {
      schedule: '*/30 * * * *',
      description: 'Disk usage of images, containers, volumes and build cache (slow on big hosts, hence a job)',
      timeout: '5m',
      async run (ctx) {
        const { base, opts } = conn(ctx.config)
        const df = await ctx.http.json(`${base}/system/df`, { ...opts, timeout: 240_000 })
        const sum = (/** @type {any[]} */ xs, /** @type {(x: any) => number} */ f) => (xs ?? []).reduce((a, x) => a + (f(x) || 0), 0)
        ctx.state.set('df', {
          at: new Date().toISOString(),
          images: { count: df.Images?.length ?? 0, size: df.LayersSize ?? sum(df.Images, i => i.Size), unused: sum((df.Images ?? []).filter((/** @type {any} */ i) => !i.Containers), i => i.Size) },
          containers: { count: df.Containers?.length ?? 0, size: sum(df.Containers, c => c.SizeRw) },
          volumes: { count: df.Volumes?.length ?? 0, size: sum(df.Volumes, v => v.UsageData?.Size > 0 ? v.UsageData.Size : 0) },
          buildCache: { size: sum(df.BuildCache, b => b.Size) }
        })
      }
    }
  },

  render (data, o, ctx) {
    const all = data.containers ?? []
    if (o.view === 'disk') {
      const df = data.df
      if (!df) return { type: 'text', text: 'Waiting for the first disk usage job', tone: 'neutral' }
      return {
        type: 'stats',
        items: [
          { label: 'Images', value: df.images.size, format: 'bytes' },
          { label: 'Unused', value: df.images.unused, format: 'bytes' },
          { label: 'Volumes', value: df.volumes.size, format: 'bytes' },
          { label: 'Build cache', value: df.buildCache.size, format: 'bytes' }
        ]
      }
    }
    if (o.view === 'list') {
      let rows = o.containers?.length ? all.filter((/** @type {any} */ c) => o.containers.includes(c.name)) : all
      if (o.show === 'running') rows = rows.filter((/** @type {any} */ c) => c.state === 'running')
      if (o.show === 'stopped') rows = rows.filter((/** @type {any} */ c) => c.state !== 'running')
      if (o.show === 'problems') rows = rows.filter((/** @type {any} */ c) => ['error', 'warning'].includes(tone(c)) && c.health !== 'starting')
      return {
        type: 'list',
        empty: o.show === 'problems' ? 'All containers look fine' : 'No containers',
        items: rows.slice(0, o.limit).map((/** @type {any} */ c) => ({
          key: c.name,
          title: c.name,
          subtitle: c.status,
          badge: { text: c.health && c.health !== 'healthy' ? c.health : c.state, tone: tone(c) },
          actions: ctx.config.allowControl
            ? (c.state === 'running'
                ? [{ action: 'restart', title: 'Restart', input: { name: c.name } }, { action: 'stop', title: 'Stop', input: { name: c.name } }]
                : [{ action: 'start', title: 'Start', input: { name: c.name } }])
            : undefined
        }))
      }
    }
    const running = all.filter((/** @type {any} */ c) => c.state === 'running').length
    const unhealthy = all.filter((/** @type {any} */ c) => c.health === 'unhealthy').length
    const missing = all.filter((/** @type {any} */ c) => c.expected && c.state !== 'running').length
    return {
      type: 'stats',
      items: [
        { label: 'Running', value: running, format: 'number' },
        { label: 'Stopped', value: all.length - running, format: 'number' },
        { label: 'Unhealthy', value: unhealthy, format: 'number', warn: 1 },
        { label: 'Missing', value: missing, format: 'number', crit: 1 }
      ]
    }
  },

  status (data, key) {
    const c = (data.containers ?? []).find((/** @type {any} */ x) => x.name === key)
    if (!c) return { state: 'unknown', label: 'no such container' }
    if (c.health === 'unhealthy') return { state: 'down', label: 'unhealthy' }
    if (c.state === 'running') return c.health === 'starting' ? { state: 'warn', label: 'starting' } : { state: 'up', label: c.status }
    if (c.state === 'paused' || c.state === 'restarting') return { state: 'warn', label: c.state }
    return { state: 'down', label: c.status }
  },

  alerts (data, ctx) {
    const control = !!ctx.config.allowControl
    const out = []
    for (const c of data.containers ?? []) {
      if (c.expected && c.state !== 'running') {
        out.push({ id: `down:${c.name}`, severity: 'error', title: `${c.name} is ${c.state}`, message: c.status, actions: control ? [{ name: 'start', title: 'Start', input: { name: c.name } }] : [] })
      } else if (c.health === 'unhealthy') {
        out.push({ id: `unhealthy:${c.name}`, severity: 'warning', title: `${c.name} is unhealthy`, message: c.status, actions: control ? [{ name: 'restart', title: 'Restart', input: { name: c.name } }] : [] })
      }
    }
    return out
  },

  actions: {
    start: { title: 'Start', input: { type: 'object', properties: { name: { type: 'string' } } }, run: (ctx, input) => control(ctx, input.name, 'start') },
    stop: { title: 'Stop', input: { type: 'object', properties: { name: { type: 'string' } } }, run: (ctx, input) => control(ctx, input.name, 'stop') },
    restart: { title: 'Restart', input: { type: 'object', properties: { name: { type: 'string' } } }, run: (ctx, input) => control(ctx, input.name, 'restart') }
  }
}
