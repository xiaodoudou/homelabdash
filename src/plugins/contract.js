import fs from 'node:fs'
import path from 'node:path'
import { createStrictAjv } from '../config/ajv.js'
import { runPlugin } from '../../sdk/testing.js'

/**
 * Checks every plugin the same way, whether or not its author wrote tests:
 * files present, schemas valid (strict, so typos in keywords fail), each example renders
 * from fixtures without errors, every enum display mode is exercised, jobs and stream run.
 * @param {string} dir
 * @param {{ requireTests?: boolean }} [o]
 * @returns {Promise<{ id: string, problems: string[], checked: string[] }>}
 */
export async function contractCheck (dir, o = {}) {
  const id = path.basename(dir)
  /** @type {string[]} */
  const problems = []
  /** @type {string[]} */
  const checked = []
  const has = (/** @type {string} */ f) => fs.existsSync(path.join(dir, f))

  if (!has('index.js') && !has('index.mjs')) return { id, problems: ['index.js is missing'], checked }
  if (!has('README.md')) problems.push('README.md is missing (what it shows, config, options, an example)')
  const fixtureFiles = has('fixtures') ? fs.readdirSync(path.join(dir, 'fixtures')).filter(f => f.endsWith('.json')) : []
  if (!fixtureFiles.length) problems.push('fixtures/*.json is missing: record the upstream responses the examples need')
  for (const f of fixtureFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures', f), 'utf8'))
      for (const [key, entry] of Object.entries(data)) {
        const responses = Array.isArray(entry) ? entry : [entry]
        if (/^(GET|POST|PUT|PATCH|DELETE|HEAD) /.test(key) && responses.some(r => typeof r !== 'object' || r === null || !('body' in r || 'status' in r))) {
          problems.push(`fixtures/${f}: "${key}" must be { "status"?, "headers"?, "body" } or a list of them (answered in order)`)
        }
      }
    } catch (err) {
      problems.push(`fixtures/${f}: ${/** @type {Error} */ (err).message}`)
    }
  }
  if (o.requireTests !== false && !fs.readdirSync(dir).some(f => f.endsWith('.test.js'))) problems.push('no *.test.js next to the plugin')

  /** @type {any} */
  let meta
  try {
    meta = await loadMeta(dir)
  } catch (err) {
    problems.push(`does not load: ${/** @type {Error} */ (err).message}`)
    return { id, problems, checked }
  }
  if (meta.id && meta.id !== id) problems.push(`id "${meta.id}" does not match the folder name "${id}"`)
  if (!/^\d+\.\d+\.\d+/.test(meta.version)) problems.push(`version "${meta.version}" is not semver`)
  if (!meta.description) problems.push('description is empty')

  const strict = createStrictAjv()
  for (const key of ['config', 'options']) {
    try {
      strict.compile(meta[key])
    } catch (err) {
      problems.push(`${key} schema: ${/** @type {Error} */ (err).message}`)
    }
  }

  const examples = meta.examples ?? []
  if (!examples.length) problems.push('no examples: add `examples: [{ title, config, options | tiles }]` (they are also the docs)')

  for (const [i, ex] of examples.entries()) {
    const name = `example ${i + 1} "${ex.title ?? ''}"`
    try {
      const r = await runPlugin(dir, { config: ex.config ?? {}, options: ex.options, tiles: ex.tiles?.map((/** @type {any} */ t, /** @type {number} */ j) => ({ id: t.id ?? `t${j + 1}`, options: t.options ?? {} })), statusKeys: ex.statusKeys, fixtures: true })
      for (const [tileId, v] of Object.entries(r.views)) {
        if (v.error) problems.push(`${name}, tile ${tileId}: ${v.error}`)
        else if (v.view === null) problems.push(`${name}, tile ${tileId}: render() returned null`)
      }
      if (r.alertsError) problems.push(`${name}: alerts(): ${r.alertsError}`)
      for (const [tileId, s] of Object.entries(r.statuses ?? {})) {
        if (/** @type {any} */ (s).label && /** @type {any} */ (s).state === 'unknown' && /error|failed|not a function/i.test(/** @type {any} */ (s).label)) problems.push(`${name}, status ${tileId}: ${/** @type {any} */ (s).label}`)
      }
      checked.push(name)
    } catch (err) {
      problems.push(`${name}: ${/** @type {Error} */ (err).message}`)
    }
  }

  // Every value of an enum option (metric, view...) should be rendered by some example.
  const props = meta.options?.properties ?? {}
  for (const [key, schema] of Object.entries(props)) {
    const values = /** @type {any} */ (schema).enum
    if (!Array.isArray(values)) continue
    const used = new Set([/** @type {any} */ (schema).default])
    for (const ex of examples) {
      for (const t of ex.tiles ?? [{ options: ex.options ?? {} }]) used.add((t.options ?? {})[key] ?? /** @type {any} */ (schema).default)
    }
    const missing = values.filter((/** @type {unknown} */ v) => !used.has(v))
    if (missing.length) problems.push(`options.${key}: no example renders ${missing.map((/** @type {unknown} */ v) => JSON.stringify(v)).join(', ')}`)
  }

  const first = examples[0]
  if (first) {
    for (const job of Object.keys(meta.jobs ?? {})) {
      try {
        await runPlugin(dir, { config: first.config ?? {}, tiles: [], job, fixtures: true })
        checked.push(`job ${job}`)
      } catch (err) {
        problems.push(`job ${job}: ${/** @type {Error} */ (err).message}`)
      }
    }
    if (meta.hasStream) {
      try {
        await runPlugin(dir, { config: first.config ?? {}, tiles: [], stream: { timeout: 1500 }, fixtures: true })
        checked.push('stream')
      } catch (err) {
        problems.push(`stream: ${/** @type {Error} */ (err).message}`)
      }
    }
  }
  return { id, problems, checked }
}

/** @param {string} dir */
async function loadMeta (dir) {
  const { PluginHost } = await import('./host.js')
  const file = ['index.js', 'index.mjs'].map(f => path.join(dir, f)).find(f => fs.existsSync(f))
  const host = new PluginHost({ id: path.basename(dir), file: /** @type {string} */ (file), dir, fixtures: true })
  try {
    return await host.start()
  } finally {
    await host.stop()
  }
}
