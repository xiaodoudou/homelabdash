import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../src/config/load.js'
import { loadAndValidate } from '../src/config/validate.js'
import { Registry } from '../src/plugins/registry.js'
import { tempConfig, FIXTURE_PLUGINS } from './helpers.js'

const registry = await new Registry({ builtinDir: FIXTURE_PLUGINS }).load()
after(() => registry.stop())

test('includes merge sources and pages, errors point at the right file and line', () => {
  const dir = tempConfig({
    'homelabdash.yaml': 'include: [pages/*.yaml]\nsources:\n  a: { plugin: counter }\npages:\n  - id: one\n    sections: []\n',
    'pages/two.yaml': 'sources:\n  b: { plugin: counter }\npages:\n  - id: two\n    sections:\n      - title: S\n        tiles:\n          - { title: T, source: nope }\n'
  })
  const r = loadConfig(dir)
  assert.equal(r.config, null)
  assert.equal(r.errors.length, 1)
  assert.equal(path.basename(/** @type {string} */ (r.errors[0].file)), 'two.yaml')
  assert.equal(r.errors[0].line, 8)
  assert.equal(r.errors[0].path, 'pages[1].sections[0].tiles[0].source')
  assert.match(r.errors[0].message, /unknown source "nope" \(defined: alerts, a, b\)/)
})

test('secrets resolve from secrets.yaml, env and files, and stay out of browser-bound values', () => {
  const secretsDir = tempConfig({ FILE_ONE: 'from-file\n' })
  const dir = tempConfig({
    'homelabdash.yaml': [
      'sources:',
      '  a: { plugin: counter, config: { password: "${secret:YAML_ONE}", tag: "${secret:ENV_ONE}-${secret:FILE_ONE}" } }',
      'sections:',
      '  - tiles:',
      '      - { title: "${env:TITLE}", source: a }',
      '      - { title: x, href: "http://h/?k=${secret:YAML_ONE}" }'
    ].join('\n'),
    'secrets.yaml': 'YAML_ONE: from-yaml\n'
  })
  const r = loadConfig(dir, { env: { HOMELABDASH_SECRET_ENV_ONE: 'from-env', TITLE: 'Hello' }, secretsDir })
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0].message, /secrets are only allowed/)
  assert.equal(r.errors[0].path, 'sections[0].tiles[1].href')
  assert.equal(r.draft?.sources.a.config.password, 'from-yaml')
  assert.equal(r.draft?.sources.a.config.tag, 'from-env-from-file')
  assert.equal(Object.values(r.draft?.tiles ?? {})[0].title, 'Hello')
  assert.deepEqual([...r.secrets].sort(), ['from-env', 'from-file', 'from-yaml'])
})

test('shorthands: top-level sections, section source, inline plugin, container', () => {
  const dir = tempConfig({
    'homelabdash.yaml': [
      'settings: { containerSource: c }',
      'sources:',
      '  c: { plugin: counter }',
      'sections:',
      '  - { title: Alerts, source: alerts, placement: top }',
      '  - title: Main',
      '    merge: true',
      '    tiles:',
      '      - { title: Inline, plugin: counter, config: { tag: x }, interval: 5s }',
      '      - { title: Link, href: "http://x.example", container: up }'
    ].join('\n')
  })
  const r = loadAndValidate(dir, registry)
  assert.deepEqual(r.errors, [])
  const c = /** @type {import('../src/config/load.js').Config} */ (r.config)
  assert.equal(c.pages[0].id, 'home')
  const [alerts, inline, link] = Object.values(c.tiles)
  assert.equal(alerts.source, 'alerts')
  assert.equal(alerts.hideWhen, 'empty')
  assert.equal(c.pages[0].sections[0].hideWhen, 'empty')
  assert.deepEqual(c.pages[0].sections.map(s => s.placement), ['top', 'page'])
  assert.deepEqual(c.pages[0].sections.map(s => s.merge), [false, true])
  assert.equal(c.sources[/** @type {string} */ (inline.source)].interval, 5000)
  assert.equal(c.sources[/** @type {string} */ (inline.source)].config.tag, 'x')
  assert.deepEqual(link.status, { source: 'c', key: 'up' })
  assert.equal(inline.options.label, 'n', 'plugin option defaults are applied')
})

