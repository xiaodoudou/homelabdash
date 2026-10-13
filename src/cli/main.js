import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { Homelabdash, formatError } from '../core.js'
import { Registry, BUILTIN_DIR } from '../plugins/registry.js'
import { loadAndValidate, buildEditorSchema } from '../config/validate.js'
import { contractCheck } from '../plugins/contract.js'
import { runPlugin } from '../../sdk/testing.js'
import { createLogger, writeFileAtomic } from '../util.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

const HELP = `homelabdash: self-hosted dashboard with plugins

Usage:
  homelabdash serve      [--config-dir DIR] [--data-dir DIR] [--port 3000] [--host 0.0.0.0] [--watch-builtin]
  homelabdash validate   [--config-dir DIR] [--json]
  homelabdash schema     [--config-dir DIR] [--out FILE]

  homelabdash plugin list
  homelabdash plugin info <id>
  homelabdash plugin new <id> [--builtin | --dir DIR] [--name "Display name"]
  homelabdash plugin run <id> [--example N | --config JSON|@file | --source ID]
                              [--options JSON|@file]... [--fixtures] [--job NAME]
                              [--action NAME --input JSON] [--stream SECONDS] [--quiet]
  homelabdash plugin test [id]
  homelabdash plugin capture <id> (--config JSON|@file | --source ID) [--options JSON]

Config folder: --config-dir, else $HOMELABDASH_CONFIG, else /config if it exists, else ./config.
Data folder:   --data-dir,   else $HOMELABDASH_DATA,   else /data if it exists, else ./data.
`

/** @param {string[]} argv */
export async function main (argv) {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'serve': return await serve(rest)
    case 'validate': return await validate(rest)
    case 'schema': return await schema(rest)
    case 'plugin': return await plugin(rest)
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP)
      return 0
    default:
      process.stderr.write(`unknown command "${cmd}"\n\n${HELP}`)
      return 2
  }
}

const common = {
  'config-dir': { type: /** @type {const} */ ('string') },
  'data-dir': { type: /** @type {const} */ ('string') }
}

/** @param {{ 'config-dir'?: string }} v */
function configDirOf (v) {
  return path.resolve(v['config-dir'] ?? process.env.HOMELABDASH_CONFIG ?? (fs.existsSync('/config') ? '/config' : 'config'))
}

/** @param {{ 'data-dir'?: string }} v */
function dataDirOf (v) {
  return path.resolve(v['data-dir'] ?? process.env.HOMELABDASH_DATA ?? (fs.existsSync('/data') ? '/data' : 'data'))
}

/** @param {string} configDir */
async function loadRegistry (configDir) {
  return await new Registry({ userDir: path.join(configDir, 'plugins'), configDir }).load()
}

/** @param {string[]} args */
async function serve (args) {
  const { values: v } = parseArgs({ args, options: { ...common, port: { type: 'string' }, host: { type: 'string' }, 'watch-builtin': { type: 'boolean' } } })
  const log = createLogger()
  const app = new Homelabdash({
    configDir: configDirOf(v),
    dataDir: dataDirOf(v),
    port: Number(v.port ?? process.env.PORT ?? 3000),
    host: v.host ?? process.env.HOST ?? '0.0.0.0',
    watchBuiltin: v['watch-builtin'] ?? process.env.HOMELABDASH_WATCH_BUILTIN === '1',
    log
  })
  await app.start()
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    log.info('shutting down')
    await app.stop()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  return new Promise(() => {})
}

/** @param {string[]} args */
async function validate (args) {
  const { values: v } = parseArgs({ args, options: { ...common, json: { type: 'boolean' } } })
  const configDir = configDirOf(v)
  const registry = await loadRegistry(configDir)
  try {
    const res = loadAndValidate(configDir, registry)
    const broken = registry.list().filter(e => e.error)
    const errors = res.errors.map(e => ({ ...e, file: e.file ? path.relative(process.cwd(), e.file) : undefined }))
    if (v.json) {
      process.stdout.write(JSON.stringify({ ok: !errors.length && !broken.length, errors, plugins: broken.map(e => ({ id: e.id, error: e.error })) }, null, 2) + '\n')
    } else {
      for (const e of broken) process.stdout.write(`plugin ${e.id}: ${e.error}\n`)
      for (const e of errors) process.stdout.write(formatError(e) + '\n')
      if (res.config && !broken.length) {
        const used = [...new Set(Object.values(res.config.sources).map(s => s.plugin))]
        process.stdout.write(`ok: ${Object.keys(res.config.sources).length} sources, ${Object.keys(res.config.tiles).length} tiles, plugins ${used.join(', ') || 'none'}\n`)
      }
    }
    return errors.length || broken.length ? 1 : 0
  } finally {
    await registry.stop()
  }
}

