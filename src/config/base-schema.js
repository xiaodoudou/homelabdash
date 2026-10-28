const duration = {
  description: 'Duration such as 500ms, 15s, 2m, 1h, or a number of milliseconds',
  anyOf: [
    { type: 'string', pattern: '^\\d+(\\.\\d+)?(ms|s|m|h|d)$' },
    { type: 'integer', minimum: 0 }
  ]
}

const id = { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*$' }

const icon = {
  type: 'string',
  description: 'mdi:<name>, si:<name>, di:<name> (dashboard-icons), /icons/<file> from the config folder, or a URL. Append #rrggbb to tint mdi/si icons.'
}

const status = {
  description: 'Status dot taken from another source, e.g. a container from the docker source',
  type: 'object',
  additionalProperties: false,
  required: ['key'],
  properties: {
    source: { type: 'string' },
    key: { type: 'string' }
  }
}

// "45%": the share of the row a tile or group takes, used as given instead of the width worked out from its content.
const width = { type: 'string', pattern: '^(100|[1-9][0-9]?(\\.[0-9]+)?)%$', description: 'Share of the row, such as 45%; unset tiles and groups share the rest' }

export const tileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id,
    title: { type: 'string' },
    icon,
    href: { type: 'string' },
    target: { enum: ['_blank', '_self'] },
    description: { type: 'string' },
    source: { type: 'string', description: 'Id of a source in `sources`, or "alerts"' },
    plugin: { type: 'string', description: 'Inline source: plugin id (use with `config`)' },
    config: { type: 'object', description: 'Inline source: plugin config' },
    interval: duration,
    options: { type: 'object', description: 'Display options for the source plugin, see its README' },
    container: { type: 'string', description: 'Shorthand for status: { source: <docker source>, key: <container> }' },
    status,
    span: { anyOf: [{ type: 'integer', minimum: 1, maximum: 12 }, { const: 'full' }] },
    width,
    hideWhen: { enum: ['never', 'empty', 'error'] },
    graph: {
      description: 'Keep an hour of history and draw it: true for every numeric stat, or the labels to graph',
      anyOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string' }, minItems: 1 }]
    }
  }
}

const sectionBase = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id,
    title: { type: 'string' },
    icon,
    source: { type: 'string', description: 'Shorthand for a single full-width tile showing this source' },
    options: { type: 'object' },
    hideWhen: { enum: ['never', 'empty'] },
    collapsed: { type: 'boolean' },
    merge: { type: 'boolean', description: 'Show the tiles as one card: a cell per tile with its icon, first value and title' },
    width,
    layout: {
      type: 'object',
      additionalProperties: false,
      properties: {
        minTileWidth: { type: 'integer', minimum: 80, description: 'Tiles wrap automatically; this is the narrowest a tile gets (px)' },
        columns: { type: 'integer', minimum: 1, maximum: 12, description: 'Fixed column count instead of automatic wrapping' },
        gap: { type: 'integer', minimum: 0 }
      }
    },
    tiles: { type: 'array', items: tileSchema }
  }
}

export const sectionSchema = {
  ...sectionBase,
  properties: {
    ...sectionBase.properties,
    placement: { enum: ['page', 'top'], description: 'top shows the section in the header bar as compact chips (meant for alerts)' },
    sections: {
      type: 'array',
      description: 'Groups shown side by side under this title (each group has its own title and tiles)',
      items: sectionBase
    }
  }
}

export const pageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id,
    title: { type: 'string' },
    icon,
    sections: { type: 'array', items: sectionSchema }
  }
}

export const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['plugin'],
  properties: {
    plugin: { type: 'string' },
    name: { type: 'string', description: 'Display name, used in alerts' },
    config: { type: 'object' },
    interval: duration,
    timeout: duration,
    enabled: { type: 'boolean' },
    jobs: {
      type: 'object',
      description: 'Override the schedule of the plugin\'s jobs, or turn one off',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        properties: {
          schedule: { type: 'string', description: 'Cron expression (5 fields, @hourly, @daily...) or a duration such as 10m' },
          enabled: { type: 'boolean' }
        }
      }
    }
  }
}

export const settingsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    theme: { enum: ['auto', 'dark', 'light'] },
    accent: { type: 'string', description: 'CSS color' },
    density: { enum: ['comfortable', 'compact'] },
    target: { enum: ['_blank', '_self'] },
    defaultInterval: duration,
    idleInterval: { ...duration, description: 'Polling interval while no browser is connected' },
    timeout: duration,
    containerSource: { type: 'string', description: 'Source used by the tile `container` shorthand (default: the only docker source)' },
    auth: {
      oneOf: [
        { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'none' } } },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'username', 'password'],
          properties: { type: { const: 'basic' }, username: { type: 'string' }, password: { type: 'string' } }
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'header'],
          properties: {
            type: { const: 'header' },
            header: { type: 'string', description: 'Header set by a trusted reverse proxy, e.g. Remote-User' }
          }
        }
      ]
    }
  }
}

export const configSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'homelabdash config',
  type: 'object',
  additionalProperties: false,
  properties: {
    settings: settingsSchema,
    include: { type: 'array', items: { type: 'string' }, description: 'Extra YAML files merged into this one (sources and pages)' },
    sources: {
      type: 'object',
      propertyNames: id,
      additionalProperties: sourceSchema
    },
    pages: { type: 'array', items: pageSchema },
    sections: { type: 'array', items: sectionSchema, description: 'Shorthand for a single page' }
  }
}

/** Schema for an included file: same shape, settings and include are not allowed. */
export const includeSchema = {
  ...configSchema,
  title: 'homelabdash included file',
  properties: {
    sources: configSchema.properties.sources,
    pages: configSchema.properties.pages
  }
}
