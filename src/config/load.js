import fs from 'node:fs'
import path from 'node:path'
import YAML, { LineCounter } from 'yaml'
import { configSchema, includeSchema } from './base-schema.js'
import { createAjv, formatAjvErrors, formatPath } from './ajv.js'
import { expandGlob, parseDuration, slug } from '../util.js'

export const MAIN_FILES = ['homelabdash.yaml', 'homelabdash.yml']
export const ALERTS_SOURCE = 'alerts'

/**
 * @typedef {{ file?: string, line?: number, col?: number, path: string, message: string }} ConfigError
 * @typedef {{ file: string, doc: import('yaml').Document, lc: LineCounter }} FileRec
 * @typedef {(string|number)[]} Path
 *
 * @typedef {object} Settings
 * @property {string} title
 * @property {string} [description]
 * @property {'auto'|'dark'|'light'} theme
 * @property {string} accent
 * @property {'comfortable'|'compact'} density
 * @property {'_blank'|'_self'} target
 * @property {number} defaultInterval
 * @property {number} idleInterval
 * @property {number} timeout
 * @property {string} [containerSource]
 * @property {{ type: 'none' } | { type: 'basic', username: string, password: string } | { type: 'header', header: string }} auth
 *
 * @typedef {object} JobOverride
 * @property {string} [schedule]
 * @property {boolean} [enabled]
 *
 * @typedef {object} SourceDef
 * @property {string} id
 * @property {string} plugin
 * @property {string} name
 * @property {Record<string, any>} config
 * @property {number} [interval]
 * @property {number} [timeout]
 * @property {boolean} enabled
 * @property {Record<string, JobOverride>} jobs
 * @property {Path} path
 * @property {string} [configError] set when this source was switched off because of a config error
 *
 * @typedef {object} Tile
 * @property {string} id
 * @property {string} pageId
 * @property {string} sectionId
 * @property {string} [title]
 * @property {string} [icon]
 * @property {string} [href]
 * @property {'_blank'|'_self'} target
 * @property {string} [description]
 * @property {string} [source]
 * @property {Record<string, any>} options
 * @property {{ source: string, key: string } | null} status
 * @property {number | 'full'} span
 * @property {'never'|'empty'|'error'} hideWhen
 * @property {boolean} bare
 * @property {true | string[] | null} graph stats whose history is kept and drawn
 * @property {Path} path
 * @property {string} [configError] set when this tile was switched off because of a config error
 *
 * @typedef {object} Section
 * @property {string} id
 * @property {string} [title]
 * @property {string} [icon]
 * @property {'never'|'empty'} hideWhen
 * @property {'page'|'top'} placement
 * @property {boolean} merge
 * @property {boolean} collapsed
 * @property {{ minTileWidth?: number, columns?: number, gap?: number }} layout
 * @property {string[]} tiles tile ids
 * @property {Section[]} groups sub-sections laid out side by side (a band); empty for a plain section
 *
 * @typedef {{ id: string, title: string, icon?: string, sections: Section[] }} Page
 *
 * @typedef {object} Config
 * @property {Settings} settings
 * @property {Record<string, SourceDef>} sources
 * @property {Page[]} pages
 * @property {Record<string, Tile>} tiles
 */

const SECRET_RE = /\$\{(secret|env):([A-Za-z0-9_.-]+)\}/g

/**
 * Reads the config folder: YAML files, includes and secrets. Plugin-specific checks happen in validate.js.
 * @param {string} configDir
 * @param {{ env?: NodeJS.ProcessEnv, secretsDir?: string }} [opts]
 */