/** @param {string[]} args */
async function schema (args) {
  const { values: v } = parseArgs({ args, options: { ...common, out: { type: 'string' } } })
  const configDir = configDirOf(v)
  const registry = await loadRegistry(configDir)
  try {
    const out = path.resolve(v.out ?? path.join(configDir, '.schema', 'config.schema.json'))
    writeFileAtomic(out, JSON.stringify(buildEditorSchema(registry), null, 2) + '\n')
    const rel = path.relative(configDir, out).split(path.sep).join('/')
    process.stdout.write(`wrote ${out}\nadd this first line to homelabdash.yaml for completion and checks in editors:\n# yaml-language-server: $schema=./${rel}\n`)
    return 0
  } finally {
    await registry.stop()
  }
}

/** @param {string[]} args */
async function plugin (args) {
  const [sub, ...rest] = args
  switch (sub) {
    case 'list': return await pluginList(rest)
    case 'info': return await pluginInfo(rest)
    case 'new': return pluginNew(rest)
    case 'run': return await pluginRun(rest, false)
    case 'capture': return await pluginRun(rest, true)
    case 'test': return await pluginTest(rest)
    default:
      process.stderr.write(`unknown plugin command "${sub ?? ''}"\n\n${HELP}`)
      return 2
  }
}

/** @param {string[]} args */
async function pluginList (args) {
  const { values: v } = parseArgs({ args, options: { ...common, json: { type: 'boolean' } } })
  const registry = await loadRegistry(configDirOf(v))
  try {
    const rows = registry.list().map(e => ({ id: e.id, version: e.meta?.version, builtin: e.builtin, dir: e.dir, description: e.meta?.description, error: e.error }))
    if (v.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n')
    else for (const r of rows) process.stdout.write(`${r.id.padEnd(14)} ${(r.version ?? '').padEnd(8)} ${r.builtin ? 'builtin' : 'user   '} ${r.error ? 'ERROR ' + r.error : r.description}\n`)
    return rows.some(r => r.error) ? 1 : 0
  } finally {
    await registry.stop()
  }
}

/** @param {string[]} args */
async function pluginInfo (args) {
  const { values: v, positionals } = parseArgs({ args, options: { ...common }, allowPositionals: true })
  const registry = await loadRegistry(configDirOf(v))
  try {
    const e = registry.get(positionals[0] ?? '')
    if (!e) throw new Error(`unknown plugin "${positionals[0] ?? ''}" (installed: ${registry.list().map(x => x.id).join(', ')})`)
    if (!e.meta) throw new Error(`plugin ${e.id} does not load: ${e.error}`)
    const m = e.meta
    process.stdout.write(YAML.stringify({
      id: e.id,
      name: m.name,
      version: m.version,
      description: m.description,
      dir: e.dir,
      interval: m.interval,
      capabilities: { fetch: m.hasFetch, stream: m.hasStream, render: m.hasRender, alerts: m.hasAlerts, status: m.hasStatus, widget: e.widget },
      config: m.config,
      options: m.options,
      actions: m.actions,
      jobs: m.jobs,
      examples: /** @type {any} */ (m).examples
    }, { lineWidth: 0 }))
    return 0
  } finally {
    await registry.stop()
  }
}

/** @param {string[]} args */
function pluginNew (args) {
  const { values: v, positionals } = parseArgs({ args, options: { ...common, builtin: { type: 'boolean' }, dir: { type: 'string' }, name: { type: 'string' } }, allowPositionals: true })
  const id = positionals[0]
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('plugin id must be lowercase letters, digits and dashes, e.g. "sabnzbd"')
  const parent = v.builtin ? BUILTIN_DIR : path.resolve(v.dir ?? path.join(configDirOf(v), 'plugins'))
  const dest = path.join(parent, id)
  if (fs.existsSync(dest)) throw new Error(`${dest} already exists`)
  const name = v.name ?? id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
  const tpl = path.join(ROOT, 'templates', 'plugin')
  /** @param {string} from @param {string} to */
  const copy = (from, to) => {
    fs.mkdirSync(to, { recursive: true })
    for (const f of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, f.name)
      const dst = path.join(to, f.name.replace(/\.tpl$/, ''))
      if (f.isDirectory()) copy(src, dst)
      else fs.writeFileSync(dst, fs.readFileSync(src, 'utf8').replaceAll('__ID__', id).replaceAll('__NAME__', name))
    }
  }
  copy(tpl, dest)
  process.stdout.write(`created ${dest}
next:
  1. edit index.js (config, options, fetch, render) and fixtures/http.json (recorded responses)
  2. homelabdash plugin run ${id}            # runs the first example against the fixtures
  3. homelabdash plugin test ${id}           # contract check + plugin.test.js
`)
  return 0
}

