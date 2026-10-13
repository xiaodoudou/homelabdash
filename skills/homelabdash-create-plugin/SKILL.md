---
name: homelabdash-create-plugin
description: Create or change a homelabdash plugin (Node.js) that shows data from a service on the dashboard, with fixtures, examples and tests. Use when the user wants a new tile for an app or device (an *arr, a router, a NAS, a UPS, a media server...), wants to poll an API, follow a log over SSH, stream realtime data from a WebSocket, run a scheduled job, add an action button, raise alerts, or fix a plugin that errors or renders blank.
---

# Create a homelabdash plugin

A plugin is one folder with an `index.js` that `export default`s a plain object. It runs in its own worker thread, talks to the network only through `ctx`, returns data, and renders that data into views the dashboard already knows how to draw. You never write frontend code.

Where it goes:
- inside the homelabdash repository: `plugins/<id>/` (builtin), scaffold with `node bin/homelabdash.js plugin new <id> --builtin`
- on an installed dashboard: `<config>/plugins/<id>/` (`/config/plugins` in Docker), scaffold with `homelabdash plugin new <id>` (in Docker: `docker exec homelabdash homelabdash plugin new <id>`). It hot-reloads on save.

The full contract is `sdk/index.d.ts`. Read it once; it is short and every field is documented.

## Steps

1. **Find the API.** Get the exact endpoints, auth scheme and one real response for each call. If you can reach the service, record real responses with `homelabdash plugin capture <id> --config '{...}'` once the fetch exists (it scrubs hosts, IPs and key-looking values; review the file anyway).
2. **Scaffold** with `plugin new <id>`. You get `index.js`, `README.md`, `fixtures/http.json`, `plugin.test.js`.
3. **Write `config`** (JSON Schema of the connection: url, keys, options that change what is fetched) and **`options`** (JSON Schema of what one tile shows, usually an enum like `metric` or `view`). Keep `additionalProperties: false` on both. Put defaults in the schema (`default:`); they are applied before your code runs.
4. **Write `fetch(ctx)`**: call the service with `ctx.http.json(url, { auth, query, json })` and return plain data (no class instances, no functions). Read `ctx.tiles` if you only need some endpoints for the tiles that exist. Throw on failure; the core shows the error on the tile, keeps the last data marked stale, and backs off.
5. **Write `render(data, options, ctx)`** returning one view per tile:
   - `{ type: 'stats', items: [{ label, value, format?, unit?, warn?, crit?, invert?, href? }] }`
   - `{ type: 'list', items: [{ title, subtitle?, value?, format?, href?, time?, icon?: 'mdi:pause', badge?: { text, tone? }, progress?: { value, max?, start?, end? }, actions?: [{ action, title, input? }] }], empty?, limit?, dense? }`; `progress.start`/`end` (epoch ms) fill the bar by time in the browser, `dense` puts each row on one line
   - `{ type: 'progress', items: [{ label, value, max?, format?, detail?, warn?, crit? }] }`
   - `{ type: 'text', text, tone?, mono? }` and `{ type: 'log', lines: [{ time?, text, tone? }] }`
   - formats: number, percent, bytes, bits, bitrate, byterate, duration (seconds), clock (seconds as HH:MM:SS), until (timestamp, counts down live in the browser), since (timestamp, elapsed time), relativeTime, date, datetime, temperature, text. Tones: ok, info, warning, error, neutral. Full reference: `docs/reference/VIEWS.md`.
   A key the schema does not know makes the tile show an error: that is deliberate.
6. **Add `examples`**: `[{ title, config, options }]` or `[{ title, config, tiles: [{ id, options }] }]`. Every value of every enum in `options` must appear in at least one example. Use `*.example` hosts and `192.0.2.x` addresses, never real ones.
7. **Record fixtures** in `fixtures/*.json`, one key per call the examples make:
   ```json
   { "GET /api/v3/queue": { "body": { "records": [] } },
     "POST /graphql#Dashboard": { "body": { "data": {} } },
     "GET /api/status": { "status": 503, "body": "down" } }
   ```
   A key can also hold a list of responses, answered in order with the last one repeating, to test a session that expires: `"GET /api/data": [{ "status": 401, "body": "" }, { "body": { "ok": true } }]`.
   Keys match the end of the request path, so `http://host/base/api/v3/queue` matches `GET /api/v3/queue`. Add `?a=1` to match a query parameter, `#Name` to match a GraphQL `operationName`. Other helpers: `STREAM /path` (`{ "lines": [...] }`), `WS /path` (`{ "messages": [...] }`), `SSH <command>` (`{ "stdout": "..." }` or `{ "lines": [...] }`), `TCP host:port` (`{ "response": "..." }`), `PING host` (`{ "ok": true, "ms": 1 }`), `EXEC <cmd args>`.