export function loadConfig (configDir, { env = process.env, secretsDir = '/run/secrets' } = {}) {
  /** @type {ConfigError[]} */
  const errors = []
  /** @type {Set<string>} */
  const secrets = new Set()
  /** @type {string[]} */
  const files = []
  const ajv = createAjv()

  const mainName = MAIN_FILES.find(f => fs.existsSync(path.join(configDir, f)))
  if (!mainName) {
    errors.push({ file: path.join(configDir, MAIN_FILES[0]), path: '', message: 'config file not found' })
    return { config: null, draft: null, errors, secrets, files, locate: () => ({}) }
  }

  /** @param {string} file */
  const parse = (file) => {
    files.push(file)
    const lc = new LineCounter()
    const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'), { lineCounter: lc })
    for (const e of doc.errors) {
      const pos = lc.linePos(e.pos[0])
      errors.push({ file, line: pos.line, col: pos.col, path: '', message: e.message.split('\n')[0] })
    }
    return { file, doc, lc }
  }

  const main = parse(path.join(configDir, mainName))
  /** @type {any} */
  const raw = main.doc.errors.length ? {} : (main.doc.toJS() ?? {})
  /** @type {{ sources: Record<string, FileRec>, pages: { rec: FileRec, index: number }[] }} */
  const origins = { sources: {}, pages: [] }

  /** @param {Path} p */
  const locate = (p) => {
    let rec = /** @type {FileRec} */ (main)
    let local = p
    if (p[0] === 'sources' && typeof p[1] === 'string' && origins.sources[p[1]]) {
      rec = origins.sources[p[1]]
    } else if (p[0] === 'pages' && typeof p[1] === 'number' && origins.pages[p[1]]) {
      rec = origins.pages[p[1]].rec
      local = ['pages', origins.pages[p[1]].index, ...p.slice(2)]
    }
    for (let n = local.length; n >= 0; n--) {
      const node = /** @type {any} */ (n === 0 ? rec.doc.contents : rec.doc.getIn(local.slice(0, n), true))
      if (node?.range) {
        const { line, col } = rec.lc.linePos(node.range[0])
        return { file: rec.file, line, col }
      }
    }
    return { file: rec.file }
  }
  /** @param {Path} p @param {string} message */
  const fail = (p, message) => errors.push({ ...locate(p), path: formatPath(p), message })

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail([], 'top level must be a mapping')
    return { config: null, draft: null, errors, secrets, files, locate }
  }
  validateWith(ajv, configSchema, raw, [], fail)
  for (const id of Object.keys(raw.sources ?? {})) origins.sources[id] = main
  ;(raw.pages ?? []).forEach((/** @type {unknown} */ _p, /** @type {number} */ i) => origins.pages.push({ rec: main, index: i }))

  for (const pattern of Array.isArray(raw.include) ? raw.include : []) {
    let matches
    try {
      matches = expandGlob(configDir, pattern)
    } catch (err) {
      fail(['include'], /** @type {Error} */ (err).message)
      continue
    }
    if (!matches.length) fail(['include'], `"${pattern}" matches no file`)
    for (const file of matches) {
      const rec = parse(file)
      if (rec.doc.errors.length) continue
      /** @type {any} */
      const part = rec.doc.toJS() ?? {}
      const before = errors.length
      validateWith(ajv, includeSchema, part, [], (p, m) => {
        const pos = locateIn(rec, p)
        errors.push({ ...pos, path: formatPath(p), message: m })
      })
      if (errors.length > before) continue
      for (const [id, def] of Object.entries(part.sources ?? {})) {
        if (raw.sources?.[id]) {
          errors.push({ ...locateIn(rec, ['sources', id]), path: `sources.${id}`, message: `source "${id}" is already defined in ${path.basename(origins.sources[id].file)}` })
          continue
        }
        raw.sources = raw.sources ?? {}
        raw.sources[id] = def
        origins.sources[id] = rec
      }
      ;(part.pages ?? []).forEach((/** @type {any} */ page, /** @type {number} */ i) => {
        raw.pages = raw.pages ?? []
        raw.pages.push(page)
        origins.pages.push({ rec, index: i })
      })
    }
  }

  const secretValues = loadSecrets(configDir, files, errors)
  interpolate(raw, [], {
    /** @param {'secret'|'env'} kind @param {string} name @param {Path} p */
    resolve (kind, name, p) {
      if (kind === 'env') {
        const v = env[name]
        if (v === undefined) fail(p, `environment variable ${name} is not set`)
        return v ?? ''
      }
      const allowed = (p[0] === 'sources' && p[2] === 'config') || (p[0] === 'settings' && p[1] === 'auth') ||
        (p[0] === 'pages' && p.includes('config'))
      if (!allowed) fail(p, 'secrets are only allowed in a source `config` or `settings.auth`, because other values are sent to the browser')
      const v = secretValues[name] ?? env[`HOMELABDASH_SECRET_${name}`] ?? readSecretFile(secretsDir, name)
      if (v === undefined) {
        fail(p, `secret ${name} is not defined (secrets.yaml, HOMELABDASH_SECRET_${name} or ${secretsDir}/${name})`)
        return ''
      }
      if (v.length >= 4) secrets.add(v)
      return v
    }
  })

  // Keep going after earlier errors so one run reports everything; a shape too broken to read just stops here.
  /** @type {Config | null} */
  let draft = null
  try {
    draft = normalize(raw, fail)
  } catch (err) {
    if (!errors.length) throw err
  }
  return { config: errors.length ? null : draft, draft, errors, secrets, files, locate }
}

