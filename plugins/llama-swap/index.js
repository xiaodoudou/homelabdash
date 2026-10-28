/** @param {any} ctx */
const base = ctx => ctx.config.url.replace(/\/+$/, '')
/** @param {any} ctx */
const http = ctx => ({ auth: ctx.config.apiKey ? { bearer: ctx.config.apiKey } : undefined, insecure: ctx.config.insecure })
/** @param {unknown} v */
const num = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)

/**
 * The samples of one Prometheus metric, with their labels.
 * @param {string} text @param {string} name
 */
function samples (text, name) {
  /** @type {{ labels: Record<string, string>, value: number }[]} */
  const out = []
  for (const line of text.split('\n')) {
    if (!line.startsWith(name) || (line[name.length] !== '{' && line[name.length] !== ' ')) continue
    const m = /^[^{\s]+(?:\{(.*)\})?\s+(\S+)/.exec(line)
    if (!m) continue
    /** @type {Record<string, string>} */
    const labels = {}
    for (const l of (m[1] ?? '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]] = l[2]
    const value = num(m[2])
    if (value !== null) out.push({ labels, value })
  }
  return out
}

/** @param {string} text */
function hostOf (text) {
  const cores = samples(text, 'llamaswap_cpu_util_percent').map(s => s.value)
  const one = (/** @type {string} */ n) => samples(text, n)[0]?.value ?? null
  const total = one('llamaswap_memory_total_bytes')
  const free = one('llamaswap_memory_free_bytes')
  return {
    cpu: cores.length ? cores.reduce((a, b) => a + b, 0) / cores.length : null,
    load: samples(text, 'llamaswap_load_average').find(s => s.labels.interval === '1m')?.value ?? null,
    memTotal: total,
    memUsed: one('llamaswap_memory_used_bytes') ?? (total !== null && free !== null ? total - free : null)
  }
}

/** @param {string} text */
function gpusOf (text) {
  /** @type {Map<string, Record<string, any>>} */
  const gpus = new Map()
  const fields = { util: 'gpu_util_percent', memUsed: 'gpu_memory_used_bytes', memTotal: 'gpu_memory_total_bytes', power: 'gpu_power_draw_watts', temp: 'gpu_temperature_celsius', fan: 'gpu_fan_speed_percent' }
  for (const [key, metric] of Object.entries(fields)) {
    for (const s of samples(text, `llamaswap_${metric}`)) {
      const id = s.labels.id ?? '0'
      const gpu = gpus.get(id) ?? { index: Number(id), name: s.labels.name ?? `GPU ${id}` }
      gpu[key] = s.value
      gpus.set(id, gpu)
    }
  }
  return [...gpus.values()].sort((a, b) => a.index - b.index)
}

// What follows a source's event stream, kept by source so that fetch() sees it too:
// the requests running now, the ones that just ended, and how many bytes each model streams per token.
/** @type {Map<string, { live: Map<string, any>, ended: any[], ratio: Map<string, number>, matched: Set<number> }>} */
const tracks = new Map()
// An in-flight request is refreshed about once a second; one silent this long has ended.
const STALE_MS = 15_000

/** @param {string} source */
function track (source) {
  let t = tracks.get(source)
  if (!t) tracks.set(source, t = { live: new Map(), ended: [], ratio: new Map(), matched: new Set() })
  return t
}

/**
 * Records one in-flight update. The byte rate between two updates, divided by the bytes per token the model was seen to
 * stream, gives a live tokens per second; llama-swap itself only counts tokens once a request is over.
 * @param {ReturnType<typeof track>} t @param {any} r @param {number} now
 */
function upsert (t, r, now) {
  const id = String(r.id)
  const bytes = num(r.resp_bytes)
  const elapsedMs = num(r.elapsed_ms)
  const prev = t.live.get(id)
  let rate = prev?.rate ?? null
  if (prev && bytes !== null && elapsedMs !== null && prev.bytes !== null && prev.elapsedMs !== null && elapsedMs > prev.elapsedMs) {
    const now1 = (bytes - prev.bytes) / ((elapsedMs - prev.elapsedMs) / 1000)
    rate = rate === null ? now1 : rate * 0.5 + now1 * 0.5
  }
  t.live.set(id, { id, model: r.model ?? null, bytes, elapsedMs, rate, seen: now })
}

/** @param {ReturnType<typeof track>} t @param {string} id @param {number} now */
function end (t, id, now) {
  const r = t.live.get(id)
  if (!r) return
  t.live.delete(id)
  t.ended.push({ ...r, endedAt: now })
  t.ended = t.ended.filter(e => now - e.endedAt < 120_000).slice(-50)
}

/** The requests running now, with a live tokens per second where the model's bytes per token is known. @param {string} source @param {number} now */
function current (source, now) {
  const t = tracks.get(source)
  if (!t) return []
  for (const [id, r] of t.live) if (now - r.seen > STALE_MS) end(t, id, now)
  return [...t.live.values()].map(r => {
    const ratio = r.model ? t.ratio.get(r.model) : undefined
    return { id: r.id, model: r.model, elapsedMs: r.elapsedMs, seen: r.seen, gen: ratio && r.rate !== null ? Math.max(0, r.rate / ratio) : null }
  })
}

/**
 * Learns each model's bytes per token: a finished request of the activity log is matched to the in-flight request that
 * ended with the same model and about the same duration, and its byte count divided by its output tokens.
 * @param {string} source @param {any[]} requests
 */
function learn (source, requests) {
  const t = tracks.get(source)
  if (!t) return
  for (const q of requests) {
    if (t.matched.has(q.id) || !q.output || q.durationMs === null || !q.model) continue
    let best = -1
    let gap = Infinity
    t.ended.forEach((e, i) => {
      const d = e.model === q.model && e.elapsedMs !== null ? Math.abs(e.elapsedMs - q.durationMs) : Infinity
      if (d < gap) { gap = d; best = i }
    })
    if (best < 0 || gap > Math.max(2000, q.durationMs * 0.15)) continue
    const e = t.ended.splice(best, 1)[0]
    t.matched.add(q.id)
    const bpt = e.bytes / q.output
    if (!(bpt > 10 && bpt < 5000)) continue
    const old = t.ratio.get(q.model)
    t.ratio.set(q.model, old === undefined ? bpt : old * 0.7 + bpt * 0.3)
  }
  if (t.matched.size > 500) t.matched = new Set([...t.matched].slice(-200))
}

/** llama-swap writes -1 for what a backend does not report @param {unknown} v */
const known = v => { const n = num(v); return n !== null && n >= 0 ? n : null }

/** @param {any} a one entry of /api/metrics/activity */
function request (a) {
  const t = a.tokens ?? {}
  const output = known(t.output_tokens)
  const ms = known(a.duration_ms)
  const reported = known(t.tokens_per_second)
  return {
    id: a.id,
    time: a.timestamp ?? null,
    model: a.model ?? null,
    status: num(a.resp_status_code),
    input: known(t.input_tokens),
    output,
    cached: known(t.cache_tokens),
    // vLLM backends report no speed: output tokens over the whole request is a slight underestimate, counting the prompt
    gen: reported ?? (output && ms ? output / (ms / 1000) : null),
    estimated: reported === null && !!output && !!ms,
    prompt: known(t.prompt_per_second),
    durationMs: ms
  }
}

/** "12.4 / 24.0 GB", in GiB like nvidia-smi and the OS report memory @param {number | null | undefined} used @param {number | null | undefined} total */
const amounts = (used, total) => used != null && total ? `${(used / 2 ** 30).toFixed(1)} / ${(total / 2 ** 30).toFixed(1)} GB` : null
/** @param {number | null | undefined} used @param {number | null | undefined} total */
const share = (used, total) => used != null && total ? (used / total) * 100 : null

/** @param {any} data @param {any} req @param {any} ctx */
const isFresh = (data, req, ctx) => !!req.time && data.at - Date.parse(req.time) < ctx.config.idleAfter * 1000

/** @param {number | null} v */
const rate = v => v === null ? '' : `${v.toLocaleString('en', { maximumFractionDigits: v < 100 ? 1 : 0 })} tok/s`

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'llama-swap',
  name: 'llama-swap',
  version: '0.1.0',
  description: 'The model llama-swap has loaded, the speed of its last requests, and the GPU, CPU and memory gauges it reports; it never loads a model, and with allowControl offers to unload one',
  interval: '10s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'llama-swap address, e.g. http://ai.example:8080' },
      apiKey: { type: 'string', description: 'When llama-swap is set up with apiKeys; use ${secret:...}' },
      insecure: { type: 'boolean', description: 'Accept a self-signed certificate' },
      idleAfter: { type: 'integer', minimum: 10, default: 300, description: 'Seconds after the last request when the model counts as idle' },
      allowControl: { type: 'boolean', default: false, description: 'Offer an Unload button on the loaded model (asks for a second click)' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: {
        enum: ['model', 'models', 'gpu', 'host', 'activity'],
        default: 'model',
        description: 'model: what is loaded and how fast it answered last; models: one row per loaded model; gpu: one GPU; host: CPU and memory; activity: the last requests'
      },
      gpu: { type: 'integer', minimum: 0, default: 0, description: 'Which GPU for view: gpu, as llama-swap numbers them' }
    }
  },

  examples: [
    {
      title: 'An AI server at a glance',
      config: { url: 'http://ai.example:8080', allowControl: true },
      tiles: [
        { id: 'model', options: { view: 'model' } },
        { id: 'models', options: { view: 'models' } },
        { id: 'gpu0', options: { view: 'gpu', gpu: 0 } },
        { id: 'gpu1', options: { view: 'gpu', gpu: 1 } },
        { id: 'host', options: { view: 'host' } },
        { id: 'activity', options: { view: 'activity' } }
      ]
    }
  ],

  async fetch (ctx) {
    const [running, metrics, activity] = await Promise.all([
      ctx.http.json(`${base(ctx)}/running`, http(ctx)),
      // the gauges and the activity log are extras: an older llama-swap without them still shows the model
      ctx.http.request(`${base(ctx)}/metrics`, { ...http(ctx), parse: 'text', throwOnError: false }).then(r => r.status < 400 ? String(r.body) : '').catch(() => ''),
      ctx.http.request(`${base(ctx)}/api/metrics/activity`, { ...http(ctx), throwOnError: false }).then(r => r.status < 400 ? r.body?.data ?? [] : []).catch(() => [])
    ])
    const requests = (Array.isArray(activity) ? activity : []).map(request).sort((a, b) => (b.id ?? 0) - (a.id ?? 0)).slice(0, 50)
    learn(ctx.source, requests)
    return {
      at: Date.now(),
      running: (running?.running ?? []).map((/** @type {any} */ r) => ({ model: r.model, state: r.state ?? null, ttl: num(r.ttl) })),
      gpus: gpusOf(metrics),
      host: hostOf(metrics),
      requests,
      inflight: current(ctx.source, Date.now())
    }
  },

  // llama-swap's own UI learns about running requests from /api/events: a snapshot, then an upsert per request every second.
  async stream (ctx, emit) {
    const t = track(ctx.source)
    t.live.clear()
    try {
      for await (const line of ctx.http.stream(`${base(ctx)}/api/events`, http(ctx))) {
        if (typeof line !== 'string' || !line.startsWith('data:')) continue
        let event, d
        try {
          event = JSON.parse(line.slice(5))
          if (event?.type !== 'inflight') continue
          d = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        } catch { continue }
        const now = Date.now()
        if (d?.operation === 'snapshot') {
          const ids = new Set((d.requests ?? []).map((/** @type {any} */ r) => String(r.id)))
          for (const id of [...t.live.keys()]) if (!ids.has(id)) end(t, id, now)
          for (const r of d.requests ?? []) upsert(t, r, now)
        } else if (d?.operation === 'upsert' && d.request) {
          upsert(t, d.request, now)
        } else {
          const id = d?.request?.id ?? d?.id
          if (id !== undefined) end(t, String(id), now)
        }
        const list = current(ctx.source, now)
        emit((/** @type {any} */ prev) => prev ? { ...prev, inflight: list } : prev)
      }
    } finally {
      t.live.clear()
    }
  },

  render (data, o, ctx) {
    switch (o.view) {
      case 'gpu': {
        const g = data.gpus.find((/** @type {any} */ x) => x.index === o.gpu)
        if (!g) return { type: 'text', text: data.gpus.length ? `No GPU ${o.gpu} (llama-swap reports ${data.gpus.map((/** @type {any} */ x) => x.index).join(', ')})` : 'llama-swap reports no GPU', tone: 'warning' }
        return {
          type: 'stats',
          items: [
            { label: 'Load', value: g.util ?? null, format: 'percent' },
            { label: 'VRAM', value: share(g.memUsed, g.memTotal), format: 'percent', warn: 90, crit: 97, detail: amounts(g.memUsed, g.memTotal) },
            { label: 'Power', value: g.power ?? null, format: 'number', unit: 'W' },
            { label: 'Temp', value: g.temp ?? null, format: 'temperature', warn: 80, crit: 90 }
          ]
        }
      }
      case 'host':
        return {
          type: 'stats',
          items: [
            { label: 'CPU', value: data.host.cpu, format: 'percent', warn: 85, crit: 95 },
            { label: 'RAM', value: share(data.host.memUsed, data.host.memTotal), format: 'percent', warn: 90, crit: 97, detail: amounts(data.host.memUsed, data.host.memTotal) },
            { label: 'Load', value: data.host.load, format: 'number' }
          ]
        }
      case 'activity':
        return {
          type: 'list',
          dense: true,
          limit: 5,
          empty: 'No requests yet',
          items: data.requests.map((/** @type {any} */ r) => ({
            key: String(r.id),
            title: r.model ?? 'unknown model',
            subtitle: [r.output !== null ? `${r.output} tokens out` : null, r.input !== null ? `${r.input} in` : null].filter(Boolean).join(', ') || undefined,
            value: rate(r.gen) || undefined,
            format: 'text',
            time: r.time ?? undefined,
            tone: r.status !== null && r.status >= 400 ? 'error' : undefined
          }))
        }
      case 'models':
        return {
          type: 'list',
          dense: true,
          empty: 'No model loaded',
          items: data.running.map((/** @type {any} */ r) => {
            const last = data.requests.find((/** @type {any} */ q) => q.model === r.model)
            const fresh = last && isFresh(data, last, ctx)
            const mine = (data.inflight ?? []).filter((/** @type {any} */ q) => q.model === r.model && Date.now() - q.seen <= STALE_MS)
            const active = mine.length
            const speeds = mine.map((/** @type {any} */ q) => q.gen).filter((/** @type {any} */ g) => g !== null)
            return {
              key: r.model,
              title: r.model,
              subtitle: [r.state, active ? `${active} running` : null, r.ttl ? `unloads after ${Math.round(r.ttl / 60)} min idle` : null].filter(Boolean).join(', '),
              icon: r.state === 'ready' ? 'mdi:brain' : 'mdi:timer-sand',
              value: speeds.length ? rate(speeds.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0)) : active ? '-- tok/s' : fresh && last.gen !== null ? rate(last.gen) : 'idle',
              format: 'text',
              actions: ctx.config.allowControl ? [{ action: 'unload', title: 'Unload', confirm: `Unload ${r.model}?`, input: { model: r.model } }] : undefined
            }
          })
        }
      default: {
        const loaded = data.running[0]
        const many = data.running.length > 1
        const last = data.requests[0]
        const fresh = last && isFresh(data, last, ctx)
        const running = (data.inflight ?? []).filter((/** @type {any} */ r) => Date.now() - r.seen <= STALE_MS)
        const active = running.length
        const speeds = running.map((/** @type {any} */ r) => r.gen).filter((/** @type {any} */ g) => g !== null)
        const liveGen = speeds.length ? speeds.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0) : null
        return {
          type: 'stats',
          actions: !ctx.config.allowControl || !loaded
            ? undefined
            : many
              ? [{ action: 'unloadAll', title: 'Unload all', confirm: `Unload all ${data.running.length} models?` }]
              : [{ action: 'unload', title: 'Unload', confirm: `Unload ${loaded.model}?`, input: { model: loaded.model } }],
          items: [
            many
              ? { label: `${data.running.length} models`, value: data.running.map((/** @type {any} */ r) => r.model).join(', '), format: 'text' }
              : { label: loaded?.state && loaded.state !== 'ready' ? loaded.state : 'Model', value: loaded ? loaded.model : 'none loaded', format: 'text' },
            active && liveGen !== null
              ? { label: 'Generation', value: liveGen, format: 'number', unit: 'tok/s' }
              : fresh && !active ? { label: 'Generation', value: last.gen, format: 'number', unit: 'tok/s' } : active ? { label: 'Generation', value: null, format: 'number', unit: 'tok/s' } : { label: 'Generation', value: 'idle', format: 'text' },
            // a backend that reports no prompt speed (vLLM) gets no Prompt stat rather than an empty one
            ...(last && last.prompt === null ? [] : active ? [{ label: 'Prompt', value: null, format: 'number', unit: 'tok/s' }] : fresh ? [{ label: 'Prompt', value: last.prompt, format: 'number', unit: 'tok/s' }] : [{ label: 'Prompt', value: 'idle', format: 'text' }]),
            { label: 'Active', value: active, format: 'number' }
          ]
        }
      }
    }
  },

  status (data, key) {
    const r = data.running.find((/** @type {any} */ x) => x.model === key)
    if (!r) return { state: 'warn', label: 'not loaded' }
    return r.state === 'ready' ? { state: 'up', label: 'ready' } : { state: 'warn', label: r.state ?? 'starting' }
  },

  actions: {
    unload: {
      title: 'Unload',
      input: { type: 'object', additionalProperties: false, required: ['model'], properties: { model: { type: 'string' } } },
      async run (ctx, input) {
        if (!ctx.config.allowControl) throw new Error('unloading is off for this source (set allowControl: true)')
        await ctx.http.json(`${base(ctx)}/api/models/unload/${encodeURIComponent(input.model)}`, { ...http(ctx), method: 'POST', parse: 'text' })
        ctx.refresh()
        return { ok: true }
      }
    },
    unloadAll: {
      title: 'Unload all',
      async run (ctx) {
        if (!ctx.config.allowControl) throw new Error('unloading is off for this source (set allowControl: true)')
        await ctx.http.json(`${base(ctx)}/unload`, { ...http(ctx), parse: 'text' })
        ctx.refresh()
        return { ok: true }
      }
    }
  }
}
