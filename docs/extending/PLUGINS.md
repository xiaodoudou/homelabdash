← [Documentation](../README.md)

# Writing a plugin

A plugin is a folder with an `index.js` that exports one plain object. That object says what the plugin needs to connect and what a tile can show, fetches the data, and turns it into views. It runs in a worker thread of its own and only reaches the network through `ctx`, and you never write frontend code for it. The whole contract fits in [`sdk/index.d.ts`](../../sdk/index.d.ts), which is short and commented; it's worth reading once.

Your plugins go in `config/plugins/<id>/` and reload when you save. The builtin ones live in the repository's `plugins/<id>/` and follow the same rules, plus a few the repository adds (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).

## The loop

```sh
homelabdash plugin new speedtest    # scaffold
homelabdash plugin run speedtest    # what it renders, from fixtures
homelabdash plugin test speedtest   # the contract check and its own tests
```

In Docker, prefix each of them with `docker exec homelabdash`. The scaffold already works: it fetches `GET /api/items`, has a fixture for it, renders a summary and a list, raises an alert and passes its tests. Change it a piece at a time, running it after each change.

## 1. What it needs: `config`

This is a JSON Schema of the connection: the URL, a key, anything that changes what gets fetched. Keep `additionalProperties: false` so that a typo in someone's YAML fails `validate` instead of being silently ignored. Defaults go in the schema too (`default:`), and they're applied before your code runs.

```js
config: {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri', description: 'Base URL, e.g. http://speedtest.example:8080' },
    apiKey: { type: 'string', description: 'Use ${secret:...}' }
  }
},
```

Don't read secrets from the environment yourself. Declare them here, and people write `apiKey: "${secret:SPEEDTEST_KEY}"` in their config.

## 2. What a tile shows: `options`

Another JSON Schema, this time of the display choices; usually it's a single enum:

```js
options: {
  type: 'object',
  additionalProperties: false,
  properties: { view: { enum: ['latest', 'history'], default: 'latest' } }
},
```

## 3. Fetch

`fetch(ctx)` calls the service and returns plain data, without class instances or functions in it. When something is wrong, throw: the core shows the error on the tiles, keeps the last data marked stale and retries, waiting a little longer each time.

```js
async fetch (ctx) {
  const base = ctx.config.url.replace(/\/+$/, '')
  const latest = await ctx.http.json(`${base}/api/latest`, { auth: { bearer: ctx.config.apiKey } })
  return { down: latest.download, up: latest.upload, ping: latest.ping }
},
```

All network access goes through `ctx`, which is what lets fixtures replay it:

| Helper | For |
|---|---|
| `ctx.http.json(url, { query, json, auth, headers })`, `ctx.http.text`, `ctx.http.request`, `ctx.http.stream` | HTTP, with `auth: { bearer }`, `{ basic: { username, password } }` or `{ header, value }` |
| `ctx.ws.connect(url)` | an upstream WebSocket |
| `ctx.ssh.exec(target, cmd)`, `ctx.ssh.lines(target, cmd)` | commands and long-running output over SSH, with host keys pinned on first use |
| `ctx.tcp.check`, `ctx.tcp.request`, `ctx.ping`, `ctx.dns.resolve` | lower-level checks |
| `ctx.exec(program, args)` | a program inside the container |
| `ctx.state.get(key)`, `ctx.state.set(key, value)` | a small store kept in `/data` across restarts: sessions, counters, job results |
| `ctx.tiles` | the tiles using this source, to fetch only what they need |
| `ctx.log` | messages in the dashboard's log, prefixed with the source id |

A plugin that uses the global `fetch` or `node:http` instead fails the contract test, because fixtures can't replay those calls.

## 4. Render

`render(data, options, ctx)` returns one view per tile. The view types and formats are in [Views and formats](../reference/VIEWS.md).

```js
render (data, o) {
  return {
    type: 'stats',
    items: [
      { label: 'Down', value: data.down, format: 'bitrate' },
      { label: 'Up', value: data.up, format: 'bitrate' },
      { label: 'Ping', value: data.ping, format: 'number', unit: 'ms', warn: 50 }
    ]
  }
},
```

Pass numbers with a format rather than strings: `value: 42, format: 'percent'`, not `'42%'`. If there's an option value you can't show, return a `text` view saying why instead of nothing.

## 5. Examples and fixtures

`examples` are configurations that the contract test renders and `plugin info` prints. Every value of every enum in `options` has to appear in at least one of them, so no display mode ships untested:

