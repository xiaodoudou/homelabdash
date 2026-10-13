import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Registry } from '../src/plugins/registry.js'
import { runPlugin } from '../sdk/testing.js'
import { tempConfig, FIXTURE_PLUGINS } from './helpers.js'

test('a user plugin outside the app folder can import the app dependencies', async () => {
  const dir = tempConfig({
    'plugins/expr/index.js': `import jsonata from 'jsonata'
export default {
  id: 'expr', version: '1.0.0', description: 'test',
  async fetch () { return { type: 'text', text: String(await jsonata('1 + 2').evaluate({})) } }
}
`
  })
  const r = await runPlugin(`${dir}/plugins/expr`, {})
  assert.equal(r.view?.text, '3')
})

test('a user plugin with the same id overrides the builtin one, broken plugins are reported not thrown', async () => {
  const dir = tempConfig({
    'plugins/counter/index.js': "export default { id: 'counter', version: '9.0.0', description: 'override', fetch: () => null }\n",
    'plugins/broken/index.js': 'export default { nope\n'
  })
  const registry = await new Registry({ builtinDir: FIXTURE_PLUGINS, userDir: `${dir}/plugins` }).load()
  try {
    assert.equal(registry.get('counter')?.meta?.version, '9.0.0')
    assert.equal(registry.get('counter')?.builtin, false)
    assert.match(registry.get('broken')?.error ?? '', /SyntaxError|Unexpected/)
  } finally {
    await registry.stop()
  }
})