/** @param {string | undefined} value */
function jsonArg (value) {
  if (value === undefined) return undefined
  const text = value.startsWith('@') ? fs.readFileSync(value.slice(1), 'utf8') : value
  return /\.ya?ml$/.test(value) ? YAML.parse(text) : JSON.parse(text)
}

/**
 * @param {string[]} args
 * @param {boolean} capture
 */
async function pluginRun (args, capture) {
  const { values: v, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      ...common,
      example: { type: 'string' },
      config: { type: 'string' },
      source: { type: 'string' },
      options: { type: 'string', multiple: true },
      fixtures: { type: 'boolean' },
      job: { type: 'string' },
      action: { type: 'string' },
      input: { type: 'string' },
      stream: { type: 'string' },
      quiet: { type: 'boolean' }
    }
  })
  const id = positionals[0]
  const configDir = configDirOf(v)
  const registry = await loadRegistry(configDir)
  const entry = registry.get(id ?? '')
  await registry.stop()
  if (!entry) throw new Error(`unknown plugin "${id ?? ''}" (installed: ${registry.list().map(e => e.id).join(', ')})`)
  if (!entry.meta) throw new Error(`plugin ${entry.id} does not load: ${entry.error}`)

  /** @type {any} */
  let config
  /** @type {{ id: string, options: any }[] | undefined} */
  let tiles
  let statusKeys
  let fixtures = v.fixtures ?? false
  if (v.source) {
    const reg = await loadRegistry(configDir)
    const res = loadAndValidate(configDir, reg)
    await reg.stop()
    if (!res.config) throw new Error(`config has errors, run homelabdash validate:\n${res.errors.map(formatError).join('\n')}`)
    const src = res.config.sources[v.source]
    if (!src) throw new Error(`no source "${v.source}" (sources: ${Object.keys(res.config.sources).join(', ')})`)
    if (src.plugin !== entry.id) throw new Error(`source "${v.source}" uses plugin ${src.plugin}, not ${entry.id}`)
    config = src.config
    tiles = Object.values(res.config.tiles).filter(t => t.source === v.source).map(t => ({ id: t.id, options: t.options }))
    statusKeys = Object.values(res.config.tiles).filter(t => t.status?.source === v.source).map(t => ({ tileId: t.id, key: /** @type {any} */ (t.status).key }))
  } else if (v.config) {
    config = jsonArg(v.config)
  } else {
    const examples = /** @type {any} */ (entry.meta).examples ?? []
    const ex = examples[Number(v.example ?? 1) - 1]
    if (!ex) throw new Error(`plugin ${entry.id} has no example ${v.example ?? 1}; pass --config`)
    config = ex.config
    tiles = ex.tiles?.map((/** @type {any} */ t, /** @type {number} */ i) => ({ id: t.id ?? `t${i + 1}`, options: t.options ?? {} })) ?? [{ id: 'tile', options: ex.options ?? {} }]
    statusKeys = ex.statusKeys
    fixtures = v.fixtures ?? true
  }
  if (v.options?.length) tiles = v.options.map((o, i) => ({ id: `tile${i + 1}`, options: jsonArg(o) }))
  if (capture) fixtures = false

  const r = await runPlugin(entry.dir, {
    config,
    tiles,
    statusKeys,
    fixtures,
    capture,
    job: v.job,
    action: v.action,
    input: jsonArg(v.input),
    stream: v.stream ? { timeout: Number(v.stream) * 1000 } : undefined,
    configDir,
    dataDir: dataDirOf(v)
  })

  if (capture) {
    const file = path.join(entry.dir, 'fixtures', 'captured.json')
    const scrubbed = scrub(r.captured ?? {}, config)
    writeFileAtomic(file, JSON.stringify(scrubbed, null, 2) + '\n')
    process.stdout.write(`wrote ${Object.keys(scrubbed).length} responses to ${file}
review it before committing: hostnames, IPs and secret-looking values were replaced, other personal data may remain.
then run: homelabdash plugin test ${entry.id}\n`)
    return 0
  }

  const out = {
    plugin: entry.id,
    fixtures,
    durationMs: r.durationMs,
    views: r.views,
    alerts: r.alerts,
    ...(r.alertsError ? { alertsError: r.alertsError } : {}),
    ...(statusKeys?.length ? { statuses: r.statuses } : {}),
    ...(r.result !== null ? { result: r.result } : {}),
    ...(Object.keys(r.state).length ? { state: r.state } : {}),
    ...(r.updates.length ? { streamUpdates: r.updates.length } : {}),
    ...(r.logs.length ? { logs: r.logs } : {}),
    ...(v.quiet ? {} : { data: r.data })
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  return Object.values(r.views).some(x => x.error) || r.alertsError ? 1 : 0
}

