import { createAjv, formatAjvErrors, formatPath } from '../config/ajv.js'

export const FORMATS = ['number', 'percent', 'bytes', 'bits', 'bitrate', 'byterate', 'duration', 'clock', 'until', 'relativeTime', 'since', 'date', 'datetime', 'temperature', 'text']
export const TONES = ['ok', 'info', 'warning', 'error', 'neutral']

const format = { enum: FORMATS }
const tone = { enum: TONES }
const num = { type: ['number', 'null'] }
const action = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'title'],
  properties: {
    action: { type: 'string' },
    title: { type: 'string' },
    input: {},
    confirm: { type: 'string', description: 'Asked on the button after a first click; only a second click runs the action' }
  }
}
/** Buttons under a tile; the plugin decides which to show from its config and the current data. */
const actions = { type: 'array', items: action }
const str = { type: ['string', 'null'] }

/** One schema per view type: a typo in a key or a wrong type fails the tile instead of rendering blank. */
export const VIEW_SCHEMAS = /** @type {Record<string, object>} */ ({
  stats: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'items'],
    properties: {
      type: { const: 'stats' },
      actions,
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value'],
          properties: {
            label: { type: 'string' },
            value: { type: ['number', 'string', 'null'] },
            format,
            unit: str,
            warn: num,
            crit: num,
            invert: { type: 'boolean' },
            tone: { anyOf: [tone, { type: 'null' }] },
            href: str
          }
        }
      }
    }
  },
  list: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'items'],
    properties: {
      type: { const: 'list' },
      actions,
      limit: { type: 'integer', minimum: 1 },
      dense: { type: 'boolean', description: 'One line per row: subtitle beside the title, progress as a thin line under it' },
      empty: str,
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: {
            key: str,
            title: { type: 'string' },
            tone: { anyOf: [tone, { type: 'null' }] },
            icon: { type: 'string', pattern: '^(mdi|si):[a-z0-9-]+$', description: 'Glyph at the start of the row, e.g. mdi:pause' },
            subtitle: str,
            value: { type: ['number', 'string', 'null'] },
            format,
            href: str,
            time: { type: ['string', 'number', 'null'] },
            badge: {
              type: 'object',
              additionalProperties: false,
              required: ['text'],
              properties: { text: { type: 'string' }, tone: { anyOf: [tone, { type: 'null' }] } }
            },
            progress: {
              type: 'object',
              additionalProperties: false,
              required: ['value'],
              properties: {
                value: { type: 'number' },
                max: { type: 'number' },
                start: { type: 'number', description: 'With end (epoch ms): the bar fills by time, live in the browser' },
                end: { type: 'number' }
              }
            },
            actions
          }
        }
      }
    }
  },
  progress: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'items'],
    properties: {
      type: { const: 'progress' },
      actions,
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'value'],
          properties: {
            label: { type: 'string' },
            value: num,
            max: num,
            format,
            detail: str,
            warn: num,
            crit: num
          }
        }
      }
    }
  },
  text: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'text'],
    properties: { type: { const: 'text' }, text: { type: 'string' }, tone, mono: { type: 'boolean' }, actions }
  },
  log: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'lines'],
    properties: {
      type: { const: 'log' },
      actions,
      follow: { type: 'boolean' },
      lines: {
        type: 'array',
        items: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              additionalProperties: false,
              required: ['text'],
              properties: { text: { type: 'string' }, time: { type: ['string', 'number', 'null'] }, tone }
            }
          ]
        }
      }
    }
  },
  custom: {
    type: 'object',
    required: ['type'],
    properties: { type: { const: 'custom' } }
  }
})

/** @type {Map<string, import('ajv').ValidateFunction>} */
const validators = new Map()

/**
 * @param {unknown} view
 * @returns {string | null} what is wrong, or null
 */
export function viewError (view) {
  if (view === null || view === undefined) return null
  const type = /** @type {any} */ (view)?.type
  if (typeof view !== 'object' || !VIEW_SCHEMAS[type]) {
    return `render() must return null or a view with type ${Object.keys(VIEW_SCHEMAS).join(' | ')}, got ${JSON.stringify(view)?.slice(0, 80)}`
  }
  const validate = validators.get(type) ?? createAjv().compile(VIEW_SCHEMAS[type])
  validators.set(type, validate)
  if (validate(view)) return null
  const errs = formatAjvErrors(validate.errors ?? []).slice(0, 3).map(e => `${formatPath(e.path) || 'view'}: ${e.message}`)
  return `invalid "${type}" view: ${errs.join('; ')}`
}