/**
 * @param {import('ajv').default} ajv
 * @param {object} schema
 * @param {unknown} data
 * @param {Path} prefix
 * @param {(p: Path, m: string) => void} fail
 */
export function validateWith (ajv, schema, data, prefix, fail) {
  const validate = ajv.compile(schema)
  if (validate(data)) return true
  for (const e of formatAjvErrors(validate.errors ?? [], prefix)) fail(e.path, e.message)
  return false
}

/** @param {FileRec} rec @param {Path} p */
function locateIn (rec, p) {
  for (let n = p.length; n >= 0; n--) {
    const node = /** @type {any} */ (n === 0 ? rec.doc.contents : rec.doc.getIn(p.slice(0, n), true))
    if (node?.range) return { file: rec.file, ...rec.lc.linePos(node.range[0]) }
  }
  return { file: rec.file }
}

/**
 * @param {string} configDir
 * @param {string[]} files
 * @param {ConfigError[]} errors
 * @returns {Record<string, string>}
 */
function loadSecrets (configDir, files, errors) {
  const file = ['secrets.yaml', 'secrets.yml'].map(f => path.join(configDir, f)).find(f => fs.existsSync(f))
  if (!file) return {}
  files.push(file)
  try {
    const data = YAML.parse(fs.readFileSync(file, 'utf8')) ?? {}
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('must be a flat mapping of NAME: value')
    /** @type {Record<string, string>} */
    const out = {}
    for (const [k, v] of Object.entries(data)) {
      if (v === null || typeof v === 'object') throw new Error(`${k}: value must be a string or number`)
      out[k] = String(v)
    }
    return out
  } catch (err) {
    errors.push({ file, path: '', message: /** @type {Error} */ (err).message.split('\n')[0] })
    return {}
  }
}

/** @param {string} dir @param {string} name */
function readSecretFile (dir, name) {
  for (const n of [name, name.toLowerCase()]) {
    try {
      return fs.readFileSync(path.join(dir, n), 'utf8').trim()
    } catch {}
  }
  return undefined
}

/**
 * @param {any} node
 * @param {Path} p
 * @param {{ resolve: (kind: 'secret'|'env', name: string, p: Path) => string }} r
 */
function interpolate (node, p, r) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => { node[i] = typeof v === 'string' ? sub(v, [...p, i], r) : (interpolate(v, [...p, i], r), v) })
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      node[k] = typeof v === 'string' ? sub(v, [...p, k], r) : (interpolate(v, [...p, k], r), v)
    }
  }
}

/** @param {string} s @param {Path} p @param {{ resolve: (kind: 'secret'|'env', name: string, p: Path) => string }} r */
function sub (s, p, r) {
  return s.includes('${') ? s.replace(SECRET_RE, (_m, kind, name) => r.resolve(kind, name, p)) : s
}

