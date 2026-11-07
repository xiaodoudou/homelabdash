export const READINGS = 'nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,power.draw,power.limit,temperature.gpu,fan.speed,pstate --format=csv,noheader,nounits'
// each card's own temperature limits, which --query-gpu does not offer
export const LIMITS = 'nvidia-smi -q -d TEMPERATURE'
// The one command the plugin runs over SSH. A forced-command key can be locked to exactly this line (see README).
export const QUERY = `${READINGS} && ${LIMITS}`

/** @param {string | undefined} v nvidia-smi writes "[N/A]" or "[Not Supported]" for what a card doesn't report */
const num = v => v === undefined || v.startsWith('[') || v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v)
const MIB = 1024 * 1024

/**
 * The temperature limits of `nvidia-smi -q` in GPU order: one block per card, starting at its bus id.
 * @param {string} text
 */
function parseLimits (text) {
  /** @type {{ maxOperating: number | null, slowdown: number | null }[]} */
  const out = []
  for (const line of text.split('\n')) {
    if (/^GPU [0-9A-F]+:[0-9A-F:.]+$/i.test(line.trim())) out.push({ maxOperating: null, slowdown: null })
    const m = /^\s*GPU (Max Operating|Slowdown) Temp\s*:\s*(\d+)\s*C/.exec(line)
    if (m && out.length) out[out.length - 1][m[1] === 'Slowdown' ? 'slowdown' : 'maxOperating'] = Number(m[2])
  }
  return out
}

/**
 * Where a card's temperature turns red: its max operating temperature, else its slowdown; yellow 5°C before.
 * A card that reports neither, or a key still locked to the readings alone, keeps 80 and 90.
 * @param {{ maxOperating: number | null, slowdown: number | null } | undefined} l
 */
function tempLimits (l) {
  const crit = l?.maxOperating ?? l?.slowdown ?? null
  return crit === null ? { warn: 80, crit: 90 } : { warn: crit - 5, crit }
}

/** @param {string} stdout readings as CSV, then the `nvidia-smi -q` limits when the command printed them */
function parse (stdout) {
  const at = stdout.search(/^=+NVSMI LOG=+/m)
  const limits = at < 0 ? [] : parseLimits(stdout.slice(at))
  return (at < 0 ? stdout : stdout.slice(0, at)).split('\n').map(l => l.trim()).filter(Boolean).map((line, i) => {
    const [index, name, util, memUsed, memTotal, power, powerLimit, temp, fan, pstate] = line.split(',').map(s => s.trim())
    const used = num(memUsed)
    const total = num(memTotal)
    return {
      index: Number(index),
      name,
      util: num(util),
      memUsed: used === null ? null : used * MIB,
      memTotal: total === null ? null : total * MIB,
      power: num(power),
      powerLimit: num(powerLimit),
      temp: num(temp),
      fan: num(fan),
      pstate: pstate && !pstate.startsWith('[') ? pstate : null,
      ...tempLimits(limits[i])
    }
  }).filter(g => Number.isInteger(g.index))
}