```js
examples: [{
  title: 'Latest result and history',
  config: { url: 'http://speedtest.example:8080', apiKey: '${secret:SPEEDTEST_KEY}' },
  tiles: [{ id: 'latest', options: { view: 'latest' } }, { id: 'history', options: { view: 'history' } }]
}],
```

Fixtures are the recorded answers the examples run against, in `fixtures/*.json`, one key per call:

```json
{
  "GET /api/latest": { "body": { "download": 912000000, "upload": 41000000, "ping": 9 } },
  "POST /graphql#Dashboard": { "body": { "data": {} } },
  "GET /api/status": { "status": 503, "body": "down" }
}
```

A key matches the end of the request path; add `?name=value` to match a query parameter, or `#Name` for a GraphQL operation. A list of answers is replayed in order with the last one repeating, which is how you test a session that expires. Other protocols have keys of their own: `STREAM /path` with `lines`, `WS /path` with `messages`, `SSH <command>` with `stdout` or `lines`, `TCP host:port`, `PING host` and `EXEC <command>`.

`homelabdash plugin capture <id> --config '{...}'` calls the real service once and saves its answers as fixtures, with hosts, addresses and key-looking values replaced. Read the file anyway before sharing it, and stick to `*.example` hosts and `192.0.2.x` addresses in examples and fixtures.

## 6. Test

`plugin.test.js` uses `runPlugin` from `homelabdash/testing` and asserts real values:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPlugin } from 'homelabdash/testing'

test('latest result in bits per second', async () => {
  const r = await runPlugin(import.meta.dirname, { config: { url: 'http://speedtest.example:8080' } })
  assert.deepEqual(r.view.items.map(i => i.value), [912000000, 41000000, 9])
})
```

`runPlugin` can also pass `options`, override `fixtures`, start from some `state`, or run a `job`, an `action` or the `stream`. `homelabdash plugin test` then runs your tests along with the contract check: files present, strict schemas, every example rendering, every enum value covered, jobs and the stream running on fixtures.

## Beyond polling

### Alerts

`alerts(data, ctx)` returns `[{ id, severity, title?, message, href?, actions? }]`. Dismissals are keyed on the id, so it has to stay the same while the problem lasts and change when it's a new occurrence; an id that changes on every fetch can never stay dismissed. When the same problem hits several items, raise one alert ("3 torrents have missing files") rather than one each.

### Status dots

`status(data, key)` returns `'up'`, `'down'`, `'warn'` or `'unknown'` for tiles that set `status: { source, key }`.

### Buttons

`actions: { pause: { title: 'Pause', run (ctx, input) {} } }` defines them, and a list row, an alert or the view itself (`actions: [{ action: 'pause', title: 'Pause' }]`) offers them. Only offer the buttons that fit the current state, and keep anything that changes something upstream behind a config flag such as `allowControl: true`, off by default.

### Streams

`async stream(ctx, emit)` keeps a connection open (`ctx.ws.connect`, `ctx.http.stream`, `ctx.ssh.lines`) and calls `emit(data)` or `emit(previous => next)` on each change. It only runs while a page is open, unless the plugin sets `keepStreaming: true`, and if it ends or throws it's restarted after a growing delay. A plugin can have both: `fetch` for the snapshot and `stream` for the changes.

### Jobs

For slow or periodic work, use `jobs: { df: { schedule: '*/30 * * * *', timeout: '5m', run (ctx) {} } }`. Store the result with `ctx.state.set`, read it back in `fetch`, and the source fetches again after each run. A job that missed its slot while the dashboard was down runs once at start, and people can change its schedule or switch it off per source.

### Live values between fetches

A list row can count down in the browser (`format: 'until'` with an end time) and fill its bar by time (`progress: { value, start, end }`), as the Tautulli plugin does for a playing stream.

## Mistakes the checks catch

- A typo in a view key (`lable`, `itmes`) or a value of the wrong type.
- A display mode no example covers.
- A network call that bypasses `ctx`.
- Real hostnames, addresses or keys in fixtures or examples: in the repository, `scripts/privacy-check.js` refuses the commit.
- `render` returning `undefined` for some option.

## With a coding agent

[`skills/homelabdash-create-plugin`](../../skills/homelabdash-create-plugin/SKILL.md) is this page turned into a checklist for an agent, and with Claude Code `/plugin marketplace add xiaodoudou/homelabdash` installs it. Since plugins come with fixtures and a contract test, an agent can write and test one without access to the service, and the checks above catch the usual slips.
