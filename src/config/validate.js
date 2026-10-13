import { createAjv, formatPath } from './ajv.js'
import { loadConfig, validateWith, ALERTS_SOURCE } from './load.js'
import { configSchema, sourceSchema, tileSchema } from './base-schema.js'
import { parseSchedule } from '../runtime/cron.js'

/**
 * Loads the config folder and checks every source and tile against its plugin's schemas.
 * Plugin defaults are applied to `config` and `options` in place.
 * @param {string} configDir
 * @param {import('../plugins/registry.js').Registry} registry
 * @param {{ env?: NodeJS.ProcessEnv, secretsDir?: string }} [opts]
 */
export function loadAndValidate (configDir, registry, opts) {
  const res = loadConfig(configDir, opts)
  if (!res.draft) return res
  const errors = [...res.errors, ...validatePlugins(res.draft, registry, res.locate)]
  return { ...res, errors, config: errors.length ? null : res.draft }
}

/**
 * @param {import('./load.js').Config} config
 * @param {import('../plugins/registry.js').Registry} registry
 * @param {(p: (string|number)[]) => { file?: string, line?: number, col?: number }} locate
 * @returns {import('./load.js').ConfigError[]}
 */
export function validatePlugins (config, registry, locate) {
  /** @type {import('./load.js').ConfigError[]} */
  const errors = []
  const ajv = createAjv()
  /** @param {(string|number)[]} p @param {string} message */
  const fail = (p, message) => errors.push({ ...locate(p), path: formatPath(p), message })
  const installed = registry.list().map(e => e.id).join(', ')

  for (const src of Object.values(config.sources)) {
    const entry = registry.get(src.plugin)
    if (!entry) { fail([...src.path, 'plugin'], `unknown plugin "${src.plugin}" (installed: ${installed || 'none'})`); continue }
    if (!entry.meta) continue
    validateWith(ajv, entry.meta.config, src.config, [...src.path, 'config'], fail)
    for (const [name, override] of Object.entries(src.jobs)) {
      const p = [...src.path, 'jobs', name]
      if (!entry.meta.jobs[name]) { fail(p, `plugin "${src.plugin}" has no job "${name}" (jobs: ${Object.keys(entry.meta.jobs).join(', ') || 'none'})`); continue }
      if (override.schedule) {
        try { parseSchedule(override.schedule) } catch (err) { fail([...p, 'schedule'], /** @type {Error} */ (err).message) }
      }
    }
  }

  for (const tile of Object.values(config.tiles)) {
    const optionsPath = tile.bare ? [...tile.path.slice(0, -1), 'options'] : [...tile.path, 'options']
    if (tile.source && tile.source !== ALERTS_SOURCE) {
      const src = config.sources[tile.source]
      const meta = src && registry.get(src.plugin)?.meta
      if (meta) validateWith(ajv, meta.options, tile.options, optionsPath, fail)
    } else if (tile.source === ALERTS_SOURCE && Object.keys(tile.options).length) {
      fail(optionsPath, 'the alerts source takes no options')
    }
    if (tile.status) {
      const src = config.sources[tile.status.source]
      const meta = src && registry.get(src.plugin)?.meta
      if (meta && !meta.hasStatus) fail([...tile.path, 'status'], `plugin "${src.plugin}" does not provide a status`)
    }
  }
  return errors
}

/**
 * When every error sits inside one source or one tile, returns the config with those parts switched
 * off (and their message attached) so the rest of the dashboard keeps working. Otherwise null.
 * @param {import('./load.js').Config} draft
 * @param {import('./load.js').ConfigError[]} errors
 * @returns {import('./load.js').Config | null}
 */
export function isolateErrors (draft, errors) {
  const inside = (/** @type {string} */ p, /** @type {string} */ base) => p === base || p.startsWith(base + '.') || p.startsWith(base + '[')
  const sources = Object.values(draft.sources).map(s => ({ s, base: formatPath(s.path) }))
  const tiles = Object.values(draft.tiles).map(t => ({ t, base: formatPath(t.bare ? t.path.slice(0, -1) : t.path) }))
  for (const e of errors) {
    if (!e.path) return null
    const src = sources.filter(x => inside(e.path, x.base)).sort((a, b) => b.base.length - a.base.length)[0]
    if (src) {
      src.s.enabled = false
      src.s.configError = src.s.configError ?? `${e.path}: ${e.message}`
      continue
    }
    const tile = tiles.find(x => inside(e.path, x.base))
    if (!tile) return null
    tile.t.configError = tile.t.configError ?? `${e.path}: ${e.message}`
  }
  return draft
}

/**
 * JSON Schema for editors (yaml-language-server), with each installed plugin's config schema
 * attached to sources that use it.
 * @param {import('../plugins/registry.js').Registry} registry
 */
export function buildEditorSchema (registry) {
  const plugins = registry.list().filter(e => e.meta)
  const ids = plugins.map(e => e.id)
  const pluginProp = { enum: ids, description: plugins.map(e => `${e.id}: ${e.meta?.description}`).join('\n') }
  const source = {
    ...sourceSchema,
    properties: { ...sourceSchema.properties, plugin: pluginProp },
    allOf: plugins.map(e => ({
      if: { properties: { plugin: { const: e.id } }, required: ['plugin'] },
      then: {
        properties: {
          config: e.meta?.config,
          jobs: { propertyNames: Object.keys(e.meta?.jobs ?? {}).length ? { enum: Object.keys(e.meta?.jobs ?? {}) } : false }
        }
      }
    }))
  }
  const tile = {
    ...tileSchema,
    properties: { ...tileSchema.properties, plugin: pluginProp },
    allOf: plugins.map(e => ({
      if: { properties: { plugin: { const: e.id } }, required: ['plugin'] },
      then: { properties: { config: e.meta?.config, options: e.meta?.options } }
    }))
  }
  /** @type {any} */
  const schema = structuredClone(configSchema)
  schema.properties.sources.additionalProperties = source
  const section = schema.properties.sections.items
  section.properties.tiles.items = tile
  section.properties.sections.items.properties.tiles.items = tile
  schema.properties.pages.items.properties.sections.items = section
  return schema
}