const SETTINGS_DEFAULTS = {
  title: 'homelabdash',
  theme: 'auto',
  accent: '#38bdf8',
  density: 'comfortable',
  target: '_blank',
  defaultInterval: '30s',
  idleInterval: '5m',
  timeout: '10s'
}

/**
 * @param {any} raw
 * @param {(p: Path, m: string) => void} fail
 * @returns {Config}
 */
function normalize (raw, fail) {
  const s = { ...SETTINGS_DEFAULTS, ...raw.settings }
  /** @type {Settings} */
  const settings = {
    title: s.title,
    description: s.description,
    theme: s.theme,
    accent: s.accent,
    density: s.density,
    target: s.target,
    defaultInterval: /** @type {number} */ (parseDuration(s.defaultInterval)),
    idleInterval: /** @type {number} */ (parseDuration(s.idleInterval)),
    timeout: /** @type {number} */ (parseDuration(s.timeout)),
    containerSource: s.containerSource,
    auth: s.auth ?? { type: 'none' }
  }

  /** @type {Record<string, SourceDef>} */
  const sources = {}
  for (const [id, def] of Object.entries(raw.sources ?? {})) {
    if (id === ALERTS_SOURCE) { fail(['sources', id], `"${ALERTS_SOURCE}" is reserved for the built-in alerts source`); continue }
    sources[id] = sourceDef(id, /** @type {any} */ (def), ['sources', id])
  }

  if (raw.pages && raw.sections) fail(['sections'], 'use either `pages` or top-level `sections`, not both')
  /** @type {{ page: any, path: Path }[]} */
  const rawPages = raw.pages
    ? raw.pages.map((/** @type {any} */ page, /** @type {number} */ i) => ({ page, path: ['pages', i] }))
    : [{ page: { id: 'home', title: settings.title, sections: raw.sections ?? [] }, path: [] }]

  /** @type {Record<string, Tile>} */
  const tiles = {}
  const pageIds = new Set()
  /** @type {{ tile: Tile, raw: any }[]} */
  const pending = []
  const pages = rawPages.map(({ page, path: pp }) => {
    if (pageIds.has(page.id)) fail([...pp, 'id'], `duplicate page id "${page.id}"`)
    pageIds.add(page.id)
    const sectionsPath = pp.length ? [...pp, 'sections'] : ['sections']
    /**
     * @param {any} sec
     * @param {Path} sp
     * @param {number} si
     * @param {Set<string>} used ids taken by siblings
     * @param {string | null} parentId set for a group inside a band
     * @returns {Section}
     */
    const buildSection = (sec, sp, si, used, parentId) => {
      let sid = sec.id ?? (sec.title ? slug(sec.title) : `s${si + 1}`)
      while (used.has(sid)) sid += '-2'
      used.add(sid)
      const fullId = parentId ? `${parentId}.${sid}` : sid
      /** @type {Section[]} */
      let groups = []
      if (sec.sections) {
        if (sec.tiles || sec.source) fail([...sp, 'sections'], 'a section has `sections`, `tiles` or `source`, only one of them')
        const sub = new Set()
        groups = sec.sections.map((/** @type {any} */ g, /** @type {number} */ gi) => buildSection(g, [...sp, 'sections', gi], gi, sub, fullId))
      }
      let rawTiles = sec.tiles ?? []
      if (sec.source) {
        if (sec.tiles) fail([...sp, 'source'], 'a section has either `source` or `tiles`, not both')
        rawTiles = [{ source: sec.source, options: sec.options, span: 'full', hideWhen: sec.source === ALERTS_SOURCE ? 'empty' : 'never', bare: true }]
      }
      const ids = rawTiles.map((/** @type {any} */ t, /** @type {number} */ ti) => {
        const tp = sec.source ? [...sp, 'source'] : [...sp, 'tiles', ti]
        let tid = t.id ?? `${page.id}.${fullId}.${slug(t.title ?? t.source ?? t.plugin ?? String(ti + 1))}`
        if (t.id && tiles[tid]) fail([...tp, 'id'], `duplicate tile id "${tid}"`)
        let n = 2
        while (tiles[tid]) tid = `${t.id ?? tid.replace(/-\d+$/, '')}-${n++}`
        /** @type {Tile} */
        const tile = {
          id: tid,
          pageId: page.id,
          sectionId: fullId,
          title: t.title,
          icon: t.icon,
          href: t.href,
          target: t.target ?? settings.target,
          description: t.description,
          source: t.source,
          options: t.options ?? {},
          status: null,
          span: t.span ?? 1,
          hideWhen: t.hideWhen ?? 'never',
          bare: !!t.bare,
          graph: t.graph === true ? true : Array.isArray(t.graph) ? t.graph : null,
          path: tp
        }
        if (t.plugin) {
          if (t.source) fail([...tp, 'plugin'], 'a tile has either `source` or an inline `plugin`, not both')
          const inlineId = `tile.${tid}`
          sources[inlineId] = sourceDef(inlineId, { plugin: t.plugin, name: t.title, config: t.config, interval: t.interval }, tp)
          tile.source = inlineId
        } else {
          if (t.config) fail([...tp, 'config'], '`config` only goes with an inline `plugin`; shared settings belong in `sources`')
          if (t.interval) fail([...tp, 'interval'], '`interval` only goes with an inline `plugin`; set it on the source instead')
        }
        tiles[tid] = tile
        pending.push({ tile, raw: t })
        return tid
      })
      return {
        id: fullId,
        title: sec.title,
        icon: sec.icon,
        hideWhen: sec.hideWhen ?? (sec.source === ALERTS_SOURCE || groups.length ? 'empty' : 'never'),
        placement: sec.placement ?? 'page',
        merge: !!sec.merge,
        collapsed: !!sec.collapsed,
        layout: sec.layout ?? {},
        tiles: ids,
        groups
      }
    }
    const used = new Set()
    /** @type {Section[]} */
    const sections = (page.sections ?? []).map((/** @type {any} */ sec, /** @type {number} */ si) => buildSection(sec, [...sectionsPath, si], si, used, null))
    return { id: page.id, title: page.title ?? page.id, icon: page.icon, sections }
  })

  const dockerSources = Object.values(sources).filter(src => src.plugin === 'docker').map(src => src.id)
  const defaultStatusSource = settings.containerSource ?? (dockerSources.length === 1 ? dockerSources[0] : undefined)
  if (settings.containerSource && !sources[settings.containerSource]) {
    fail(['settings', 'containerSource'], `unknown source "${settings.containerSource}"`)
  }
  for (const { tile, raw: t } of pending) {
    if (tile.source && tile.source !== ALERTS_SOURCE && !sources[tile.source]) {
      fail([...tile.path, 'source'], `unknown source "${tile.source}" (defined: ${[ALERTS_SOURCE, ...Object.keys(sources).filter(k => !k.startsWith('tile.'))].join(', ')})`)
    }
    const st = t.status ?? (t.container ? { key: t.container } : null)
    if (st) {
      const src = st.source ?? defaultStatusSource
      const at = [...tile.path, t.status ? 'status' : 'container']
      if (!src) {
        fail(at, dockerSources.length ? 'several docker sources exist: set `status.source` or `settings.containerSource`' : 'needs a source with plugin: docker (or `status.source`)')
      } else if (!sources[src]) {
        fail(at, `unknown source "${src}"`)
      } else {
        tile.status = { source: src, key: st.key }
      }
    }
  }

  return { settings, sources, pages, tiles }
}

/** @param {string} id @param {any} def @param {Path} p @returns {SourceDef} */
function sourceDef (id, def, p) {
  return {
    id,
    plugin: def.plugin,
    name: def.name ?? id,
    config: def.config ?? {},
    interval: parseDuration(def.interval),
    timeout: parseDuration(def.timeout),
    enabled: def.enabled !== false,
    jobs: def.jobs ?? {},
    path: p
  }
}
