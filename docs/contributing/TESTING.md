← [Documentation](../README.md)

# Testing

```sh
npm run check           # lint, typecheck, privacy check, then every test
npm test                # the server and plugin tests, about 20 seconds
npm run test:frontend   # the page tests, a few seconds
```

`npm run check` has to pass before a commit. CI runs the same on Node 24, and also builds the page, scans the history for secrets and smoke-tests the Docker image.

## What the tests cover

The server and plugin tests use `node:test` and need no service: every network call is answered from fixtures. The page tests use Vitest with jsdom and Vue Test Utils.

| File | Covers |
|---|---|
| `test/config.test.js` | YAML loading, includes, secrets, shorthands, line numbers in errors, plugin schemas |
| `test/runtime.test.js` | one fetch per source, failures and backoff, hanging plugins, jobs, streams only while watched, partial restarts on config changes |
| `test/server.test.js` | the API and WebSocket on a real server against the mocks: config isolation, hot reload, auth, the origin check |
| `test/alerts.test.js` | alerts, dismissals kept across restarts, dismissals dropped when the alert clears |
| `test/history.test.js` | graph history: one point per step, the window, persistence |
| `test/registry.test.js`, `test/cron.test.js` | user plugins overriding builtin ones, cron expressions and durations |
| `test/plugins.contract.test.js` | the contract check on every builtin plugin |
| `plugins/<id>/plugin.test.js` | each plugin against its fixtures, with real values asserted |
| `test/frontend/helpers.test.js` | formats, view helpers, row packing |
| `test/frontend/arrange.test.js` | the layout: columns per width, groups side by side, widths that only grow, merged cards |
| `test/frontend/store.test.js` | tile updates, graph points, `hideWhen`, the reconnect watchdog, actions |
| `test/frontend/components.test.js` | the countdown and time-filled bar, stats cells, merged cards, header chips on a phone |

When a test fails, fix the cause or report it, but don't loosen the assertion until it passes. Tests that depend on time compare against the time they actually measured, never against a guess of how fast the machine is.

## The privacy check

`scripts/privacy-check.js` refuses private IPv4 addresses, key-looking values and private keys in anything about to be published, along with every pattern in your own `.privacy-denylist` (gitignored, one literal or `/regex/` per line, for your domain, LAN prefix or user names). The three private ranges written whole, as in an allow-list, are fine. It also flags em dashes, en dashes and middle dots, and runs both in the pre-commit hook and in CI. Examples and fixtures use `*.example` hosts and the documentation addresses `192.0.2.x`.

## Running against fake services

`dev/mock-upstreams.js` serves every builtin plugin's fixtures over HTTP (port 4100, under `/<plugin>/`), SSH (4122) and TCP (4135, for apcupsd). It nudges some numbers (CPU, memory, traffic, connections, bandwidth) and flips a container every 20 seconds, so graphs and live updates have something to show.

```sh
npm run dev             # examples/config, the commented demo
npm run dev:showcase    # examples/showcase, the full homelab of the screenshots
```

Both put Vite with hot reload on port 3000 in front of the server, which restarts when `src/` changes and hot-reloads the config and the builtin plugins.

## Screenshots of the documentation

The pictures in `docs/ui/` come from the showcase, so they only show fake services, `.example` hosts and documentation addresses. Don't take documentation screenshots of a real dashboard.

```sh
npm run docs:screenshots
```

It builds the page, starts the mocks and the showcase, keeps a page connected for three minutes so the graphs fill, then drives a headless Chrome, Chromium or Edge (`CHROME=/path/to/browser` to choose) over the DevTools protocol and writes:

| File | |
|---|---|
| `dashboard-dark.png`, `dashboard-light.png` | the whole page at 1600 px wide, in both themes |
| `alerts-dark.png` | the header with the alerts list open |
| `phone-dark.png` | the top of the page on a phone, at twice the pixel density |

`--wait 30` shortens the wait, and `--url http://127.0.0.1:3000 --wait 0` shoots a showcase you already have running with `npm run dev:showcase`. Either way, look at every picture before you commit it.
