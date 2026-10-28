← [Documentation](../README.md)

# Architecture

homelabdash runs on Node.js 26. The server and the plugins are plain JavaScript modules with JSDoc types checked by TypeScript, on Express 5 and `ws`, and have no build step: the files in the repository are the ones that run. The page is Vue 3, built by Vite from `web/` into `dist/` with `npm run build`, which `npm install` runs once and the Dockerfile runs in a stage of its own.

## Where things are

```
bin/homelabdash.js      CLI entry; the commands are in src/cli/main.js
src/core.js             wires config, plugins, runtime and server together; watches the config folder
src/config/             load.js (YAML, includes, secrets, line numbers), validate.js (plugin schemas), base-schema.js
src/plugins/            registry.js (finds plugins), host.js (one worker thread per plugin), worker.js (runs plugin code),
                        io.js (ctx.http, ws, ssh, tcp, ping, dns, exec, and fixture replay), contract.js (the contract check)
src/runtime/            runtime.js (polling, streams, jobs, tile states), alerts.js, history.js (graphs), cron.js,
                        store.js (/data), icons.js
src/server/app.js       HTTP API, static files of web/, the /api/ws WebSocket
src/views/schema.js     JSON Schema of every view type, enforced on every render
web/                    the page: index.html, public/, and src/ with main.js, App.vue, store.js (state, WebSocket,
                        reconnects, actions), arrange.js (layout), layout.js (row packing), views.js (view helpers),
                        format.js (formats), theme.css, and components/ (tiles, merged cards, header chips, views/)
dist/                   the built page, served by the server (not in git)
plugins/<id>/           builtin plugins: index.js, README.md, fixtures/*.json, plugin.test.js
sdk/index.d.ts          the plugin contract, types only; plugins import nothing from the core
sdk/testing.js          runPlugin(), used by plugin tests and the CLI
templates/plugin/       the scaffold of `plugin new`
examples/config/        the commented demo of `npm run dev`
examples/showcase/      the full homelab of `npm run dev:showcase` and the screenshots
dev/                    mock-upstreams.js (every service, faked from fixtures), dev.js (runs mocks and server)
scripts/                privacy-check.js, commitlint.js, screenshots.js, prepare.js (git hooks, first build)
test/frontend/          the page tests (Vitest)
```

## From a config file to the page

1. `config/load.js` reads `homelabdash.yaml` and its includes with line numbers, resolves `${secret:...}` and `${env:...}`, and expands the shorthands (top-level `sections:`, a section's `source:`, inline sources, `container:`). Tile ids come from the page, section and tile titles unless set.
2. `config/validate.js` checks the result against `base-schema.js`, then each source's `config` and each tile's `options` against the plugin's own schemas. An error inside one source or tile switches off only that part; anything else keeps the last good config. Errors carry the file, line and column.
3. `plugins/registry.js` finds builtin plugins and the ones in `<config>/plugins` (same id wins). `plugins/host.js` starts one worker thread per plugin and talks to it by messages. A plugin that crashes or hangs past its timeout has its worker restarted, and only its tiles notice.
4. `runtime/runtime.js` keeps one entry per source: when to fetch next, the last data, failures in a row, the stream and the jobs. It fetches each source on its interval, slows everything to `idleInterval` while no browser is connected, retries failures with a growing delay up to 5 minutes, and runs streams only while someone watches. After each fetch it renders every tile of the source, checks each view against `views/schema.js`, records graph points in `runtime/history.js`, and collects alerts in `runtime/alerts.js`.
5. `server/app.js` serves the page and the API. Each browser gets a `hello` with every tile and the graph history, then `tiles` messages with what changed, batched every 40 ms. Secrets never leave the server: the page receives views, not source configs.

## The page

The page is built from Vue 3 single-file components without scoped styles. `theme.css` styles everything through plain class names, which is what lets `custom.css` override any of it. `store.js` holds the state in a few reactive objects (the dashboard, tile states, graph history) and owns the WebSocket, and the components read from it and call its actions.

- The page has 24 columns on a wide screen (12, 6 and 2 on smaller ones). `arrange.js` computes the whole layout as data (the column count, where each group and tile starts and how wide it is, the stat columns of each tile) and the components bind it as styles; `layout.js` packs the tiles of a group into rows, fewest rows first, then the most even fill. Each tile's minimum width comes from measuring its numbers with a canvas, using the widest value their format can take (`888.8 GB`, `88.8%`), so a tile does not change width when its value changes. A tile's width only grows while the page is open, which keeps rows from jumping.
- Merged cards (`merge: true`) render the tiles of a group in one card: compact cells when every tile is a single number, full views otherwise. Below 640 px they stack.
- Header sections (`placement: top`) render list items as chips and open the full list over the page.
- Graphs are `SparkLine.vue`, an SVG with a fixed vertical scale per format and a tooltip on hover.
- `CountDown.vue` and `TimeBar.vue` share a one-second clock that only runs while one of them is on the page; they're the only things that move between fetches.
- The page reconnects when the socket closes, and also when it hasn't heard anything for 45 seconds, so a laptop waking up doesn't sit on old numbers.

## Plugins and their tests

The contract check in `plugins/contract.js` runs for every plugin in `npm test` and in `homelabdash plugin test`: files present, schemas strict, every example renders against the fixtures without errors, every enum value of the options covered, jobs and streams run. `src/plugins/io.js` gives plugins their network helpers and, in tests, answers them from fixtures, which is why a plugin may not use the global `fetch`.

## Choices worth knowing

- One worker thread per plugin: plugin code is the part most likely to hang or throw, and the part people write themselves. A worker keeps it away from the server and from the other plugins, and reloading a plugin is ending its worker and starting a new one, since ES modules cannot be unloaded.
- Plugins return views rather than components, as data shaped like one of a few view types. That keeps every tile looking like the rest, means a plugin author needs no frontend skills, and lets the schema catch a mistake the moment it happens.
- The same recorded answers drive the plugin tests, `plugin run`, the contract check, the dev mocks and the screenshots, so a plugin can be written and tested without ever reaching the service.
- The server and the plugins have no build: JSDoc types give editor help and a typecheck in CI without compiling anything, so a plugin is a file you edit and reload. The page is the one part that gets built, because single-file components are the clearest way to write it, and the image only keeps the built files.
