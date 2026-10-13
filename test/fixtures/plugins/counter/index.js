// Test plugin: counts fetches, can fail or hang on demand, has a job, a stream, an action and alerts.
let fetches = 0

/** @type {import('homelabdash/sdk').Plugin} */
export default {
  id: 'counter',
  version: '1.0.0',
  description: 'test plugin',
  interval: '1s',
  config: {
    type: 'object',
    additionalProperties: false,
    properties: {
      fail: { type: 'boolean' },
      hang: { type: 'boolean' },
      tag: { type: 'string' },
      password: { type: 'string' }
    }
  },
  options: { type: 'object', additionalProperties: false, properties: { label: { type: 'string', default: 'n' } } },

  async fetch (ctx) {
    if (ctx.config.fail) throw new Error(`boom with ${ctx.config.password ?? 'nothing'}`)
    if (ctx.config.hang) await new Promise(() => {})
    fetches++
    return { n: fetches, job: ctx.state.get('job', 0) }
  },

  render (d, o) {
    return { type: 'stats', items: [{ label: o.label, value: d.n }, { label: 'job', value: d.job ?? 0 }, { label: 'streamed', value: d.streamed ?? null }] }
  },

  status (d, key) {
    return key === 'up' ? 'up' : { state: 'down', label: `key ${key}` }
  },

  alerts (d) {
    return d.n % 2 ? [{ id: `odd-${d.n}`, message: `n is odd (${d.n})` }] : []
  },

  jobs: {
    tick: {
      schedule: '1h',
      run (ctx) { ctx.state.set('job', ctx.state.get('job', 0) + 1) }
    }
  },

  async stream (ctx, emit) {
    for (let i = 1; i <= 3 && !ctx.signal.aborted; i++) {
      await new Promise(r => setTimeout(r, 30))
      emit(prev => ({ ...(prev ?? {}), streamed: i }))
    }
    await new Promise(resolve => ctx.signal.addEventListener('abort', resolve, { once: true }))
  },

  actions: {
    echo: { run: (_ctx, input) => ({ got: input }) }
  }
}
