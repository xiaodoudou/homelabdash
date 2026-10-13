/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: '__ID__',
  name: '__NAME__',
  version: '0.1.0',
  description: 'TODO: one line on what this shows',
  interval: '30s',

  // Source config: where and how to connect. Secrets come in as ${secret:NAME} from the YAML.
  config: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: { type: 'string', format: 'uri', description: 'Base URL of the service' },
      apiKey: { type: 'string', description: 'Use ${secret:...}' }
    }
  },

  // Tile options: what one tile shows. Every enum value needs an example below.
  options: {
    type: 'object',
    additionalProperties: false,
    properties: {
      view: { enum: ['summary', 'list'], default: 'summary' }
    }
  },

  // Run by the contract test against fixtures/, and printed by `homelabdash plugin info`.
  examples: [
    {
      title: 'Summary and list',
      config: { url: 'http://service.example', apiKey: 'test-key' },
      tiles: [
        { id: 'summary', options: { view: 'summary' } },
        { id: 'list', options: { view: 'list' } }
      ]
    }
  ],

  async fetch (ctx) {
    const items = await ctx.http.json(`${ctx.config.url.replace(/\/+$/, '')}/api/items`, {
      auth: { header: 'X-Api-Key', value: ctx.config.apiKey }
    })
    return { items }
  },

  render (data, o) {
    if (o.view === 'list') {
      return {
        type: 'list',
        empty: 'Nothing here',
        items: data.items.map((/** @type {any} */ it) => ({ title: it.name, subtitle: it.status, badge: { text: it.status, tone: it.status === 'ok' ? 'ok' : 'warning' } }))
      }
    }
    return {
      type: 'stats',
      items: [
        { label: 'Items', value: data.items.length, format: 'number' },
        { label: 'Problems', value: data.items.filter((/** @type {any} */ it) => it.status !== 'ok').length, format: 'number', warn: 1 }
      ]
    }
  },

  // Optional: alerts(data, ctx), status(data, key, ctx), actions: {}, jobs: {}, stream(ctx, emit).
  alerts (data) {
    return data.items
      .filter((/** @type {any} */ it) => it.status !== 'ok')
      .map((/** @type {any} */ it) => ({ id: `item:${it.name}`, severity: 'warning', title: `${it.name} is ${it.status}` }))
  }
}