8. **Run it**: `homelabdash plugin run <id>` prints views, alerts, statuses and data for the first example. `--example 2`, `--options '{"view":"list"}'`, `--job <name>`, `--action <name> --input '{}'`, `--stream 3` (seconds) cover the rest. Iterate until every tile renders what you expect.
9. **Test**: write `plugin.test.js` with `runPlugin(import.meta.dirname, { config, options })` from `homelabdash/testing` and assert real values. Then `homelabdash plugin test <id>` runs the contract check (files, strict schemas, every example renders without error, every enum value covered, jobs and stream run on fixtures) plus your tests. In the repository, finish with `npm run check`.
10. **README.md**: what it shows, a YAML example (source + tiles), a config table, the options, notes about permissions or quirks of the API.

## Beyond polling

- **Realtime**: add `async stream(ctx, emit)`. Keep a connection open (`ctx.ws.connect(url)`, `ctx.http.stream(url)`, `ctx.ssh.lines(target, 'tail -F file')`) and call `emit(data)` or `emit(prev => next)` on each change. Renders are throttled (`throttle: '250ms'`). It stops when nobody has the dashboard open unless `keepStreaming: true`; if it throws or returns it is restarted with backoff. A plugin can have both `fetch` (snapshot) and `stream` (updates).
- **Jobs**: `jobs: { name: { schedule: '*/30 * * * *' | '10m', timeout?, run(ctx) } }` for slow or periodic work. Store results with `ctx.state.set(key, value)` and read them in `fetch` with `ctx.state.get(key)`. The source re-fetches after each job. A job that never ran, or missed its slot while the dashboard was down, runs once at start. Users can override `schedule` or set `enabled: false` per source.
- **Sessions**: keep login tokens in `ctx.state` and log in again when a call returns 401/403.
- **Alerts**: `alerts(data, ctx)` returns `[{ id, severity, title?, message, href?, actions? }]`. They appear in the built-in alerts section. The id must stay the same while the condition lasts and change when it is a new occurrence (include a date or counter), because dismissals are keyed on it. Group repeats into one alert per kind of problem ("3 torrents have missing files", names in the message) instead of one per item.
- **Status dots**: `status(data, key)` returns `'up' | 'down' | 'warn' | 'unknown'` (or `{ state, label }`) for tiles that use `status: { source, key }`.
- **Actions**: `actions: { name: { title, run(ctx, input) } }`. Reference them from list rows (`actions: [{ action: name, title, input }]`), from alerts (`actions: [{ name, input }]`), or from the view itself for buttons under the tile (`return { type: 'stats', items, actions: [{ action: 'pause', title: 'Pause' }] }`); return only the buttons that fit the current state. Anything that changes state upstream must be opt-in through a config flag (see `allowControl` in the docker plugin).
- **Other protocols**: `ctx.tcp.check/request`, `ctx.ping`, `ctx.dns.resolve`, `ctx.exec` (program inside the container). For anything else, a plugin may import npm packages; user plugins can also import the dashboard's own dependencies (jsonata, ws, ssh2, yaml).

## Mistakes the checks catch (avoid them up front)

- Returning `undefined` from `render` for some option value: return a `text` view that explains instead.
- Typos in view keys (`lable`, `itmes`) or wrong types (`value: '42%'` with `format: 'percent'`; pass the number).
- Using global `fetch` or `node:http` directly: fixtures cannot replay it and the contract test fails.
- Real hostnames, IPs or keys in fixtures, examples or README: `scripts/privacy-check.js` blocks the commit.
- An alert id that changes on every fetch (it can never stay dismissed) or never changes (a new occurrence stays hidden).
- Reading secrets from the environment yourself: declare them in `config` and let users write `${secret:NAME}`.
