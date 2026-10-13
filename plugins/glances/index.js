const NEEDS = /** @type {Record<string, string[]>} */ ({
  summary: ['cpu', 'mem', 'load', 'uptime'],
  cpu: ['cpu'],
  memory: ['mem'],
  load: ['load'],
  gpu: ['gpu'],
  sensors: ['sensors'],
  fs: ['fs'],
  uptime: ['uptime']
})

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'glances',
  name: 'Glances',
  version: '1.0.0',
  description: 'CPU, memory, load, GPU, sensors, disks and uptime from the Glances REST API v4',
  interval: '10s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'Glances web server, e.g. http://nas.example:61208' },
      username: { type: 'string', description: 'Only when Glances runs with --password' },
      password: { type: 'string' },
      gpuTemperatureAlert: { type: 'number', default: 90, description: 'Raise an alert when a GPU reaches this temperature (C); 0 turns it off' },
      sensorAlerts: { type: 'boolean', default: true, description: 'Raise an alert when a sensor passes its own critical threshold' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      metric: { enum: Object.keys(NEEDS), default: 'summary' },
      gpu: { type: 'integer', minimum: 0, default: 0, description: 'GPU index (metric: gpu)' },
      sensors: { type: 'array', items: { type: 'string' }, description: 'Sensor labels to show (metric: sensors). Default: every temperature sensor' },
      mounts: { type: 'array', items: { type: 'string' }, description: 'Mount points to show (metric: fs). Default: every real filesystem' }
    }
  },

  examples: [
    {
      title: 'Every metric of one host',
      config: { url: 'http://nas.example:61208' },
      tiles: [
        { id: 'summary', options: { metric: 'summary' } },
        { id: 'cpu', options: { metric: 'cpu' } },
        { id: 'memory', options: { metric: 'memory' } },
        { id: 'load', options: { metric: 'load' } },
        { id: 'gpu', options: { metric: 'gpu' } },
        { id: 'sensors', options: { metric: 'sensors' } },
        { id: 'fs', options: { metric: 'fs', mounts: ['/mnt/data'] } },
        { id: 'uptime', options: { metric: 'uptime' } }
      ]
    }
  ],

  async fetch (ctx) {
    const wanted = new Set(ctx.tiles.flatMap(t => NEEDS[t.options.metric ?? 'summary']))
    if (ctx.config.gpuTemperatureAlert) wanted.add('gpu')
    if (ctx.config.sensorAlerts && ctx.tiles.some(t => t.options.metric === 'sensors')) wanted.add('sensors')
    if (!wanted.size) NEEDS.summary.forEach(e => wanted.add(e))
    const base = ctx.config.url.replace(/\/+$/, '')
    const auth = ctx.config.username ? { basic: { username: ctx.config.username, password: ctx.config.password ?? '' } } : undefined
    const entries = await Promise.all([...wanted].map(async ep => {
      try {
        return [ep, await ctx.http.json(`${base}/api/4/${ep}`, { auth })]
      } catch (err) {
        // A missing plugin in Glances (no GPU, no sensors) answers 404; the other endpoints still count.
        if (/** @type {any} */ (err).status === 404) return [ep, null]
        throw err
      }
    }))
    return Object.fromEntries(entries)
  },

  render (data, o) {
    switch (o.metric ?? 'summary') {
      case 'summary':
        return {
          type: 'stats',
          items: [
            { label: 'CPU', value: cpuPercent(data.cpu), format: 'percent', warn: 80, crit: 95 },
            { label: 'RAM', value: data.mem?.percent ?? null, format: 'percent', warn: 85, crit: 95 },
            { label: 'Load', value: data.load?.min1 ?? null, format: 'number' },
            { label: 'Uptime', value: uptimeSeconds(data.uptime), format: 'duration' }
          ]
        }
      case 'cpu':
        return {
          type: 'stats',
          items: [
            { label: 'CPU', value: cpuPercent(data.cpu), format: 'percent', warn: 80, crit: 95 },
            { label: 'I/O wait', value: data.cpu?.iowait ?? null, format: 'percent', warn: 20 },
            { label: 'Cores', value: data.cpu?.cpucore ?? null, format: 'number' }
          ]
        }
      case 'memory':
        return {
          type: 'stats',
          items: [
            { label: 'Used', value: data.mem?.percent ?? null, format: 'percent', warn: 85, crit: 95 },
            { label: 'Used', value: data.mem?.used ?? null, format: 'bytes' },
            { label: 'Free', value: data.mem?.available ?? null, format: 'bytes' }
          ]
        }
      case 'load':
        return {
          type: 'stats',
          items: [
            { label: '1 min', value: data.load?.min1 ?? null, format: 'number' },
            { label: '5 min', value: data.load?.min5 ?? null, format: 'number' },
            { label: '15 min', value: data.load?.min15 ?? null, format: 'number' }
          ]
        }
      case 'gpu': {
        const gpu = Array.isArray(data.gpu) ? data.gpu[o.gpu ?? 0] : null
        if (!gpu) return { type: 'text', text: 'No GPU reported by Glances', tone: 'neutral' }
        return {
          type: 'stats',
          items: [
            { label: 'Load', value: gpu.proc ?? null, format: 'percent', warn: 90 },
            { label: 'VRAM', value: gpu.mem ?? null, format: 'percent', warn: 90 },
            { label: 'Temp', value: gpu.temperature ?? null, format: 'temperature', warn: 80, crit: 90 },
            { label: 'Fan', value: gpu.fan_speed ?? null, format: 'percent' }
          ]
        }
      }
      case 'sensors': {
        const list = (data.sensors ?? []).filter((/** @type {any} */ s) =>
          o.sensors?.length ? o.sensors.includes(s.label) : String(s.type).startsWith('temperature'))
        return {
          type: 'stats',
          items: list.map((/** @type {any} */ s) => ({
            label: s.label,
            value: s.value,
            format: s.unit === 'C' ? 'temperature' : 'number',
            unit: s.unit === 'C' ? undefined : s.unit,
            warn: s.warning ?? undefined,
            crit: s.critical ?? undefined
          }))
        }
      }
      case 'fs': {
        const seen = new Set()
        const list = (data.fs ?? []).filter((/** @type {any} */ f) => {
          if (o.mounts?.length) return o.mounts.includes(f.mnt_point)
          if (!f.size || f.mnt_point.startsWith('/etc/') || seen.has(f.device_name)) return false
          seen.add(f.device_name)
          return true
        })
        return {
          type: 'progress',
          items: list.map((/** @type {any} */ f) => ({ label: f.mnt_point, value: f.used, max: f.size, format: 'bytes', warn: 85, crit: 95 }))
        }
      }
      case 'uptime':
        return { type: 'stats', items: [{ label: 'Uptime', value: uptimeSeconds(data.uptime), format: 'duration' }] }
      default:
        return null
    }
  },

  alerts (data, ctx) {
    const out = []
    const limit = ctx.config.gpuTemperatureAlert
    if (limit && Array.isArray(data.gpu)) {
      for (const g of data.gpu) {
        if (g.temperature >= limit) {
          out.push({ id: `gpu-hot:${g.gpu_id}`, severity: 'warning', title: `${g.name ?? g.gpu_id} at ${g.temperature} C`, message: `GPU temperature is at or above ${limit} C (fan ${g.fan_speed ?? '?'}%)` })
        }
      }
    }
    if (ctx.config.sensorAlerts && Array.isArray(data.sensors)) {
      for (const s of data.sensors) {
        if (typeof s.critical === 'number' && typeof s.value === 'number' && s.value >= s.critical) {
          out.push({ id: `sensor-critical:${s.label}`, severity: 'error', title: `${s.label} at ${s.value} ${s.unit ?? ''}`.trim(), message: `above its critical threshold (${s.critical})` })
        }
      }
    }
    return out
  }
}

/**
 * Glances computes CPU usage since the previous request; after a long gap the first answer is meaningless.
 * @param {any} cpu
 */
function cpuPercent (cpu) {
  if (!cpu || typeof cpu.total !== 'number') return null
  if (typeof cpu.time_since_update === 'number' && cpu.time_since_update > 300) return null
  return cpu.total
}

/** @param {unknown} uptime "21 days, 11:48:14" or "11:48:14" */
function uptimeSeconds (uptime) {
  if (typeof uptime !== 'string') return null
  const m = /^(?:(\d+) days?, )?(\d+):(\d+):(\d+)/.exec(uptime)
  if (!m) return null
  return Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4])
}
