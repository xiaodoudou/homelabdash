← [homelabdash](../README.md)

# Documentation

If homelabdash is new to you, start with the first two pages. Everything after them is reference, so jump to whichever page answers your question.

## Start

| Page | Read it to |
|---|---|
| [Getting started](start/GETTING_STARTED.md) | run the showcase, then your own dashboard with Docker, add the first services and make it your new tab page |
| [Concepts](start/CONCEPTS.md) | understand sources, tiles, groups, merged cards, alerts, graphs and how updates reach the page |

## Reference

| Page | Read it to |
|---|---|
| [Config](reference/CONFIG.md) | look up any key of `homelabdash.yaml`, icons, secrets, includes, and the gethomepage mapping |
| [Plugins](reference/PLUGINS.md) | see the builtin plugins, which raise alerts and which have buttons |
| [Views and formats](reference/VIEWS.md) | know what a plugin can render: stats, lists, progress bars, text, logs, formats and tones |
| [HTTP and WebSocket API](reference/API.md) | script the dashboard or read its state from elsewhere |
| [CLI](reference/CLI.md) | use `homelabdash validate`, `schema` and the `plugin` commands |

## Operations

| Page | Read it to |
|---|---|
| [Deploying](operations/DEPLOY.md) | run it with Docker, docker compose or Unraid, behind a reverse proxy, and decide who can reach it |
| [Troubleshooting](operations/TROUBLESHOOTING.md) | find out why a tile shows an error, stays stale or never updates |

## Extending

| Page | Read it to |
|---|---|
| [Writing a plugin](extending/PLUGINS.md) | add a service of your own, with fixtures and tests |

## Contributing

| Page | Read it to |
|---|---|
| [Architecture](contributing/ARCHITECTURE.md) | find your way around the code before changing it |
| [Testing](contributing/TESTING.md) | run the tests, the mocked services and the screenshot script |

[CONTRIBUTING.md](../CONTRIBUTING.md) has the workflow (branches, commit messages, releases) and [SECURITY.md](../SECURITY.md) the security model.
