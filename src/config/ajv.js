import ajvModule from 'ajv/dist/2020.js'
import formatsModule from 'ajv-formats'

// CommonJS packages: the default import is module.exports, which TypeScript types as the namespace.
const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').default} */ (/** @type {any} */ (ajvModule).default ?? ajvModule)
const addFormats = /** @type {typeof import('ajv-formats').default} */ (/** @type {any} */ (formatsModule).default ?? formatsModule)

/** Ajv with defaults applied: plugin `config` / `options` schemas may declare `default` values. */
export function createAjv () {
  const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: true, verbose: true })
  addFormats(ajv)
  return ajv
}

/** Strict mode rejects unknown keywords, so a typo such as `requird` in a plugin schema fails the contract test. */
export function createStrictAjv () {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, strictTuples: false, strictRequired: false, allErrors: true })
  addFormats(ajv)
  return ajv
}

/** @typedef {{ path: (string|number)[], message: string }} RawError */

/**
 * Turns Ajv errors into one readable message per problem.
 * @param {import('ajv').ErrorObject[]} errors
 * @param {(string|number)[]} prefix
 * @returns {RawError[]}
 */
export function formatAjvErrors (errors, prefix = []) {
  const unions = errors.filter(e => e.keyword === 'anyOf' || e.keyword === 'oneOf')
  const inUnion = (/** @type {import('ajv').ErrorObject} */ e) =>
    unions.some(u => u !== e && e.schemaPath.startsWith(u.schemaPath + '/'))
  /** @type {RawError[]} */
  const out = []
  const seen = new Set()
  for (const e of errors) {
    if (inUnion(e) || e.keyword === 'if') continue
    const path = [...prefix, ...e.instancePath.split('/').slice(1).map(decodePointer)]
    let message
    switch (e.keyword) {
      case 'required':
        path.push(e.params.missingProperty)
        message = 'is required'
        break
      case 'additionalProperties': {
        path.push(e.params.additionalProperty)
        const allowed = Object.keys(/** @type {any} */ (e.parentSchema)?.properties ?? {})
        message = allowed.length ? `unknown property (allowed: ${allowed.join(', ')})` : 'unknown property'
        break
      }
      case 'enum':
        message = `must be one of: ${e.params.allowedValues.map((/** @type {unknown} */ v) => JSON.stringify(v)).join(', ')}`
        break
      case 'anyOf':
      case 'oneOf': {
        const desc = /** @type {any} */ (e.parentSchema)?.description
        message = desc ? `invalid value, expected: ${desc}` : 'does not match any of the allowed forms'
        break
      }
      case 'propertyNames':
        continue
      case 'pattern':
        if (e.propertyName) { path.push(e.propertyName); message = `invalid name, must match ${e.params.pattern}` } else message = `must match ${e.params.pattern}`
        break
      default:
        message = e.message ?? e.keyword
    }
    const key = path.join('.') + '|' + message
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path, message })
  }
  return out
}

/** @param {string} s */
function decodePointer (s) {
  const v = s.replace(/~1/g, '/').replace(/~0/g, '~')
  return /^\d+$/.test(v) ? Number(v) : v
}

/** @param {(string|number)[]} path */
export function formatPath (path) {
  return path.reduce((/** @type {string} */ acc, seg) =>
    typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : String(seg), '')
}
