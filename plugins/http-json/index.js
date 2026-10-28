import jsonata from 'jsonata'

const request = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri' },
    method: { enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    headers: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
    query: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } },
    json: { description: 'JSON body (switches method to POST unless set)' },
    form: { type: 'object', additionalProperties: { type: 'string' } },
    auth: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bearer: { type: 'string' },
        basic: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' } } },
        header: { type: 'string', description: 'Header name for an API key, e.g. X-Api-Key' },
        value: { type: 'string' }
      }
    },
    insecure: { type: 'boolean', description: 'Accept a self-signed certificate' },
    response: { type: 'boolean', description: 'Keep { status, headers, body } instead of only the body (to read a header)' },
    parse: { enum: ['auto', 'json', 'text'] }
  }
}

const expr = { type: 'string', description: 'JSONata expression evaluated against the data' }
const format = { enum: ['number', 'percent', 'bytes', 'bits', 'bitrate', 'byterate', 'duration', 'relativeTime', 'since', 'date', 'datetime', 'temperature', 'text'] }

/** @type {Map<string, import('jsonata').Expression>} */
const compiled = new Map()

/**
 * @param {string} source
 * @param {unknown} data
 * @param {Record<string, unknown>} [bindings]
 */
async function evaluate (source, data, bindings) {
  let e = compiled.get(source)
  if (!e) {
    try {
      e = jsonata(source)
    } catch (err) {
      throw new Error(`JSONata "${source}": ${/** @type {Error} */ (err).message}`, { cause: err })
    }
    compiled.set(source, e)
  }
  try {
    const v = await e.evaluate(data, bindings)
    return Array.isArray(v) && /** @type {any} */ (v).sequence ? [...v] : v
  } catch (err) {
    throw new Error(`JSONata "${source}": ${/** @type {Error} */ (err).message}`, { cause: err })
  }
}

