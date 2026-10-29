const DECISION = /** @type {Record<string, string>} */ ({ 'direct play': 'direct play', copy: 'direct stream', transcode: 'transcode' })

/** @param {unknown} v */
const num = v => v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v)

/** @param {unknown} v */
const pad = v => String(v).padStart(2, '0')

/** @param {any} s */
function title (s) {
  if (s.media_type === 'episode') {
    const se = num(s.parent_media_index) !== null && num(s.media_index) !== null ? `S${pad(s.parent_media_index)}E${pad(s.media_index)} - ` : ''
    return `${s.grandparent_title}: ${se}${s.title}`
  }
  if (s.media_type === 'movie') return s.year ? `${s.title} (${s.year})` : s.title
  return s.full_title || s.title
}

/** @param {any} s */
function session (s) {
  const duration = num(s.duration)
  const offset = num(s.view_offset)
  return {
    key: String(s.session_key ?? s.session_id),
    // terminate_session takes either; the id is what Tautulli itself uses to stop a stream
    stop: s.session_id ? { session_id: String(s.session_id) } : { session_key: String(s.session_key) },
    title: title(s),
    user: s.friendly_name || s.username || s.user || null,
    player: s.player || s.product || null,
    decision: DECISION[s.transcode_decision] ?? s.transcode_decision ?? null,
    state: s.state ?? null,
    progress: num(s.progress_percent),
    duration: duration || null,
    remaining: duration && offset !== null ? Math.max(0, (duration - offset) / 1000) : null
  }
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'tautulli',
  name: 'Tautulli',
  version: '1.0.0',
  description: 'Plex streams playing now, with progress, time left and transcode decision, from the Tautulli API; streams can be stopped from the dashboard',
  interval: '15s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'apiKey'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'Tautulli address, e.g. http://tautulli.example:8181' },
      apiKey: { type: 'string', description: 'Settings > Web Interface > API key; use ${secret:...}' },
      allowControl: { type: 'boolean', default: false, description: 'Offer a Stop button on each stream (Tautulli terminate_session; Plex needs a Plex Pass for it)' },
      stopMessage: { type: 'string', description: 'Message shown on the player when a stream is stopped from the dashboard' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['sessions', 'summary'], default: 'sessions' },
      showUser: { type: 'boolean', default: true, description: 'Show who is watching (view: sessions)' }
    }
  },

  examples: [
    {
      title: 'Now playing and stream counts',
      config: { url: 'http://tautulli.example:8181', apiKey: '${secret:TAUTULLI_API_KEY}' },
      tiles: [
        { id: 'sessions', options: { view: 'sessions' } },
        { id: 'summary', options: { view: 'summary' } }
      ]
    },
    {
      title: 'Now playing without user names, with Stop buttons',
      config: { url: 'http://tautulli.example:8181', apiKey: '${secret:TAUTULLI_API_KEY}', allowControl: true },
      options: { view: 'sessions', showUser: false }
    }
  ],

  async fetch (ctx) {
    const res = await ctx.http.json(`${ctx.config.url.replace(/\/+$/, '')}/api/v2`, { query: { apikey: ctx.config.apiKey, cmd: 'get_activity' } })
    const r = res?.response
    if (r?.result !== 'success') throw new Error(`Tautulli API: ${r?.message || 'unexpected response'}`)
    const d = r.data ?? {}
    const kbps = num(d.total_bandwidth)
    return {
      at: Date.now(),
      streams: num(d.stream_count) ?? 0,
      transcodes: num(d.stream_count_transcode) ?? 0,
      bandwidth: kbps === null ? null : kbps * 1000,
      sessions: (d.sessions ?? []).map(session)
    }
  },

  render (data, o, ctx) {
    if (o.view === 'summary') {
      return {
        type: 'stats',
        items: [
          { label: 'Streams', value: data.streams, format: 'number' },
          { label: 'Transcodes', value: data.transcodes, format: 'number' },
          { label: 'Bandwidth', value: data.bandwidth, format: 'bitrate' }
        ]
      }
    }
    return {
      type: 'list',
      empty: 'Nothing playing',
      items: data.sessions.map((/** @type {any} */ s) => {
        // A playing stream counts down in the browser between fetches; a paused one stays put.
        const live = s.state === 'playing' && s.remaining !== null && s.duration
        const end = live ? data.at + s.remaining * 1000 : 0
        return {
          key: s.key,
          title: s.title,
          subtitle: [o.showUser ? s.user : null, s.player, s.decision].filter(Boolean).join(' - ') || undefined,
          icon: s.state === 'paused' ? 'mdi:pause' : s.state === 'buffering' ? 'mdi:timer-sand' : 'mdi:play',
          progress: s.progress === null ? undefined : live ? { value: s.progress, max: 100, start: end - s.duration, end } : { value: s.progress, max: 100 },
          value: live ? end : s.remaining ?? undefined,
          format: s.remaining === null ? undefined : live ? 'until' : 'clock',
          actions: ctx.config.allowControl ? [{ action: 'stop', title: 'Stop', confirm: 'Stop this stream?', input: s.stop }] : undefined
        }
      })
    }
  },

  actions: {
    stop: {
      title: 'Stop',
      input: {
        type: 'object',
        additionalProperties: false,
        properties: { session_id: { type: 'string' }, session_key: { type: 'string' } }
      },
      async run (ctx, input) {
        if (!ctx.config.allowControl) throw new Error('stopping streams is off for this source (set allowControl: true)')
        if (!input.session_id && !input.session_key) throw new Error('no session to stop')
        const res = await ctx.http.json(`${ctx.config.url.replace(/\/+$/, '')}/api/v2`, {
          query: { apikey: ctx.config.apiKey, cmd: 'terminate_session', ...input, message: ctx.config.stopMessage }
        })
        const r = res?.response
        if (r?.result !== 'success') throw new Error(`Tautulli could not stop the stream: ${r?.message || 'unexpected response'}`)
        ctx.refresh()
        return { ok: true }
      }
    }
  }
}
