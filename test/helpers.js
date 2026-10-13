import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Creates a temporary config folder from a map of relative path -> content.
 * @param {Record<string, string>} files
 */
export function tempConfig (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homelabdash-cfg-'))
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return dir
}

/** @param {number} ms */
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Polls until fn returns a truthy value.
 * @template T
 * @param {() => T | Promise<T>} fn
 * @param {number} [timeout]
 * @returns {Promise<T>}
 */
export async function until (fn, timeout = 5000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    last = await fn()
    if (last) return last
    await sleep(25)
  }
  throw new Error(`condition not met within ${timeout}ms (last value: ${JSON.stringify(last)}): ${fn.toString().slice(0, 160)}`)
}

export const FIXTURE_PLUGINS = path.join(import.meta.dirname, 'fixtures', 'plugins')
