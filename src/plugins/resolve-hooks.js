// Lets plugins outside the app folder (e.g. /config/plugins) import the app's own dependencies
// (jsonata, ws, ssh2, yaml...) and `homelabdash/testing` without a node_modules of their own.
const APP = new URL('../../', import.meta.url)
const TESTING = new URL('sdk/testing.js', APP).href
const PARENT = new URL('package.json', APP).href

/** @param {string} s */
const isBare = s => !/^(\.|\/|[a-zA-Z]+:)/.test(s)

/**
 * @param {string} specifier
 * @param {any} context
 * @param {(s: string, c?: any) => any} next
 */
export function resolveSync (specifier, context, next) {
  if (specifier === 'homelabdash/testing') return { url: TESTING, shortCircuit: true }
  try {
    return next(specifier, context)
  } catch (err) {
    if (/** @type {any} */ (err)?.code !== 'ERR_MODULE_NOT_FOUND' || !isBare(specifier)) throw err
    return next(specifier, { ...context, parentURL: PARENT })
  }
}

/**
 * @param {string} specifier
 * @param {any} context
 * @param {(s: string, c?: any) => Promise<any>} next
 */
export async function resolve (specifier, context, next) {
  if (specifier === 'homelabdash/testing') return { url: TESTING, shortCircuit: true }
  try {
    return await next(specifier, context)
  } catch (err) {
    if (/** @type {any} */ (err)?.code !== 'ERR_MODULE_NOT_FOUND' || !isBare(specifier)) throw err
    return await next(specifier, { ...context, parentURL: PARENT })
  }
}

/** Installs the hooks in the current thread (synchronous hooks when the Node version has them). */
export async function installResolveHooks () {
  const mod = /** @type {any} */ (await import('node:module'))
  if (typeof mod.registerHooks === 'function') mod.registerHooks({ resolve: resolveSync })
  else mod.register(import.meta.url)
}
