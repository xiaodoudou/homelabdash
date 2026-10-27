import { createHash } from 'node:crypto'

/** @param {any} ctx */
const base = ctx => ctx.config.url.replace(/\/+$/, '')
/** @param {any} ctx */
const http = ctx => ({ auth: ctx.config.apiKey ? { bearer: ctx.config.apiKey } : undefined, insecure: ctx.config.insecure })
const END = /** @type {Record<string, string>} */ ({ execution_success: 'done', execution_error: 'failed', execution_interrupted: 'interrupted' })

/**
 * One finished job, from /history. The prompt itself is left out: what people generate is theirs.
 * @param {string} id @param {any} h
 */
function job (id, h) {
  const messages = Array.isArray(h?.status?.messages) ? h.status.messages : []
  const at = (/** @type {string} */ type) => messages.find((/** @type {any} */ m) => m[0] === type)?.[1]
  const start = at('execution_start')?.timestamp ?? null
  const endMsg = messages.find((/** @type {any} */ m) => END[m[0]])
  const end = endMsg?.[1]?.timestamp ?? null
  const error = at('execution_error')
  return {
    id,
    number: typeof h?.prompt?.[0] === 'number' ? h.prompt[0] : null,
    result: endMsg ? END[endMsg[0]] : h?.status?.status_str === 'error' ? 'failed' : h?.status?.completed ? 'done' : 'unknown',
    start,
    end,
    seconds: start && end ? Math.max(0, (end - start) / 1000) : null,
    outputs: Object.values(h?.outputs ?? {}).reduce((/** @type {number} */ n, /** @type {any} */ o) => n + (o.images?.length ?? 0) + (o.gifs?.length ?? 0) + (o.videos?.length ?? 0), 0),
    error: error ? `${error.node_type ?? 'node'}: ${String(error.exception_message ?? '').trim().split('\n')[0].trim().slice(0, 160)}` : null
  }
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'comfyui',
  name: 'ComfyUI',
  version: '0.1.0',
  description: 'Whether ComfyUI is generating, its queue, the last jobs and how long they took, and its VRAM; prompts and images stay private',
  interval: '5s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'ComfyUI address, e.g. http://ai.example:8188' },
      apiKey: { type: 'string', description: 'Bearer token when ComfyUI sits behind a login (for example ComfyUI-RigShare); use ${secret:...}' },
      insecure: { type: 'boolean', description: 'Accept a self-signed certificate' },
      historySize: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'How many finished jobs to read' },
      failureAlerts: { type: 'boolean', default: true, description: 'Raise one alert while recent jobs have failed' },
      allowControl: { type: 'boolean', default: false, description: 'Offer Interrupt (the running job) and Free VRAM (unload the models) on the queue view; both ask for a second click' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['queue', 'history', 'system'], default: 'queue', description: 'queue: generating or idle, and what waits; history: the last jobs; system: VRAM, RAM and version' }
    }
  },

  examples: [
    {
      title: 'ComfyUI at work',
      config: { url: 'http://ai.example:8188', apiKey: 'test-key', allowControl: true },
      tiles: [
        { id: 'queue', options: { view: 'queue' } },
        { id: 'history', options: { view: 'history' } },
        { id: 'system', options: { view: 'system' } }
      ]
    }
  ],

  async fetch (ctx) {
    const [queue, history, stats] = await Promise.all([
      ctx.http.json(`${base(ctx)}/queue`, http(ctx)),
      ctx.http.json(`${base(ctx)}/history`, { ...http(ctx), query: { max_items: ctx.config.historySize } }),
      ctx.http.json(`${base(ctx)}/system_stats`, http(ctx)).catch(() => null)
    ])
    const jobs = Object.entries(history ?? {}).map(([id, h]) => job(id, h)).sort((a, b) => (b.end ?? b.number ?? 0) - (a.end ?? a.number ?? 0))
    const device = stats?.devices?.[0]
    return {
      at: Date.now(),
      running: Array.isArray(queue?.queue_running) ? queue.queue_running.length : 0,
      pending: Array.isArray(queue?.queue_pending) ? queue.queue_pending.length : 0,
      jobs,
      system: stats
        ? {
            version: stats.system?.comfyui_version ?? null,
            ramTotal: stats.system?.ram_total ?? null,
            ramFree: stats.system?.ram_free ?? null,
            device: device ? { name: device.name ?? null, vramTotal: device.vram_total ?? null, vramFree: device.vram_free ?? null } : null
          }
        : null
    }
  },

  render (data, o, ctx) {
    switch (o.view) {
      case 'history':
        return {
          type: 'list',
          dense: true,
          limit: 5,
          empty: 'No job yet',
          items: data.jobs.map((/** @type {any} */ j) => ({
            key: j.id,
            title: j.result === 'done' ? `Done${j.outputs ? `, ${j.outputs} output${j.outputs > 1 ? 's' : ''}` : ''}` : j.result === 'failed' ? 'Failed' : j.result === 'interrupted' ? 'Interrupted' : 'Unknown',
            subtitle: j.error ?? undefined,
            icon: j.result === 'done' ? 'mdi:check-circle-outline' : j.result === 'failed' ? 'mdi:alert-circle-outline' : 'mdi:stop-circle-outline',
            tone: j.result === 'failed' ? 'error' : j.result === 'interrupted' ? 'warning' : undefined,
            value: j.seconds ?? undefined,
            format: j.seconds === null ? undefined : 'duration',
            time: j.end ?? undefined
          }))
        }
      case 'system': {
        if (!data.system) return { type: 'text', text: 'ComfyUI did not answer /system_stats', tone: 'warning' }
        const d = data.system.device
        return {
          type: 'stats',
          items: [
            { label: 'VRAM', value: d && d.vramTotal !== null && d.vramFree !== null ? d.vramTotal - d.vramFree : null, format: 'bytes' },
            { label: 'RAM free', value: data.system.ramFree, format: 'bytes' },
            { label: 'Version', value: data.system.version, format: 'text' }
          ]
        }
      }
      default: {
        const last = data.jobs.find((/** @type {any} */ j) => j.seconds !== null)
        return {
          type: 'stats',
          actions: ctx.config.allowControl
            ? [
                ...(data.running ? [{ action: 'interrupt', title: 'Interrupt', confirm: 'Stop the running job?' }] : []),
                { action: 'free', title: 'Free VRAM', confirm: 'Unload the ComfyUI models?' }
              ]
            : undefined,
          items: [
            { label: 'Status', value: data.running ? 'generating' : 'idle', format: 'text', tone: data.running ? 'ok' : undefined },
            { label: 'Queued', value: data.pending, format: 'number' },
            { label: 'Last job', value: last ? last.seconds : null, format: 'duration' }
          ]
        }
      }
    }
  },

  alerts (data, ctx) {
    if (!ctx.config.failureAlerts) return []
    const failed = data.jobs.filter((/** @type {any} */ j) => j.result === 'failed')
    if (!failed.length) return []
    return [{
      // the set of failed jobs is the id: a dismissed alert comes back only when another job fails
      id: `failed:${createHash('sha1').update(failed.map((/** @type {any} */ j) => j.id).sort().join(',')).digest('hex').slice(0, 12)}`,
      severity: 'warning',
      title: failed.length === 1 ? 'A ComfyUI job failed' : `${failed.length} ComfyUI jobs failed`,
      message: failed[0].error ?? 'see the ComfyUI log',
      href: base(ctx),
      time: failed[0].end ?? undefined
    }]
  },

  actions: {
    interrupt: {
      title: 'Interrupt',
      async run (ctx) {
        if (!ctx.config.allowControl) throw new Error('control is off for this source (set allowControl: true)')
        await ctx.http.json(`${base(ctx)}/interrupt`, { ...http(ctx), json: {}, parse: 'text' })
        ctx.refresh()
        return { ok: true }
      }
    },
    free: {
      title: 'Free VRAM',
      async run (ctx) {
        if (!ctx.config.allowControl) throw new Error('control is off for this source (set allowControl: true)')
        await ctx.http.json(`${base(ctx)}/free`, { ...http(ctx), json: { unload_models: true, free_memory: true }, parse: 'text' })
        ctx.refresh()
        return { ok: true }
      }
    }
  }
}
