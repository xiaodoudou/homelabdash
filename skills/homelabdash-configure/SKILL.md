---
name: homelabdash-configure
description: Edit a homelabdash dashboard configuration (homelabdash.yaml): add services, tiles, sections and pages, wire secrets, change layout or theme, set container status dots, override plugin job schedules, or migrate a gethomepage (homepage) services.yaml / widgets / customapi setup. Use when the user wants to show something new on the dashboard, rearrange it, or fix a config error.
---

# Configure homelabdash

Everything lives in the config folder (`/config` in Docker): `homelabdash.yaml`, optional included files, `secrets.yaml`, `plugins/`, `icons/`, `custom.css`, `custom.js`. The dashboard reloads on save. A broken edit never takes the page down: the last valid config keeps running and the page shows the errors with file and line.

Always finish with `homelabdash validate` (in Docker: `docker exec homelabdash homelabdash validate`). It reports every problem in one run as `file:line:col path: message`, including unknown keys in a plugin's `config` or a tile's `options`.

## Model

```yaml
settings:
  title: Homelab
  theme: auto              # auto | dark | light
  accent: "#38bdf8"
  density: comfortable     # or compact
  defaultInterval: 30s     # polling when a source and its plugin set none
  idleInterval: 5m         # polling while no browser is open
  auth: { type: basic, username: me, password: "${secret:DASH_PASSWORD}" }   # or { type: header, header: Remote-User }

include: [pages/*.yaml]    # optional: more files with `sources:` and `pages:`

sources:                   # one per service connection; fetched once per interval for all its tiles
  nas:
    plugin: unraid
    interval: 15s
    config: { url: http://tower.example, apiKey: "${secret:UNRAID_API_KEY}" }
    jobs: { some-job: { schedule: "0 * * * *" } }   # override or `enabled: false`

pages:                     # or top-level `sections:` for a single page
  - id: home
    title: Home
    sections:
      - { title: Alerts, source: alerts, placement: top } # built-in; chips in the header, gone when empty
      - title: Library                                    # a band: its groups sit side by side
        sections:
          - { title: Missing, merge: true, tiles: [{ title: Movies, source: radarr }, { title: Episodes, source: sonarr }] }   # one card
          - { title: Downloading, tiles: [{ title: SABnzbd, source: sab }] }
      - title: Server
        icon: mdi:server
        tiles:                                             # tiles size to their content and share each row
          - { title: CPU, icon: mdi:cpu-64-bit, source: nas, options: { metric: cpu }, href: http://tower.example/Dashboard }
          - { title: Plex, icon: di:plex, href: http://plex.example, container: plex }   # link + docker status dot
          - { title: Ping, plugin: http-json, config: { url: http://x.example/health }, options: { text: status } }  # inline source
          - { title: Log, source: router, options: { view: log }, span: full }
```

Layout: a section holds `tiles`, or `sections` (groups, one level deep, shown side by side under the section title), or `source` (one full-width tile). Tiles take the width their content needs (a four-value tile is wider than a link) and share each row; `span: 2` widens one, `span: full` gives it the whole row. `layout: { columns: 4 }` or `layout: { minTileWidth: 220 }` switches a section to a fixed grid instead. `merge: true` on a group or section shows its tiles as one card. A tile with a single stat becomes a compact cell (icon, value, title; with two such cells the icons sit on the outer edges); any other view (a list, several stats with graphs) keeps its full body under a small heading. Each cell keeps its own source and link; to split one source into cells, give each tile its own options (e.g. seerr `stats: [pending]`). `placement: top` (top-level sections only) moves a section into the header bar: its list items become chips and a click opens the full list over the page, so nothing below shifts when alerts come and go.

Graphs: `graph: true` on a tile keeps an hour of history of its numeric stats (one point per 10 s, kept across restarts) and draws a sparkline under each value; `graph: [CPU, Temp]` limits it to those stat labels. Works with any plugin that returns a `stats` view.

Tile keys: `title`, `icon`, `href`, `target`, `description`, `source` (or inline `plugin` + `config` + `interval`), `options`, `container` or `status: { source, key }`, `span` (1-12 or `full`), `hideWhen` (`never`, `empty`, `error`), `graph` (`true` or stat labels), `id` (stable id, needed only to reference a tile elsewhere).

Icons: `mdi:<name>` (Material Design Icons), `si:<name>` (Simple Icons), `di:<name>` (dashboard-icons, full-color logos, cached), `file.png` from `config/icons/`, or a URL. Add `#rrggbb` to color `mdi:`/`si:`; using `mdi:`/`si:` everywhere, each with its own color, keeps the page consistent. homepage forms (`mdi-name-#color`, `plex.png`) also work.

Secrets: `${secret:NAME}` reads `secrets.yaml` (`NAME: value`), then `HOMELABDASH_SECRET_NAME`, then `/run/secrets/NAME`. Only allowed inside a source `config` or `settings.auth`; validate refuses them elsewhere because other values reach the browser. `${env:NAME}` works anywhere for non-secret values.

## Picking a plugin

`homelabdash plugin list` shows what is installed; `plugins/<id>/README.md` or `homelabdash plugin info <id>` gives config, options and examples. Builtin: `adguard`, `apcupsd`, `arr` (Radarr, Sonarr, Lidarr, Readarr), `docker`, `glances`, `http-json` (any JSON API, several requests, JSONata), `mihomo`, `npm` (Nginx Proxy Manager), `openwrt`, `qbittorrent`, `sabnzbd`, `seerr`, `ssh`, `sub-quota`, `tautulli`, `unraid`. Buttons that change something upstream need a flag in the source config (`allowControl`, `allowApprove`); Unraid's Archive is on unless `notifications.archive: false`. When nothing fits and `http-json` would need contortions, write a plugin (skill `homelabdash-create-plugin`). Full table: `docs/reference/PLUGINS.md`; every config key: `docs/reference/CONFIG.md`.

`http-json` cheat sheet: `requests: { a: {...}, b: {...} }` makes the data `{ a, b }`; tile `options.items: [{ label, value: "a.total + b.total" }]`; `response: true` keeps headers; `transform` reshapes once per fetch; `alerts` is a JSONata expression returning `[{ id, message }]`.

## Migrating from gethomepage

| homepage | homelabdash |
|---|---|
| `services.yaml` group | section (nested groups become sections or pages) |
| service `href`, `icon`, `description` | tile `href`, `icon`, `description` |
| `server` + `container` | tile `container: <name>` with one `docker` source |
| `widget: { type: customapi, url, mappings }` | `http-json` source + tile `options.items` (one JSONata `value` per mapping, no 4-field limit) |
| several customapi calls merged by a cron job into one JSON | one `http-json` source with `requests:` |
| widget types `unraid`, `glances` | the `unraid` and `glances` plugins (all tiles of a server share one query) |
| `refreshInterval` | source `interval` (honoured by every plugin) |
| nested groups + `layout:` with `style: row` and `columns` per group | a section with `sections:` (groups side by side); no column counts to keep in sync |
| `widgets.yaml` info widgets | regular tiles |
| `custom.css`, `custom.js` | same files, same folder; usually no longer needed |
| `bookmarks.yaml` | a section of link tiles |
| API keys inline | `secrets.yaml` + `${secret:NAME}` |

Keep homepage running until the new page shows the same numbers.

## Checks before handing back

- `homelabdash validate` prints `ok`.
- No real secret values in `homelabdash.yaml`; they are in `secrets.yaml`.
- If the user's config folder is under git, `secrets.yaml` is ignored.
