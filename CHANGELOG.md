# Changelog

Changes that people running homelabdash or writing plugins would notice. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-10-28

### Changed

- **Dependencies are up to date.** The image ships chokidar 6, which watches the config folder for hot reload, and newer icon sets. Nothing changes in your config.
- **Plugin errors keep their cause.** When AdGuard Home, HTTP JSON, Nginx Proxy Manager or Unraid turn an error into a clearer message, the original error stays attached, so `/api/debug` and the logs still show where it came from.

## [0.2.0] - 2026-10-28

### Added

- **An AI server on the dashboard: llama-swap, nvidia and comfyui plugins.** llama-swap shows the loaded model, how fast it generates (live while a request runs, estimated from the bytes it streams), how many requests are running, and the GPU, CPU and memory gauges it reports; it never loads a model. nvidia reads each GPU from `nvidia-smi`, over an SSH key that can be locked to that one command. comfyui shows whether it is generating, the queue and the last jobs, and alerts on failed ones, without showing prompts or images. With `allowControl`, llama-swap can unload a model and comfyui can interrupt a job or free its VRAM.
- **Home Assistant plugin.** Lights, switches, sensors, thermostats and people as rows or numbers, a summary of the home, and the updates waiting to be installed. Tiles follow state changes live over Home Assistant's WebSocket API, and with `allowControl` lights, switches, fans, input booleans and automations get an on and off button. See [its README](plugins/homeassistant/README.md).
- **Stop a Plex stream from the dashboard.** With `allowControl: true` on a Tautulli source, each stream playing now gets a Stop button, and `stopMessage` sets what the viewer sees on their player. See [its README](plugins/tautulli/README.md).
- **Buttons that are hard to undo ask first.** A plugin can give a button a `confirm` question: the first click shows it on the button in red, and only a second click within four seconds runs it. Stop on Plex streams and the unload buttons use it.
- **A stat can show two readings.** An item's `detail` is drawn beside its label, so VRAM reads 52% with 12.4 / 24.0 GB next to it, and a missing number keeps its unit (-- tok/s). See [Views](docs/reference/VIEWS.md).
- **The Unraid status tile has links.** The unread count opens the Unraid dashboard, where the bell lists the notifications, and the array state opens the Main tab.

### Changed

- **Page tabs are easy to spot.** With several pages, the header shows the tabs beside the title, the open one in full colour with an accent line under it, and on a phone they get a row of their own.
- **The Unraid template moved** to [xiaodoudou/unraid-templates](https://github.com/xiaodoudou/unraid-templates), where Community Applications picks it up, and gained an icon and screenshots. [Deploying](docs/operations/DEPLOY.md#unraid) shows how to load it by hand.

### Security

- **Password guessing is slowed down.** With `settings.auth` set, 20 refused logins within a minute get an address turned away for the rest of that minute, over HTTP and the WebSocket alike, and every address is capped at 1200 requests a minute. See [Deploying](docs/operations/DEPLOY.md#a-password).
- **SSH keys of the dashboard get their own guide.** [The ssh plugin](plugins/ssh/README.md#an-account-that-can-only-do-this) explains how to give each key an account with no sudo and a forced command, so a leaked key can only run that one read.
- **Two dependencies are patched** against advisories published after 0.1.0: body-parser 2.4.0 fixes a denial of service through a compressed request body, and fast-uri 3.1.9 fixes how some URLs are parsed while the config is validated.

## [0.1.0] - 2026-10-13

The first public version.

### Added

- **The whole dashboard is one YAML file.** Sources connect to your services, tiles show views of them, and sections and groups arrange the tiles. The page follows every save. `homelabdash validate` reports each problem with its file, line and key, and a mistake only switches off the source or tile it's in while the rest keeps running. See [the config reference](docs/reference/CONFIG.md).
- **Tiles take the width their numbers need.** Widths are measured from the widest value a format can take, so a value changing never shifts the page, and there are no column counts to keep in sync. Groups sit side by side under a section title.
- **Related tiles can share a card, and alerts can live in the header.** `merge: true` draws a group as one card: single numbers become compact cells, anything else keeps its full view. `placement: top` turns the alerts into chips in the header that open the full list, so the page doesn't move as alerts come and go. Both adapt to phones.
- **Everything updates live.** The server polls each source on its own interval and pushes changes over a WebSocket, and Docker events, SSH log tails and upstream streams update their tiles as things happen. If the connection drops or goes quiet (after a laptop sleeps, say), the page reconnects on its own.
- **Tiles can graph their last hour.** `graph: true` draws a line under each value, on fixed scales so a bit of noise doesn't look like a spike. The history survives restarts.
- **Dismissed alerts stay dismissed everywhere.** Plugins raise alerts, the builtin `alerts` source gathers them, and a dismissal is kept on the server, across browsers and restarts, until the alert stops firing.
- **16 plugins come built in:** AdGuard Home, apcupsd, the arrs (Radarr, Sonarr, Lidarr, Readarr), Docker, Glances, any JSON API (`http-json`), mihomo, Nginx Proxy Manager, OpenWrt, qBittorrent, SABnzbd, Seerr, SSH, proxy subscription quotas, Tautulli and Unraid. Buttons that change something upstream stay off until you set a flag. See [the plugin list](docs/reference/PLUGINS.md).
- **You can write your own plugins.** A plugin is a folder with an `index.js`, running in its own worker thread. `homelabdash plugin new`, `run`, `test` and `capture` scaffold one, show what it renders, check it against the contract and record real responses as fixtures. See [Writing a plugin](docs/extending/PLUGINS.md).
- **Secrets stay on the server.** `${secret:NAME}` reads `secrets.yaml`, an environment variable or a Docker secret, only inside a source's settings, and secret values are scrubbed from errors, logs and the debug API.
- **The dashboard can sit behind a login.** `settings.auth` takes a password or the header of an identity proxy such as Authentik or Authelia. Requests that change something must come from the dashboard's own origin, which still works behind proxies that drop the port from the `Host` header.
- **It ships as a Docker image** for amd64 and arm64, running as a non-root user with a health check, along with a docker compose example and an Unraid template. See [Deploying](docs/operations/DEPLOY.md).
- **It needs Node.js 24.** The image runs on it, and so does a clone: `npm install` builds the page (Vue 3 with Vite) once, and `npm run dev` serves it with hot reload.
- **Coding agents get skills.** The repository is a Claude Code plugin marketplace with skills to write plugins, edit the config and deploy, and `AGENTS.md` describes the code for any agent.
- **A showcase runs on fake services.** `npm run dev:showcase` starts a full homelab against recorded responses, and `npm run docs:screenshots` takes the documentation pictures from it.

[Unreleased]: https://github.com/xiaodoudou/homelabdash/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/xiaodoudou/homelabdash/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xiaodoudou/homelabdash/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/xiaodoudou/homelabdash/releases/tag/v0.1.0
