import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { BUILTIN_DIR } from '../src/plugins/registry.js'
import { contractCheck } from '../src/plugins/contract.js'

// HOMELABDASH_PLUGIN_DIRS=/config/plugins adds user plugins to the run.
const roots = [BUILTIN_DIR, ...(process.env.HOMELABDASH_PLUGIN_DIRS ?? '').split(path.delimiter).filter(Boolean)]
const dirs = roots.flatMap(root => fs.existsSync(root)
  ? fs.readdirSync(root).map(n => path.join(root, n)).filter(d => fs.statSync(d).isDirectory())
  : [])

for (const dir of dirs) {
  test(`plugin contract: ${path.basename(dir)}`, async () => {
    const { problems } = await contractCheck(dir)
    assert.deepEqual(problems, [], `\n  - ${problems.join('\n  - ')}`)
  })
}
