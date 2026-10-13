# unraid

CPU, memory, array, pools, uptime and notifications from the Unraid API (GraphQL, Unraid 7+). All tiles of a source share one query per interval. Unread notifications become alerts with an Archive button that archives them in Unraid.

```yaml
sources:
  tower:
    plugin: unraid
    config:
      url: http://tower.example
      apiKey: "${secret:UNRAID_API_KEY}"
      notifications: { minImportance: WARNING, limit: 20 }

sections:
  - { title: Alerts, source: alerts }
  - title: Server
    tiles:
      - { title: CPU, icon: mdi:cpu-64-bit, source: tower, options: { metric: cpu } }
      - { title: RAM, icon: mdi:memory, source: tower, options: { metric: memory } }
      - { title: Array, icon: mdi:harddisk, source: tower, options: { metric: array } }
      - { title: Cache, icon: mdi:flash, source: tower, options: { metric: pool, pool: cache } }
```

Create the key in Settings > Management Access > API Keys with read access to info, array and notifications (plus notification write access for Archive).

## Options

`metric`: `status` (default: array state + unread count), `cpu`, `memory`, `array`, `pool` (with `pool: <name>`), `uptime`, `notifications` (list with Archive buttons).

## Config

| key | default | |
|---|---|---|
| `url` | required | web UI address |
| `apiKey` | required | sent as `x-api-key` |
| `insecure` | `false` | accept a self-signed certificate |
| `notifications.limit` | `20` | unread notifications fetched |
| `notifications.minImportance` | `WARNING` | lowest importance raised as an alert (`INFO`, `WARNING`, `ALERT`) |
| `notifications.group` | `true` | one alert per title ("Docker image disk utilization (12 times)"); its Archive archives the whole group |

Sizes: the API reports "kilobytes" of 1000 bytes (they match `df -B1`), so array and pool figures are exact.
