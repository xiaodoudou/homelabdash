# homelabdash for coding agents

Self-hosted dashboard. Node.js 24 (ESM, plain JavaScript with JSDoc types), Express 5 and `ws` on the server; the page is Vue 3 built by Vite. The server and plugins have no build step: what is in the repo is what runs. The page is built from `web/` into `dist/` by `npm run build` (run once by `npm install`, and by the Dockerfile).

## Commands

| | |
|---|---|
| `npm run dev` | Vite on :3000 (page hot reload) in front of the server on :3001 with `examples/config`, every upstream mocked (`dev/mock-upstreams.js`); plugins and config hot-reload |
| `npm run dev:showcase` | the same with `examples/showcase`, a full homelab with every plugin |
| `npm run docs:screenshots` | retakes `docs/ui/*.png` from the showcase (needs Chrome, Chromium or Edge) |
| `npm test` | server, contract and plugin tests (`node:test`), about 20 s |
| `npm run test:frontend` | page tests (Vitest, jsdom, Vue Test Utils) in `test/frontend/` |
| `npm run build` | builds the page into `dist/`, which the server serves |
| `npm run check` | lint + typecheck + privacy + tests; must pass before any commit |
| `node bin/homelabdash.js validate --config-dir DIR` | config errors as `file:line:col path: message` |
| `node bin/homelabdash.js plugin run <id>` | runs a plugin's first example against its fixtures and prints views, alerts, data |
| `node bin/homelabdash.js plugin test [id]` | contract check + the plugin's own tests |
| `node bin/homelabdash.js plugin info <id>` | schemas, actions, jobs, examples of an installed plugin |

## Layout

```
bin/homelabdash.js     CLI entry, commands in src/cli/main.js
src/core.js            wires config + plugins + runtime + server; hot reload of the config folder
src/config/            load.js (YAML, includes, secrets, line numbers), validate.js (plugin schemas), base-schema.js
src/plugins/           registry.js (discovery), host.js (one worker thread per plugin), worker.js (runs plugin code),
                       io.js (ctx.http/ws/ssh/tcp/ping/dns/exec + fixture replay), contract.js (checks every plugin)
src/runtime/           runtime.js (polling, streams, jobs, tile states), alerts.js, history.js (graphs), cron.js, store.js, icons.js
src/server/app.js      HTTP API, static web/, /api/ws WebSocket
src/views/schema.js    JSON Schema of every view type; enforced on every render
web/src/               main.js, App.vue, store.js (state, WebSocket, watchdog, actions), arrange.js (layout as data),
                       layout.js (row packing), views.js (view helpers), format.js, theme.css, components/ (TileCard, MergedCard,
                       TopChips, views/ with StatsView, ListView, SparkLine, CountDown...)
dist/                  built page (npm run build), not in git
plugins/<id>/          builtin plugins: index.js, README.md, fixtures/*.json, plugin.test.js
sdk/index.d.ts         the plugin contract (types only; plugins import nothing from core)
sdk/testing.js         runPlugin(), used by plugin tests and the CLI
templates/plugin/      scaffold for `plugin new`
examples/config/       commented demo config used by `npm run dev`
examples/showcase/     full homelab used by `npm run dev:showcase` and the screenshots
dev/                   mock-upstreams.js (every service from fixtures, HTTP/SSH/TCP), dev.js
scripts/               privacy-check.js, commitlint.js, release-notes.js, screenshots.js, prepare.js
test/frontend/         page tests (Vitest)
docs/                  start/, reference/, operations/, extending/, contributing/ (map in docs/README.md)
```

## How it works

A **source** is one plugin instance with its connection config. It is fetched once per interval no matter how many tiles use it. A **tile** shows one view rendered from a source with per-tile `options`. Plugins run in worker threads (a crash or hang restarts that worker only), return plain data, and `render()` turns data into a view made of core primitives (`stats`, `list`, `progress`, `text`, `log`). The server pushes tile changes to browsers over a WebSocket. Streams run only while a browser is connected. Jobs run on cron schedules and keep their results in `ctx.state`.

Secrets are resolved server-side (`${secret:NAME}`) and allowed only in a source `config` or `settings.auth`. Values sent to the browser are redacted.

## Writing or changing a plugin

Read `skills/homelabdash-create-plugin/SKILL.md` first; it is the checklist. The essentials:

- One folder `plugins/<id>/` (builtin) or `<config>/plugins/<id>/` (user). `id` equals the folder name.
- `config` and `options` are JSON Schemas with `additionalProperties: false`, so typos in YAML get caught.
- Every enum value of `options` (e.g. `metric`) must be rendered by one of `examples`; the contract test enforces it.
- All network access goes through `ctx.http`, `ctx.ws`, `ctx.ssh`, `ctx.tcp`, `ctx.ping`, `ctx.dns` or `ctx.exec`, so fixtures can replay it. Record responses in `fixtures/*.json`; keys are `GET /path`, `POST /path#operationName`, `STREAM /path`, `WS /path`, `SSH <command>`, `TCP host:port`, `EXEC <command>`.
- Views must match `src/views/schema.js`. Unknown keys fail the tile on purpose.
- Fixtures and examples use `*.example` hosts and 192.0.2.x addresses only.

## Rules

- `npm run check` passes before you hand work back. If a test fails, report it with the output; do not weaken the test.
- No personal data in the repository: no real hostnames, LAN addresses, keys, tokens or user names. `scripts/privacy-check.js` runs in the pre-commit hook and in CI; never bypass it. Real configs live outside the repo.
- Do not use em dashes, en dashes or middle dots in code, comments or docs (the privacy check flags them).
- The server and plugins stay build-free: no bundler, no TypeScript sources. The page is Vue 3 single-file components (`<script setup>`, no scoped styles: `theme.css` and `custom.css` style it by class name); logic that needs no Vue goes in plain modules with tests in `test/frontend/`.
- Comments explain why, in one line, only where the code cannot. Match the surrounding density.
- New core behaviour gets a test in `test/`; a new plugin gets fixtures, examples, a README and `plugin.test.js`.

## Commits and branches

- Commit messages follow Conventional Commits: `type(scope): description`, at most 100 characters, no final period, present tense. Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert. The scope is a plugin id or `config`, `runtime`, `server`, `web`, `cli`, `sdk`, `examples`, `release`. The body says why. `scripts/commitlint.js` checks it in the commit-msg hook and in CI.
- Work goes on `dev` (or a `feat/...`, `fix/...` branch from it). `main` only receives squashed release commits. Do not commit or push unless asked.
- A user-visible change adds a line under Unreleased in `CHANGELOG.md`, written for the person running the dashboard.

## Docs and screenshots

- Docs live in `docs/` (map in `docs/README.md`); a change to config keys, views, the API or the CLI updates the matching reference page in the same commit. Plugin READMEs document their own options.
- Screenshots come only from the showcase (`npm run docs:screenshots`), never from a real dashboard, and are looked at before they are committed.
