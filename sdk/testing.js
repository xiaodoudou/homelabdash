import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PluginHost } from '../src/plugins/host.js'
import { createAjv, formatAjvErrors, formatPath } from '../src/config/ajv.js'

/**
 * Runs a plugin the way the dashboard does (worker thread, schema defaults, fixtures) and returns
 * everything it produced. Used by plugin tests and by `homelabdash plugin run`.
 *
 * @param {string} dir plugin folder (in a test: import.meta.dirname)
 * @param {import('./testing.js').RunOptions} [o]
 * @returns {Promise<import('./testing.js').RunResult>}
 */
export async function runPlugin (dir, o = {}) {
  const file = ['index.js', 'index.mjs'].map(f => path.join(dir, f)).find(f => fs.existsSync(f))
  if (!file) throw new Error(`no index.js in ${dir}`)
  const id = path.basename(dir)
  const dataDir = o.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'homelabdash-test-'))
  const host = new PluginHost({ id, file, dir, dataDir, configDir: o.configDir ?? dir, fixtures: o.fixtures ?? true, capture: o.capture })
  /** @type {{ level: string, msg: string }[]} */
  const logs = []
  host.on('log', (level, _src, msg) => logs.push({ level, msg }))
  let state = o.state ?? {}
  host.on('state', (_src, s) => { state = s })
  const started = performance.now()
  try {
    const meta = await host.start()
    const ajv = createAjv()
    const config = structuredClone(o.config ?? {})
    check(ajv, meta.config, config, ['config'])
    const tiles = (o.tiles ?? [{ id: 'tile', options: o.options ?? {} }]).map(t => {
      const options = structuredClone(t.options ?? {})
      check(ajv, meta.options, options, ['tiles', t.id, 'options'])
      return { id: t.id, options }
    })
    const statusKeys = o.statusKeys ?? []
    const sourceId = o.sourceId ?? 'test'
    const timeout = o.timeout ?? meta.timeout ?? 10_000
    await host.configure(sourceId, { config, tiles, statusKeys, state })

    /** @type {any} */
    let result = null
    if (o.job) result = (await host.call('job', { sourceId, name: o.job, timeout }, timeout + 5000)).result
    if (o.action) result = (await host.call('action', { sourceId, name: o.action, input: o.input ?? {}, timeout }, timeout + 5000)).result

    /** @type {any[]} */
    const updates = []
    let out
    if (o.stream) {
      if (!meta.hasStream) throw new Error(`plugin "${id}" has no stream()`)
      if (meta.hasFetch) await host.call('fetch', { sourceId, timeout }, timeout + 5000)
      const max = o.stream === true ? Infinity : (o.stream.updates ?? Infinity)
      const wait = o.stream === true ? 5000 : (o.stream.timeout ?? 5000)
      out = await /** @type {Promise<any>} */ (new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(), wait)
        /** @param {string} [err] */
        const finish = (err) => {
          clearTimeout(timer)
          if (err) reject(new Error(err))
          else resolve(updates.at(-1) ?? null)
        }
        host.on('update', (_src, msg) => {
          updates.push({ data: msg.data, derived: msg.derived })
          if (updates.length >= max) finish()
        })
        host.on('stream-end', (_src, info) => setTimeout(() => finish(info.error), 400))
        host.startStream(sourceId).catch(err => finish(err.message))
      }))
      if (!out) out = await host.call('derive', { sourceId }, 10_000)
    } else if (meta.hasFetch) {
      out = await host.call('fetch', { sourceId, timeout }, timeout + 5000)
    } else {
      out = await host.call('derive', { sourceId }, 10_000)
    }
    await new Promise(r => setTimeout(r, 80))
    return {
      meta,
      data: out.data,
      views: out.derived.views,
      view: out.derived.views[tiles[0]?.id]?.view ?? null,
      alerts: out.derived.alerts ?? [],
      alertsError: out.derived.alertsError,
      statuses: out.derived.statuses,
      state,
      result,
      updates,
      logs,
      captured: out.captured,
      durationMs: Math.round(performance.now() - started)
    }
  } finally {
    await host.stop()
    if (!o.dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

/**
 * @param {import('ajv').default} ajv @param {object} schema @param {unknown} data @param {(string|number)[]} prefix
 */
function check (ajv, schema, data, prefix) {
  const validate = ajv.compile(schema)
  if (validate(data)) return
  const msg = formatAjvErrors(validate.errors ?? [], prefix).map(e => `${formatPath(e.path)}: ${e.message}`).join('\n  ')
  throw new Error(`invalid ${prefix[0]}:\n  ${msg}`)
}
