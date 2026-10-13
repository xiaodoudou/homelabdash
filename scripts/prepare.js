// npm prepare, run by `npm install` in a clone: points git at .githooks so the commit checks run, and builds the page
// into dist/ when it is missing, so `npm start` works right after install. HOMELABDASH_SKIP_BUILD=1 skips the build.
import fs from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
if (fs.existsSync(`${root}.git`)) {
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'ignore' })
  } catch {}
}

if (!process.env.HOMELABDASH_SKIP_BUILD && !fs.existsSync(`${root}dist/index.html`) && fs.existsSync(`${root}node_modules/vite`)) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const r = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  process.exitCode = r.status ?? 1
}
