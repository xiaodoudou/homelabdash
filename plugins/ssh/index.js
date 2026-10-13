const format = { enum: ['number', 'percent', 'bytes', 'duration', 'temperature', 'text'] }

/** @param {any} c */
function target (c) {
  return { host: c.host, port: c.port, username: c.username, password: c.password, privateKey: c.privateKey, privateKeyPath: c.privateKeyPath, passphrase: c.passphrase, hostFingerprint: c.hostFingerprint }
}

/** @param {string} stdout @param {string} how */
function parse (stdout, how) {
  const text = stdout.trim()
  switch (how) {
    case 'number': {
      const m = /-?\d+(?:\.\d+)?/.exec(text)
      return m ? Number(m[0]) : null
    }
    case 'json': return JSON.parse(text)
    case 'lines': return text ? text.split('\n') : []
    case 'kv': return Object.fromEntries(text.split('\n').map(l => /^\s*([^=:]+?)\s*[=:]\s*(.*)$/.exec(l)).filter(Boolean).map(m => [/** @type {any} */ (m)[1], /** @type {any} */ (m)[2]]))
    default: return text
  }
}

/** @param {any} v @param {string | undefined} field */
function pick (v, field) {
  if (!field) return v
  return field.split('.').reduce((acc, k) => acc == null ? acc : acc[k], v)
}