/**
 * Replaces things that identify a network or an account in recorded responses.
 * @param {Record<string, any>} captured
 * @param {any} config
 */
function scrub (captured, config) {
  /** @type {string[]} */
  const secrets = []
  /** @type {string[]} */
  const hosts = []
  const walk = (/** @type {any} */ o, /** @type {string} */ key = '') => {
    if (typeof o === 'string') {
      if (/key|token|pass|secret|auth/i.test(key) && o.length >= 4) secrets.push(o)
      try { const u = new URL(o); if (u.hostname) hosts.push(u.hostname) } catch {}
      if (/^host$/i.test(key)) hosts.push(o)
    } else if (o && typeof o === 'object') {
      for (const [k, x] of Object.entries(o)) walk(x, k)
    }
  }
  walk(config)
  let text = JSON.stringify(captured)
  for (const s of secrets) text = text.split(s).join('REDACTED')
  for (const h of hosts) text = text.split(h).join('host.example')
  text = text.replace(/\b(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, '192.0.2.10')
  return JSON.parse(text)
}

/** @param {string[]} args */
async function pluginTest (args) {
  const { values: v, positionals } = parseArgs({ args, options: { ...common }, allowPositionals: true })
  const configDir = configDirOf(v)
  const registry = await loadRegistry(configDir)
  await registry.stop()
  const entries = registry.list().filter(e => !positionals[0] || e.id === positionals[0])
  if (!entries.length) throw new Error(`unknown plugin "${positionals[0]}"`)
  let failed = 0
  for (const e of entries) {
    const { problems, checked } = await contractCheck(e.dir)
    if (problems.length) {
      failed++
      process.stdout.write(`FAIL ${e.id} contract\n${problems.map(p => `    - ${p}`).join('\n')}\n`)
    } else {
      process.stdout.write(`ok   ${e.id} contract (${checked.join(', ')})\n`)
    }
    const tests = fs.readdirSync(e.dir).filter(f => f.endsWith('.test.js')).map(f => path.join(e.dir, f))
    if (!tests.length) continue
    const hooks = path.join(ROOT, 'src', 'cli', 'test-hooks.js')
    const r = spawnSync(process.execPath, ['--import', pathToImport(hooks), '--test', '--test-reporter=spec', ...tests], { stdio: 'inherit' })
    if (r.status !== 0) failed++
  }
  return failed ? 1 : 0
}

/** @param {string} file */
function pathToImport (file) {
  return process.platform === 'win32' ? 'file:///' + file.replace(/\\/g, '/') : file
}