/** @param {string | undefined} e @param {unknown} data */
const optional = async (e, data) => e ? await evaluate(e, data) : undefined

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'http-json',
  name: 'HTTP JSON',
  version: '1.0.0',
  description: 'Any JSON (or text) API: one or several requests, any auth, JSONata to pick, merge and format fields. Replaces homepage customapi.',
  interval: '30s',

  config: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...request.properties,
      url: { type: 'string', format: 'uri', description: 'Single request. Its decoded body is the data.' },
      requests: {
        type: 'object',
        description: 'Several named requests, fetched in parallel. The data is { <name>: body }.',
        additionalProperties: request
      },
      transform: { ...expr, description: 'JSONata applied to the raw data once per fetch; tiles see its result' },
      alerts: { ...expr, description: 'JSONata returning [{ id, message, severity?, title?, href? }]' }
    },
    oneOf: [{ required: ['url'] }, { required: ['requests'] }]
  },

  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        description: 'Stats: one value per item',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value'],
          properties: {
            label: { type: 'string' },
            value: expr,
            format,
            unit: { type: 'string' },
            warn: { type: 'number' },
            crit: { type: 'number' },
            invert: { type: 'boolean' },
            href: { type: 'string' }
          }
        }
      },
      list: {
        type: 'object',
        description: 'List: one row per element of `items`; the other expressions run against each element',
        additionalProperties: false,
        required: ['items', 'title'],
        properties: {
          items: expr,
          title: expr,
          subtitle: expr,
          value: expr,
          format,
          href: expr,
          badge: expr,
          tone: expr,
          limit: { type: 'integer', minimum: 1 },
          empty: { type: 'string', description: 'Text when the list is empty' }
        }
      },
      progress: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value'],
          properties: {
            label: { type: 'string' },
            value: expr,
            max: { type: ['string', 'number'], description: 'Number or JSONata expression' },
            format,
            detail: expr,
            warn: { type: 'number' },
            crit: { type: 'number' }
          }
        }
      },
      text: { ...expr, description: 'Text: a JSONata expression that returns a string' },
      mono: { type: 'boolean' }
    }
  },

  examples: [
    {
      title: 'Two APIs merged into one source (missing movies + episodes)',
      config: {
        requests: {
          movies: { url: 'http://media.example/radarr/api/v3/wanted/missing', query: { pageSize: 1 }, auth: { header: 'X-Api-Key', value: '${secret:RADARR_KEY}' } },
          episodes: { url: 'http://media.example/sonarr/api/v3/wanted/missing', query: { pageSize: 1 }, auth: { header: 'X-Api-Key', value: '${secret:SONARR_KEY}' } }
        }
      },
      tiles: [
        { id: 'movies', options: { items: [{ label: 'Movies', value: 'movies.totalRecords', format: 'number' }] } },
        { id: 'both', options: { items: [{ label: 'Movies', value: 'movies.totalRecords' }, { label: 'Episodes', value: 'episodes.totalRecords' }] } }
      ]
    },
    {
      title: 'Quota from a response header',
      config: {
        url: 'http://vpn.example/sub',
        response: true,
        transform: '( $kv := $split(headers."subscription-userinfo", "; ") ~> $map(function($p){ $split($p, "=") }); { "used": $number($kv[0][1]) + $number($kv[1][1]), "total": $number($kv[2][1]) } )'
      },
      options: { progress: [{ label: 'Quota', value: 'used', max: 'total', format: 'bytes' }] }
    },
    {
      title: 'Download queue as a list, alert when paused',
      config: {
        url: 'http://dl.example/api/queue',
        alerts: 'paused ? [{ "id": "paused", "message": "Queue is paused" }] : []'
      },
      tiles: [
        { id: 'queue', options: { list: { items: 'slots', title: 'name', subtitle: 'status', value: 'percentage', format: 'percent', badge: 'status', empty: 'Queue is empty' } } },
        { id: 'speed', options: { text: '"Speed: " & $string($round(speed / 1048576, 1)) & " MB/s"' } }
      ]
    }
  ],

  async fetch (ctx) {
    const c = ctx.config
    /** @param {any} r */
    const one = async (r) => {
      const res = await ctx.http.request(r.url, { method: r.method, headers: r.headers, query: r.query, json: r.json, form: r.form, auth: r.auth, insecure: r.insecure, parse: r.parse })
      return r.response ? { status: res.status, headers: res.headers, body: res.body } : res.body
    }
    let data
    if (c.requests) {
      const names = Object.keys(c.requests)
      const bodies = await Promise.all(names.map(n => one(c.requests[n]).catch(err => { throw new Error(`request "${n}": ${err.message}`) })))
      data = Object.fromEntries(names.map((n, i) => [n, bodies[i]]))
    } else {
      data = await one(c)
    }
    return c.transform ? await evaluate(c.transform, data) : data
  },

  async render (data, o) {
    if (o.items) {
      const items = []
      for (const it of o.items) {
        const value = await evaluate(it.value, data)
        items.push({ label: it.label, value: value === undefined ? null : value, format: it.format, unit: it.unit, warn: it.warn, crit: it.crit, invert: it.invert, href: it.href })
      }
      return { type: 'stats', items }
    }
    if (o.list) {
      const l = o.list
      const rows = await evaluate(l.items, data)
      const list = rows === undefined || rows === null ? [] : Array.isArray(rows) ? rows : [rows]
      const items = []
      for (const row of list.slice(0, l.limit ?? 50)) {
        const badge = await optional(l.badge, row)
        items.push({
          title: String(await evaluate(l.title, row) ?? ''),
          subtitle: /** @type {string | undefined} */ (await optional(l.subtitle, row)),
          value: /** @type {any} */ (await optional(l.value, row)),
          format: l.format,
          href: /** @type {string | undefined} */ (await optional(l.href, row)),
          badge: badge === undefined || badge === null ? undefined : { text: String(badge), tone: /** @type {any} */ (await optional(l.tone, row)) }
        })
      }
      return { type: 'list', items, empty: l.empty }
    }
    if (o.progress) {
      const items = []
      for (const p of o.progress) {
        const max = typeof p.max === 'string' ? Number(await evaluate(p.max, data)) : p.max
        items.push({ label: p.label, value: Number(await evaluate(p.value, data)), max, format: p.format, detail: /** @type {any} */ (await optional(p.detail, data)), warn: p.warn, crit: p.crit })
      }
      return { type: 'progress', items }
    }
    if (o.text) {
      const v = await evaluate(o.text, data)
      return { type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2), mono: o.mono }
    }
    return { type: 'text', text: JSON.stringify(data, null, 2).slice(0, 2000), mono: true }
  },

  async alerts (data, ctx) {
    if (!ctx.config.alerts) return []
    const v = await evaluate(ctx.config.alerts, data)
    if (v === undefined || v === null) return []
    return (Array.isArray(v) ? v : [v]).map(a => ({ ...a, id: String(a.id ?? a.message) }))
  }
}