/** @param {any} c */
const target = c => ({ host: c.host, port: c.port, username: c.username, password: c.password, privateKey: c.privateKey, privateKeyPath: c.privateKeyPath, passphrase: c.passphrase, hostFingerprint: c.hostFingerprint })

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'nvidia',
  name: 'NVIDIA GPUs',
  version: '0.1.0',
  description: 'Load, VRAM, power, temperature and fan of NVIDIA GPUs from nvidia-smi, run over SSH or inside the container',
  interval: '10s',

  config: {
    type: 'object',
    additionalProperties: false,
    properties: {
      host: { type: 'string', description: 'Machine with the GPUs, reached over SSH; leave out to run nvidia-smi in the dashboard container' },
      port: { type: 'integer', default: 22 },
      username: { type: 'string' },
      password: { type: 'string', description: 'Use ${secret:...}; a key is better' },
      privateKey: { type: 'string', description: 'PEM key, use ${secret:...}' },
      privateKeyPath: { type: 'string', description: 'Key file relative to the config folder, e.g. ssh/gpu_ed25519' },
      passphrase: { type: 'string' },
      hostFingerprint: { type: 'string', description: 'SHA256:... from ssh-keygen -lf; without it the first key seen is pinned' },
      tempAlert: { type: 'number', description: 'Raise an alert while a GPU is at or above this temperature in °C' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['gpu', 'list'], default: 'gpu', description: 'gpu: one GPU as numbers; list: one row per GPU' },
      gpu: { type: 'integer', minimum: 0, default: 0, description: 'Which GPU for view: gpu, as nvidia-smi numbers them' }
    }
  },

  examples: [
    {
      title: 'Two GPUs of a machine reached over SSH',
      config: { host: 'gpu.example', username: 'monitor', privateKeyPath: 'ssh/gpu_ed25519', tempAlert: 88 },
      tiles: [
        { id: 'gpu0', options: { view: 'gpu', gpu: 0 } },
        { id: 'gpu1', options: { view: 'gpu', gpu: 1 } },
        { id: 'all', options: { view: 'list' } }
      ]
    }
  ],

  async fetch (ctx) {
    const res = ctx.config.host
      ? await ctx.ssh.exec(target(ctx.config), QUERY)
      : await ctx.exec('nvidia-smi', READINGS.split(' ').slice(1))
    if (res.code !== 0 && res.code !== null) throw new Error(`nvidia-smi failed (${res.code}): ${(res.stderr || res.stdout).trim().slice(0, 200)}`)
    let stdout = res.stdout
    if (!ctx.config.host) {
      // the limits only color the temperature: without them the readings still show
      const lim = await ctx.exec('nvidia-smi', LIMITS.split(' ').slice(1)).catch(() => null)
      if (lim && (lim.code === 0 || lim.code === null)) stdout += `\n${lim.stdout}`
    }
    const gpus = parse(stdout)
    if (!gpus.length) throw new Error(`nvidia-smi printed no GPU: ${res.stdout.trim().slice(0, 200) || 'empty output'}`)
    return { gpus }
  },

  render (data, o) {
    if (o.view === 'list') {
      return {
        type: 'list',
        dense: true,
        items: data.gpus.map((/** @type {any} */ g) => ({
          key: String(g.index),
          title: `GPU${g.index} ${g.name.replace(/^NVIDIA (GeForce )?/, '')}`,
          subtitle: [
            g.memUsed !== null && g.memTotal !== null ? `${(g.memUsed / 2 ** 30).toFixed(1)} / ${(g.memTotal / 2 ** 30).toFixed(1)} GB` : null,
            g.power !== null ? `${Math.round(g.power)} W` : null,
            g.temp !== null ? `${g.temp}°C` : null,
            g.fan !== null ? `fan ${g.fan}%` : null
          ].filter(Boolean).join(', '),
          value: g.util,
          format: 'percent',
          progress: g.util === null ? undefined : { value: g.util, max: 100 },
          tone: g.temp !== null && g.temp >= g.crit ? 'error' : g.temp !== null && g.temp >= g.warn ? 'warning' : undefined
        }))
      }
    }
    const g = data.gpus.find((/** @type {any} */ x) => x.index === o.gpu)
    if (!g) return { type: 'text', text: `No GPU ${o.gpu} (nvidia-smi shows ${data.gpus.map((/** @type {any} */ x) => x.index).join(', ')})`, tone: 'warning' }
    return {
      type: 'stats',
      items: [
        { label: 'Load', value: g.util, format: 'percent' },
        { label: 'VRAM', value: g.memUsed !== null && g.memTotal ? (g.memUsed / g.memTotal) * 100 : null, format: 'percent', warn: 90, crit: 97, detail: g.memUsed !== null && g.memTotal ? `${(g.memUsed / 2 ** 30).toFixed(1)} / ${(g.memTotal / 2 ** 30).toFixed(1)} GB` : null },
        { label: 'Power', value: g.power, format: 'number', unit: 'W' },
        { label: 'Temp', value: g.temp, format: 'temperature', warn: g.warn, crit: g.crit }
      ]
    }
  },

  status (data, key) {
    const g = data.gpus.find((/** @type {any} */ x) => String(x.index) === String(key))
    if (!g) return { state: 'unknown', label: 'no such GPU' }
    return { state: 'up', label: `${g.util ?? '?'}%, ${g.temp ?? '?'}°C` }
  },

  alerts (data, ctx) {
    const limit = ctx.config.tempAlert
    if (typeof limit !== 'number') return []
    return data.gpus.filter((/** @type {any} */ g) => g.temp !== null && g.temp >= limit).map((/** @type {any} */ g) => ({
      id: `temp:${g.index}`,
      severity: g.temp >= limit + 5 ? 'error' : 'warning',
      title: `GPU${g.index} at ${g.temp}°C`,
      message: `${g.name}, alert from ${limit}°C`
    }))
  }
}
