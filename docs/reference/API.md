← [Documentation](../README.md)

# HTTP and WebSocket API

Everything the page does goes through this API, so scripts and agents can do the same. With `settings.auth` set, every route except `/api/health` needs the same credentials as the page.

POST requests must send `Content-Type: application/json`, and when an `Origin` header is present it must match the `Host` (or `X-Forwarded-Host`). That keeps other sites from triggering actions from a browser.

## Read

| | |
|---|---|
| `GET /api/health` | `{ status: "ok" \| "degraded", version, configVersion, configErrors, sources, failing }`, always 200 |
| `GET /api/dashboard` | layout for the page: settings, pages, sections, tiles (titles, icons, links; never source config), the graph window and step, and current config errors |
| `GET /api/state` | current state of every tile: `{ id, view, error, stale, loading, status }` |
| `GET /api/tiles/:id` | state of one tile |
| `GET /api/plugins` | installed plugins with version, actions, jobs and load errors |
| `GET /api/debug` | sources with last run, duration, error, failures, next run, stream and job state; `?source=<id>&data=1` adds the data the plugin returned (secrets redacted) |

## Act

| | body | |
|---|---|---|
| `POST /api/tiles/:id/refresh` | `{}` | fetches the tile's source now, returns the new tile state |
| `POST /api/tiles/:id/actions/:action` | `{ "input": {...} }` | runs a plugin action on the tile's source; on the alerts tile, `dismiss` with `{ "key" }` or `run` with `{ "key", "name", "input" }` |
| `POST /api/sources/:id/jobs/:job/run` | `{}` | runs a plugin job now |
| `POST /api/reload` | `{}` | re-reads the config folder (it is also watched) |

Errors come back as `{ "error": "message" }` with 400, 404, 415, 403 or 502 (plugin failed).

## WebSocket `/api/ws`

Server to page:

- `{ type: "hello", version, tiles: [TileState], history, configErrors }` on connect; `history` holds the last hour of every graphed stat, `{ [tileId]: { [label]: { t: [ms], v: [values] } } }`
- `{ type: "tiles", tiles: [TileState] }` whenever tiles change (batched every 40 ms); a graphed tile carries `point`, its newest values
- `{ type: "dashboard", version }` after a config change: fetch `/api/dashboard` again
- `{ type: "config-errors", errors }` when an edit is rejected
- `{ type: "assets", file }` when `custom.css` or `custom.js` changed
- `{ type: "result", id, ok, value | error }` answering a request below

Page to server: `{ type: "action", id, tile, action, input }`, `{ type: "refresh", id, tile }`, `{ type: "ping", id }`.

The server pings every socket every 30 seconds and closes the ones that do not answer. The page does the same from its side: after 20 quiet seconds it sends a `ping`, and after 45 it drops the socket and connects again, which sends a fresh `hello`.

While at least one WebSocket is open, sources poll at their own interval and streams run; with none, polling slows to `settings.idleInterval` and streams stop after 30 seconds, unless the plugin sets `keepStreaming`.
