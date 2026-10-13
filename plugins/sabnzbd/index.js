const MB = 1024 * 1024
const TONE = /** @type {Record<string, string>} */ ({ Downloading: 'ok', Paused: 'warning' })

/** @param {import('homelabdash/sdk').Context} ctx */
const base = ctx => ctx.config.url.replace(/\/+$/, '')

/** @param {unknown} v @param {number} [factor] */
const num = (v, factor = 1) => v === null || v === undefined || v === '' ? null : Number(v) * factor

/**
 * "H:MM:SS" or "D:HH:MM:SS" (and "M:SS" for pause_int) into seconds.
 * @param {unknown} t
 */
function seconds (t) {
  const parts = String(t ?? '').split(':').map(Number)
  if (parts.length < 2 || parts.length > 4 || parts.some(n => !Number.isFinite(n))) return null
  return parts.reverse().reduce((acc, n, i) => acc + n * [1, 60, 3600, 86400][i], 0)
}

/**
 * @param {import('homelabdash/sdk').Context} ctx
 * @param {string} mode
 * @param {Record<string, string | number>} [query]
 */
async function api (ctx, mode, query = {}) {
  const res = await ctx.http.json(`${base(ctx)}/api`, { query: { mode, output: 'json', apikey: ctx.config.apiKey, ...query } })
  // A wrong key or mode comes back as HTTP 200 with { status: false, error }.
  if (res?.error) throw new Error(`SABnzbd: ${res.error}`)
  return res
}

/** @param {import('homelabdash/sdk').Context} ctx @param {'pause' | 'resume'} mode */
async function control (ctx, mode) {
  if (!ctx.config.allowControl) throw new Error('queue control is off for this source (set allowControl: true)')
  await api(ctx, mode)
  return { paused: mode === 'pause' }
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'sabnzbd',
  name: 'SABnzbd',
  version: '1.0.0',
  description: 'SABnzbd download rate, queue and time left; alerts when the queue is paused or disk space runs low; optional pause and resume',
  interval: '10s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'apiKey'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'SABnzbd web UI, e.g. http://sabnzbd.example:8080' },
      apiKey: { type: 'string', description: 'API key (Config > General > Security); use ${secret:...}' },
      allowControl: { type: 'boolean', default: false, description: 'Enable the pause and resume actions' },
      diskSpaceAlertGb: { type: 'number', minimum: 0, default: 0, description: 'Alert when the incomplete or complete folder has less free space than this, in GB (0: off)' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['summary', 'queue'], default: 'summary' },
      limit: { type: 'integer', minimum: 1, default: 10, description: 'Rows in the queue view' }
    }
  },

  examples: [
    {
      title: 'Summary and queue, alert below 50 GB free',
      config: { url: 'http://sabnzbd.example:8080', apiKey: '${secret:SABNZBD_API_KEY}', diskSpaceAlertGb: 50 },
      tiles: [
        { id: 'summary', options: { view: 'summary' } },
        { id: 'queue', options: { view: 'queue', limit: 5 } }
      ]
    },
    {
      title: 'With pause and resume buttons',
      config: { url: 'http://sabnzbd.example:8080', apiKey: '${secret:SABNZBD_API_KEY}', allowControl: true },
      options: { view: 'summary' }
    }
  ],

  async fetch (ctx) {
    const limit = Math.max(1, ...ctx.tiles.filter(t => t.options.view === 'queue').map(t => t.options.limit))
    const { queue: q } = await api(ctx, 'queue', { limit })
    return {
      paused: !!q.paused,
      resumesIn: q.pause_int && q.pause_int !== '0' ? seconds(q.pause_int) : null,
      rate: num(q.kbpersec, 1024),
      count: num(q.noofslots),
      timeLeft: seconds(q.timeleft),
      left: num(q.mbleft, MB),
      freeGb: { incomplete: num(q.diskspace1), complete: num(q.diskspace2) },
      slots: (q.slots ?? []).map((/** @type {any} */ s) => ({ id: s.nzo_id, name: s.filename, status: s.status, percent: num(s.percentage) ?? 0, timeLeft: seconds(s.timeleft) }))
    }
  },

  render (data, o, ctx) {
    const actions = ctx.config.allowControl
      ? [data.paused ? { action: 'resume', title: 'Resume' } : { action: 'pause', title: 'Pause' }]
      : undefined
    if (o.view === 'queue') {
      return {
        type: 'list',
        actions,
        empty: 'Queue is empty',
        items: data.slots.slice(0, o.limit).map((/** @type {any} */ s) => ({
          key: s.id,
          title: s.name,
          badge: { text: String(s.status).toLowerCase(), tone: TONE[s.status] ?? 'neutral' },
          progress: { value: s.percent, max: 100 },
          // Paused slots report 0:00:00.
          value: s.timeLeft || undefined,
          format: 'duration'
        }))
      }
    }
    return {
      type: 'stats',
      actions,
      items: [
        { label: 'Rate', value: data.rate, format: 'byterate' },
        { label: 'Queue', value: data.count, format: 'number' },
        { label: 'Time left', value: data.timeLeft, format: 'duration' },
        { label: 'Left', value: data.left, format: 'bytes' }
      ]
    }
  },

  alerts (data, ctx) {
    const href = base(ctx)
    const out = []
    if (data.paused) {
      out.push({
        id: 'paused',
        severity: 'warning',
        title: 'SABnzbd is paused',
        message: data.resumesIn ? `The queue resumes in ${Math.ceil(data.resumesIn / 60)} min` : 'The download queue is paused',
        href,
        actions: ctx.config.allowControl ? [{ name: 'resume', title: 'Resume' }] : []
      })
    }
    const min = ctx.config.diskSpaceAlertGb
    if (min > 0) {
      const low = Object.entries(data.freeGb)
        .filter(([, gb]) => gb !== null && gb < min)
        .sort((a, b) => a[1] - b[1])[0]
      if (low) {
        out.push({
          id: 'diskspace',
          severity: 'warning',
          title: 'SABnzbd is low on disk space',
          message: `${Math.round(low[1])} GB free in the ${low[0]} folder (alert below ${min} GB)`,
          href
        })
      }
    }
    return out
  },

  actions: {
    pause: { title: 'Pause', description: 'Pause the download queue (needs allowControl)', run: ctx => control(ctx, 'pause') },
    resume: { title: 'Resume', description: 'Resume the download queue (needs allowControl)', run: ctx => control(ctx, 'resume') }
  }
}
