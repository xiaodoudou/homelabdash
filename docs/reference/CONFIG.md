← [Documentation](../README.md)

# Config reference

Everything lives in the config folder, `/config` in Docker:

| File | What it is |
|---|---|
| `homelabdash.yaml` | the dashboard: settings, sources, pages |
| `secrets.yaml` | `NAME: value` pairs read by `${secret:NAME}`; keep it out of git |
| `*.yaml` listed in `include` | more sources and pages, merged into the main file |
| `plugins/<id>/` | your own plugins, hot-reloaded |
| `icons/` | your own icon files, used by name (`nas.png`) |
| `custom.css`, `custom.js` | loaded by the page after its own files, reloaded on save |

The page follows every save. `homelabdash validate` checks the whole folder in one run and prints each problem as `file:line:col path: message`, and `homelabdash schema` writes a JSON Schema that includes every installed plugin's settings, so an editor with YAML support can complete keys and underline mistakes. For that, make `# yaml-language-server: $schema=./.schema/config.schema.json` the first line.

## Top level

```yaml
settings: {}           # optional, see below
include: [pages/*.yaml]
sources: {}            # one entry per service connection
pages: []              # several pages, shown as tabs
sections: []           # or this, for a single page
```

## settings

| Key | Default | |
|---|---|---|
| `title` | `homelabdash` | name in the header and the browser tab |
| `theme` | `auto` | `auto` follows the system, or `dark`, `light` |
| `accent` | `#38bdf8` | CSS color for links, graphs and icons without a color of their own |
| `density` | `comfortable` | `compact` tightens padding and type |
| `target` | `_blank` | where tile links open, `_blank` or `_self`; a tile can override it |
| `defaultInterval` | `30s` | polling interval of a source whose plugin and config set none |
| `idleInterval` | `5m` | polling interval while no browser has the page open |
| `timeout` | `10s` | how long a fetch may take before it fails |
| `containerSource` | the only `docker` source | the source that the tile shorthand `container:` asks |
| `auth` | none | `{ type: basic, username, password }` or `{ type: header, header: Remote-User }`, see [Deploying](../operations/DEPLOY.md#who-can-reach-it) |

Durations are written `500ms`, `15s`, `2m`, `1h`, `1d`, or as a number of milliseconds.

## sources

```yaml
sources:
  nas:                                   # the id tiles refer to: lower case, digits, . _ -
    plugin: unraid
    name: Tower                          # optional, shown in alerts instead of the id
    interval: 15s
    timeout: 20s
    enabled: true
    config:
      url: http://tower.example
      apiKey: "${secret:UNRAID_API_KEY}"
    jobs:
      df: { schedule: "0 */2 * * *" }    # change a job's schedule, or { enabled: false }
```

`config` is checked against the plugin's own schema, so an unknown key or a wrong value fails `validate` with the plugin's description of what it expects. The plugin's README lists its settings, and so does `homelabdash plugin info <id>`.

The builtin `alerts` source needs no entry.

## pages and sections

For a single page, `sections:` at the top level is enough. Several pages go under `pages:`, and the header shows them as tabs:

```yaml
pages:
  - id: home
    title: Home
    icon: mdi:home
    sections: [...]
  - id: network
    title: Network
    sections: [...]
```

A section holds `tiles`, or groups under `sections`, or just a `source` for one tile that spans the row.

| Section key | |
|---|---|
| `title`, `icon` | heading of the section |
| `tiles` | the tiles, laid out by content width (see [Concepts](../start/CONCEPTS.md#how-a-page-is-laid-out)) |
| `sections` | groups, side by side under this heading; a group has `title`, `icon`, `tiles`, `merge`, `width`, `hideWhen`, `layout` |
| `source`, `options` | shorthand for one full-width tile of that source |
| `merge` | `true` draws the tiles as one card ([merged cards](../start/CONCEPTS.md#merged-cards)); works on groups too |
| `width` | on a group, its share of the row, such as `45%`; see [Setting widths](#setting-widths) |
| `placement` | `top` puts the section in the header as chips that open a list (meant for alerts); top-level sections only |
| `hideWhen` | `empty` hides the section when none of its tiles has anything to show; the default is `empty` for a section with groups and for the alerts section, `never` otherwise (groups included) |
| `layout` | `{ columns: 4 }` or `{ minTileWidth: 220 }` for a plain grid instead of content widths, `gap` in pixels |
| `id` | tile ids are built from the page, section and tile titles; a fixed `id` keeps them, and the graph history that goes with them, when you rename the section |

## tiles

```yaml
tiles:
  - title: CPU
    icon: mdi:cpu-64-bit#38bdf8
    href: http://tower.example/Dashboard
    source: nas
    options: { metric: cpu }
    graph: true
```

| Tile key | |
|---|---|
| `title`, `icon` | heading of the tile |
| `href`, `target` | the title becomes a link; `target` overrides `settings.target` |
| `source` | id of a source, or `alerts` |
| `options` | what the tile shows, checked against the plugin's schema |
| `plugin`, `config`, `interval` | an inline source used by this tile only, instead of `source` |
| `description` | text under the title of a link tile |
| `container` | status dot for this Docker container, from `settings.containerSource` |
| `status` | `{ source, key }`: status dot from any plugin that provides one |
| `graph` | `true` graphs every number of the tile for the last hour, or a list of stat labels such as `[Down, Up]` |
| `span` | `2` to `12` to widen the tile, `full` for the whole row |
| `width` | its share of the row, such as `30%`, used as given; see [Setting widths](#setting-widths) |
| `hideWhen` | `empty` hides it when it has nothing to show (no stream playing, all zero), `error` hides it while it fails |
| `id` | a fixed id keeps the tile's graph history when you rename it, and lets the API refer to it by name |

### Setting widths

By default each tile and group is as wide as its numbers need, and the page shares out what is left. When you would rather decide, give a group or a tile a `width` in percent of the row:

```yaml
sections:
  - title: System
    sections:
      - { title: Unraid, merge: true, width: 55%, tiles: [...] }
      - { title: AI system, merge: true, width: 25%, tiles: [...] }
      - { title: Power, width: 20%, tiles: [...] }
```

- Groups and tiles with a width keep it. The ones without share the rest of the row.
- Neighbours with a width stay on one row as long as they add up to 100% or less.
- A width is rounded to the page's columns: 24 on a wide screen, so steps of about 4%. On a phone, where everything stacks, it is ignored.
- Inside a group with a width, its tiles share that width. Within a tile, the numbers share spare room evenly.
- A width narrower than the numbers need cuts them off at the edge, so leave a little room.

## Icons

| Form | Example | |
|---|---|---|
| `mdi:<name>` | `mdi:harddisk` | [Material Design Icons](https://pictogrammers.com/library/mdi/), bundled |
| `si:<name>` | `si:plex` | [Simple Icons](https://simpleicons.org/) brand glyphs, bundled |
| `di:<name>` | `di:sonarr`, `di:clash.png` | [dashboard-icons](https://github.com/homarr-labs/dashboard-icons), full-color logos, downloaded once and cached in `/data` |
| a file name | `nas.png` | `config/icons/nas.png`, else the dashboard-icons logo of that name |
| a path or URL | `/logo.svg`, `https://...` | used as is |

`mdi:` and `si:` icons are drawn in a single color, either the accent or whatever you add after `#`, as in `mdi:cpu-64-bit#38bdf8`. If you stick to those two, each with its own color, every icon on the page has the same style. The homepage forms `mdi-cpu-64-bit-#38bdf8` and `plex.png` work too.

## Secrets and environment

On the server, `${secret:NAME}` is replaced by the first of: `NAME` in `secrets.yaml`, the environment variable `HOMELABDASH_SECRET_NAME`, the file `/run/secrets/NAME`. It's only allowed inside a source's `config` and in `settings.auth`, and `validate` refuses it anywhere else, because other values are sent to the browser. Secret values are also scrubbed from errors, logs and `/api/debug`.

`${env:NAME}` works anywhere in the file and is replaced by the environment variable `NAME`; use it for values that aren't secret.

## include

```yaml
include: [pages/*.yaml, network.yaml]
```

Included files can only hold `sources:` and `pages:`, which are merged into the main file. Errors still point at the right file and line.

## Coming from gethomepage

| homepage | homelabdash |
|---|---|
| a group in `services.yaml` | a section; nested groups become groups (`sections:`) or pages |
| `href`, `icon`, `description` of a service | the same keys on a tile |
| `server` + `container` | `container: <name>` on the tile, with one `docker` source |
| `widget: { type: customapi, url, mappings }` | an `http-json` source and `options.items`, one JSONata `value` per mapping, with no limit on the number of fields |
| several customapi calls merged by a cron script | one `http-json` source with `requests:` |
| widget types `unraid`, `glances`, `tautulli`, `sonarr`... | the plugin of the same name; all tiles of a server share one fetch |
| `refreshInterval` | `interval` on the source, honoured by every plugin |
| `layout:` with `style: row` and `columns` per group | a section with groups; widths follow content, nothing to keep in sync |
| `widgets.yaml` | ordinary tiles |
| `bookmarks.yaml` | a section of link tiles |
| API keys inline | `secrets.yaml` and `${secret:NAME}` |
| `custom.css`, `custom.js` | the same files in the config folder; usually no longer needed |