test('plugin schemas: unknown keys, unknown plugins, bad job overrides, one pass', () => {
  const dir = tempConfig({
    'homelabdash.yaml': [
      'sources:',
      '  a: { plugin: counter, config: { tga: 1 }, jobs: { tock: { schedule: daily } } }',
      '  b: { plugin: ghost }',
      'sections:',
      '  - tiles:',
      '      - { title: T, source: a, options: { lable: x } }'
    ].join('\n')
  })
  const r = loadAndValidate(dir, registry)
  const lines = r.errors.map(e => `${e.line} ${e.path}: ${e.message}`)
  assert.deepEqual(lines.sort(), [
    '2 sources.a.config.tga: unknown property (allowed: fail, hang, tag, password)',
    '2 sources.a.jobs.tock: plugin "counter" has no job "tock" (jobs: tick)',
    '3 sources.b.plugin: unknown plugin "ghost" (installed: counter)',
    '6 sections[0].tiles[0].options.lable: unknown property (allowed: label)'
  ])
})

test('YAML syntax errors carry a position', () => {
  const dir = tempConfig({ 'homelabdash.yaml': 'sources:\n  a: { plugin: counter\n' })
  const r = loadConfig(dir)
  assert.equal(r.config, null)
  assert.ok(r.errors[0].line)
})

test('a missing config file is reported, not thrown', () => {
  const dir = tempConfig({})
  const r = loadConfig(dir)
  assert.match(r.errors[0].message, /not found/)
  fs.rmSync(dir, { recursive: true })
})

test('the editor schema compiles and accepts the example config', async () => {
  const { buildEditorSchema } = await import('../src/config/validate.js')
  const { createAjv } = await import('../src/config/ajv.js')
  const YAML = (await import('yaml')).default
  const builtin = await new Registry().load()
  try {
    const validate = createAjv().compile(buildEditorSchema(builtin))
    const example = YAML.parse(fs.readFileSync(new URL('../examples/config/homelabdash.yaml', import.meta.url), 'utf8'))
    assert.equal(validate(example), true, JSON.stringify(validate.errors?.slice(0, 3)))
    assert.equal(validate({ sources: { x: { plugin: 'glances', config: { ulr: 'http://x' } } } }), false)
  } finally {
    await builtin.stop()
  }
})

test('bands hold groups one level deep; ids and error paths include the group', () => {
  const dir = tempConfig({
    'homelabdash.yaml': [
      'sources: { c: { plugin: counter } }',
      'sections:',
      '  - title: Library',
      '    sections:',
      '      - title: Missing',
      '        tiles: [{ title: Movies, source: c }]',
      '      - title: Downloading',
      '        tiles: [{ title: Queue, source: nope }]',
      '  - title: Deep',
      '    sections:',
      '      - title: Inner',
      '        sections: [{ title: Too far, tiles: [] }]',
      '  - title: Mixed',
      '    tiles: []',
      '    sections: []'
    ].join('\n')
  })
  const r = loadConfig(dir)
  const lines = r.errors.map(e => `${e.line} ${e.path}: ${e.message.split(' (')[0]}`)
  assert.deepEqual(lines, [
    '12 sections[1].sections[0].sections: unknown property',
    '15 sections[2].sections: a section has `sections`, `tiles` or `source`, only one of them',
    '8 sections[0].sections[1].tiles[0].source: unknown source "nope"'
  ])
  const band = /** @type {any} */ (r.draft).pages[0].sections[0]
  assert.equal(band.hideWhen, 'empty')
  assert.deepEqual(band.groups.map((/** @type {any} */ g) => g.id), ['library.missing', 'library.downloading'])
  assert.deepEqual(band.groups[0].tiles, ['home.library.missing.movies'])
})
