# glances

CPU, memory, load, GPU, sensors, disks and uptime from the [Glances](https://github.com/nicolargo/glances) REST API v4 (`glances -w`). One source polls only the endpoints its tiles need.

```yaml
sources:
  host:
    plugin: glances
    interval: 5s
    config:
      url: http://nas.example:61208
      gpuTemperatureAlert: 90   # 0 turns the alert off

sections:
  - title: Host
    tiles:
      - { title: Overview, icon: mdi:server, source: host }
      - { title: GPU, icon: mdi:expansion-card, source: host, options: { metric: gpu } }
      - { title: Disks, icon: mdi:harddisk, source: host, options: { metric: fs, mounts: [/mnt/data] }, span: 2 }
```

## Config

| key | default | |
|---|---|---|
| `url` | required | Glances web server |
| `username`, `password` | | only with `glances --password` |
| `gpuTemperatureAlert` | `90` | alert when a GPU reaches this temperature (C) |
| `sensorAlerts` | `true` | alert when a sensor passes its own critical value |

## Options

`metric`: `summary` (default), `cpu`, `memory`, `load`, `gpu`, `sensors`, `fs`, `uptime`.
`gpu`: index for `metric: gpu`. `sensors`: labels to keep. `mounts`: mount points to keep (default: every real filesystem, bind mounts skipped).

## Notes

Glances computes CPU usage since the previous request, so the first answer after a long pause is unreliable; the tile shows no value until the next poll.
