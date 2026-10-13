// The NIS server keeps the connection open for more commands; a zero-length record ends each reply.
const END = '\x00\x00'
const SECONDS = /** @type {Record<string, number>} */ ({ seconds: 1, minutes: 60, hours: 3600 })

/** @param {string} command */
function frame (command) {
  const body = Buffer.from(command, 'ascii')
  const out = Buffer.alloc(2 + body.length)
  out.writeUInt16BE(body.length, 0)
  body.copy(out, 2)
  return out
}

/**
 * Walks the NIS framing: each record is a 2-byte big-endian length then that many bytes, up to a zero-length record.
 * @param {Buffer} buf
 * @returns {string[]}
 */
function records (buf) {
  if (!buf.length) throw new Error('apcupsd closed the connection without replying')
  /** @type {string[]} */
  const out = []
  let at = 0
  while (at + 2 <= buf.length) {
    const len = buf.readUInt16BE(at)
    at += 2
    if (len === 0) return out
    if (at + len > buf.length) throw new Error(`truncated or invalid apcupsd reply: a ${len}-byte record at byte ${at - 2} runs past the ${buf.length} bytes received`)
    out.push(buf.toString('latin1', at, at + len))
    at += len
  }
  throw new Error(`truncated apcupsd reply: ${buf.length} bytes without the end-of-status record`)
}

/** @param {string | undefined} v "230.0 Volts", "N/A" */
function num (v) {
  const m = /^-?\d+(?:\.\d+)?/.exec(v ?? '')
  return m ? Number(m[0]) : null
}

/** @param {string | undefined} v "30.8 Minutes" */
function seconds (v) {
  const m = /^(-?\d+(?:\.\d+)?)\s+(\w+)/.exec(v ?? '')
  const unit = m ? SECONDS[m[2].toLowerCase()] : undefined
  return m && unit ? Math.round(Number(m[1]) * unit) : null
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'apcupsd',
  name: 'apcupsd',
  version: '1.0.0',
  description: 'UPS status, load, battery and runtime from the apcupsd network information server (port 3551); alerts on battery power',
  interval: '15s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['host'],
    properties: {
      host: { type: 'string', minLength: 1, description: 'Host running apcupsd with NETSERVER on, e.g. nas.example' },
      port: { type: 'integer', minimum: 1, maximum: 65535, default: 3551, description: 'NISPORT in apcupsd.conf' },
      batteryAlertPercent: { type: 'number', minimum: 0, maximum: 100, default: 50, description: 'Warn when the battery charge drops below this; 0 turns it off' }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['summary', 'power', 'details'], default: 'summary' }
    }
  },

  examples: [
    {
      title: 'One UPS',
      config: { host: 'ups.example', batteryAlertPercent: 50 },
      tiles: [
        { id: 'summary', options: { view: 'summary' } },
        { id: 'power', options: { view: 'power' } },
        { id: 'details', options: { view: 'details' } }
      ]
    }
  ],

  async fetch (ctx) {
    const reply = await ctx.tcp.request(ctx.config.host, ctx.config.port, frame('status'), { until: END })
    const lines = records(reply)
    const list = lines.flatMap(line => {
      const i = line.indexOf(':')
      return i > 0 ? [{ key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() }] : []
    })
    const get = (/** @type {string} */ key) => list.find(r => r.key === key)?.value
    const status = get('STATUS')
    if (status === undefined) throw new Error(`apcupsd sent no STATUS record${lines.length ? ` (got "${lines[0].trim().slice(0, 80)}")` : ''}`)
    const load = num(get('LOADPCT'))
    const nominal = num(get('NOMPOWER'))
    return {
      name: get('UPSNAME') ?? null,
      model: get('MODEL') ?? null,
      status,
      load,
      battery: num(get('BCHARGE')),
      timeLeft: seconds(get('TIMELEFT')),
      lineVoltage: num(get('LINEV')),
      batteryVoltage: num(get('BATTV')),
      loadWatts: load !== null && nominal !== null ? load * nominal / 100 : null,
      records: list
    }
  },

  render (data, o) {
    switch (o.view) {
      case 'power':
        return {
          type: 'stats',
          items: [
            { label: 'Load', value: data.loadWatts, format: 'number', unit: 'W' },
            { label: 'Line', value: data.lineVoltage, format: 'number', unit: 'V' },
            { label: 'Battery', value: data.batteryVoltage, format: 'number', unit: 'V' },
            { label: 'Model', value: data.model, format: 'text' }
          ]
        }
      case 'details':
        return {
          type: 'list',
          empty: 'No records',
          items: data.records.map((/** @type {{ key: string, value: string }} */ r) => ({ key: r.key, title: r.key, subtitle: r.value }))
        }
      default:
        return {
          type: 'stats',
          items: [
            { label: 'Status', value: data.status.toLowerCase(), format: 'text' },
            { label: 'Load', value: data.load, format: 'percent' },
            { label: 'Battery', value: data.battery, format: 'percent', warn: 50, crit: 25, invert: true },
            { label: 'Time left', value: data.timeLeft, format: 'duration' }
          ]
        }
    }
  },

  alerts (data, ctx) {
    const ups = data.name || 'UPS'
    const out = []
    // STATUS is a set of flags ("TRIM ONLINE", "ONLINE REPLACEBATT"); CAL, TRIM and BOOST are normal regulation.
    const flags = new Set(String(data.status).split(/\s+/).filter(Boolean))
    if (flags.has('ONBATT')) {
      const left = data.timeLeft === null ? '?' : Math.round(data.timeLeft / 60)
      out.push({ id: 'onbatt', severity: 'error', title: `${ups} is on battery`, message: `Battery ${data.battery ?? '?'}%, about ${left} min left` })
    } else if (!flags.has('ONLINE')) {
      out.push({ id: `status:${data.status}`, severity: 'warning', title: `${ups} status is ${data.status}`, message: 'apcupsd reports the UPS is not online' })
    }
    for (const [flag, severity, what] of /** @type {const} */ ([
      ['COMMLOST', 'error', 'apcupsd lost contact with the UPS'],
      ['OVERLOAD', 'error', 'the load is above what the UPS can carry'],
      ['LOWBATT', 'error', 'the UPS reports a low battery'],
      ['REPLACEBATT', 'warning', 'the UPS asks for a battery replacement']
    ])) {
      if (flags.has(flag)) out.push({ id: `flag:${flag}`, severity, title: `${ups}: ${flag.toLowerCase()}`, message: what })
    }
    if (data.battery !== null && data.battery < ctx.config.batteryAlertPercent) {
      out.push({ id: 'battery-low', severity: 'warning', title: `${ups} battery at ${data.battery}%`, message: `Below ${ctx.config.batteryAlertPercent}%` })
    }
    return out
  }
}