/** @param {string} line @param {boolean} highlight */
function toneOf (line, highlight) {
  if (!highlight) return undefined
  if (/\b(error|fail(ed|ure)?|crit(ical)?|panic|denied)\b/i.test(line)) return 'error'
  if (/\bwarn(ing)?\b/i.test(line)) return 'warning'
  return undefined
}

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'ssh',
  name: 'SSH',
  version: '1.0.0',
  description: 'Run commands on a host over SSH (numbers, text, key=value, JSON) and follow a log file live',
  interval: '1m',
  timeout: '20s',

  config: {
    type: 'object',
    additionalProperties: false,
    required: ['host', 'username'],
    properties: {
      host: { type: 'string' },
      port: { type: 'integer', default: 22 },
      username: { type: 'string' },
      password: { type: 'string', description: 'Prefer a key; use ${secret:...}' },
      privateKey: { type: 'string', description: 'PEM key, use ${secret:...}' },
      privateKeyPath: { type: 'string', description: 'Key file relative to the config folder, e.g. ssh/id_ed25519' },
      passphrase: { type: 'string' },
      hostFingerprint: { type: 'string', description: 'SHA256:... from ssh-keygen -lf; without it the first key seen is pinned' },
      commands: {
        type: 'object',
        description: 'Commands run on every fetch, in parallel',
        additionalProperties: {
          type: 'object',
          additionalProperties: false,
          required: ['run'],
          properties: {
            run: { type: 'string' },
            parse: { enum: ['text', 'number', 'lines', 'kv', 'json'], default: 'text' },
            timeout: { type: 'integer', minimum: 100, description: 'Milliseconds' },
            alert: {
              type: 'object',
              additionalProperties: false,
              description: 'Raise an alert when the (numeric) value crosses a threshold or the output matches',
              properties: {
                above: { type: 'number' },
                below: { type: 'number' },
                match: { type: 'string', description: 'Regular expression tested on the output' },
                failed: { type: 'boolean', description: 'Alert when the command exits non-zero' },
                severity: { enum: ['info', 'warning', 'error'], default: 'warning' },
                message: { type: 'string' }
              }
            }
          }
        }
      },
      follow: {
        type: 'object',
        additionalProperties: false,
        required: ['command'],
        description: 'Long-running command whose output is streamed live, e.g. tail -n 50 -F /var/log/syslog',
        properties: {
          command: { type: 'string' },
          lines: { type: 'integer', minimum: 10, maximum: 2000, default: 200, description: 'Lines kept in memory' }
        }
      }
    }
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['auto', 'stats', 'text', 'log'], default: 'auto' },
      command: { type: 'string', description: 'Command shown by the text view (default: the first one)' },
      items: {
        type: 'array',
        description: 'Stats view: one value per item',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['command', 'label'],
          properties: {
            command: { type: 'string' },
            field: { type: 'string', description: 'Dot path inside a kv / json result' },
            label: { type: 'string' },
            format,
            unit: { type: 'string' },
            warn: { type: 'number' },
            crit: { type: 'number' }
          }
        }
      },
      filter: { type: 'string', description: 'Log view: only lines matching this regular expression' },
      lines: { type: 'integer', minimum: 1, default: 50, description: 'Log view: lines shown' },
      highlight: { type: 'boolean', default: true, description: 'Log view: colour error / warning lines' }
    }
  },

  examples: [
    {
      title: 'Router health over SSH, with its log followed live',
      config: {
        host: 'router.example',
        username: 'monitor',
        privateKeyPath: 'ssh/id_ed25519',
        commands: {
          conntrack: { run: 'cat /proc/sys/net/netfilter/nf_conntrack_count', parse: 'number', alert: { above: 50000, message: 'Connection table almost full' } },
          load: { run: 'cut -d" " -f1-3 /proc/loadavg', parse: 'text' },
          mem: { run: "awk '/MemTotal|MemAvailable/ {print $1 $2*1024}' /proc/meminfo", parse: 'kv' }
        },
        follow: { command: 'logread -f' }
      },
      tiles: [
        { id: 'stats', options: { view: 'stats', items: [{ command: 'conntrack', label: 'Conns', format: 'number', warn: 40000 }, { command: 'mem', field: 'MemAvailable', label: 'Free RAM', format: 'bytes' }] } },
        { id: 'load', options: { view: 'text', command: 'load' } },
        { id: 'log', options: { view: 'log', lines: 20 } },
        { id: 'errors', options: { view: 'log', filter: 'err|warn' } },
        { id: 'auto', options: { view: 'auto' } }
      ]
    }
  ],

  async fetch (ctx) {
    const t = target(ctx.config)
    const entries = await Promise.all(Object.entries(ctx.config.commands ?? {}).map(async ([name, cmd]) => {
      try {
        const r = await ctx.ssh.exec(t, cmd.run, { timeout: cmd.timeout ?? 15_000 })
        const ok = r.code === 0
        return [name, { ok, code: r.code, value: ok ? parse(r.stdout, cmd.parse) : null, output: (ok ? r.stdout : r.stderr || r.stdout).trim().slice(0, 4000) }]
      } catch (err) {
        return [name, { ok: false, code: null, value: null, output: /** @type {Error} */ (err).message }]
      }
    }))
    /** @type {Record<string, { ok: boolean, code: number | null, value: any, output: string }>} */
    const commands = Object.fromEntries(entries)
    const results = Object.values(commands)
    if (results.length && results.every(r => !r.ok && r.code === null)) throw new Error(results[0].output)
    return { ...(ctx.data ?? {}), commands }
  },

  async stream (ctx, emit) {
    const follow = ctx.config.follow
    if (!follow) {
      await new Promise(resolve => ctx.signal.addEventListener('abort', resolve, { once: true }))
      return
    }
    /** @type {{ time: number, text: string }[]} */
    const buffer = []
    for await (const text of ctx.ssh.lines(target(ctx.config), follow.command)) {
      buffer.push({ time: Date.now(), text })
      if (buffer.length > follow.lines) buffer.splice(0, buffer.length - follow.lines)
      emit((/** @type {any} */ prev) => ({ ...(prev ?? {}), log: buffer.slice() }))
    }
  },

  render (data, o, ctx) {
    const commands = data?.commands ?? {}
    let view = o.view
    if (view === 'auto') view = ctx.config.follow ? 'log' : o.items?.length ? 'stats' : 'text'
    if (view === 'log') {
      const re = o.filter ? new RegExp(o.filter, 'i') : null
      const lines = (data?.log ?? []).filter((/** @type {any} */ l) => !re || re.test(l.text)).slice(-o.lines)
      return { type: 'log', follow: true, lines: lines.map((/** @type {any} */ l) => ({ time: l.time, text: l.text, tone: toneOf(l.text, o.highlight) })) }
    }
    if (view === 'stats') {
      return {
        type: 'stats',
        items: (o.items ?? []).map((/** @type {any} */ it) => {
          const raw = pick(commands[it.command]?.value, it.field)
          const value = raw === undefined || raw === null ? null : it.format && it.format !== 'text' && typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw)) ? Number(raw) : raw
          return { label: it.label, value: typeof value === 'object' && value !== null ? JSON.stringify(value) : value, format: it.format, unit: it.unit, warn: it.warn, crit: it.crit }
        })
      }
    }
    const name = o.command ?? Object.keys(commands)[0]
    const r = commands[name]
    if (!r) return { type: 'text', text: name ? `No result for "${name}" yet` : 'No commands configured', tone: 'neutral' }
    return { type: 'text', text: r.output, mono: true, tone: r.ok ? undefined : 'error' }
  },

  alerts (data, ctx) {
    const out = []
    for (const [name, cmd] of Object.entries(ctx.config.commands ?? {})) {
      const a = /** @type {any} */ (cmd).alert
      const r = data?.commands?.[name]
      if (!a || !r) continue
      const v = typeof r.value === 'number' ? r.value : null
      const hit = (a.failed && !r.ok) ||
        (v !== null && a.above !== undefined && v > a.above) ||
        (v !== null && a.below !== undefined && v < a.below) ||
        (a.match && new RegExp(a.match, 'i').test(r.output))
      if (hit) out.push({ id: `cmd:${name}`, severity: a.severity, title: a.message ?? `${name} on ${ctx.config.host}`, message: r.output.slice(0, 200) })
    }
    return out
  }
}
