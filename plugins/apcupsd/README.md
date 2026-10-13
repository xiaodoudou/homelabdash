# apcupsd

UPS status, load, battery charge and runtime from the [apcupsd](http://www.apcupsd.org/) network information server (NIS, TCP port 3551), the same data `apcaccess status` prints. Raises an error alert while the UPS runs on battery.

```yaml
sources:
  ups:
    plugin: apcupsd
    config:
      host: nas.example
      batteryAlertPercent: 50

sections:
  - { title: Alerts, source: alerts }
  - title: Power
    tiles:
      - { title: UPS, icon: mdi:battery-charging, source: ups }
      - { title: Power, icon: mdi:flash, source: ups, options: { view: power } }
      - { title: UPS details, source: ups, options: { view: details }, span: 2 }
```

apcupsd only answers other hosts when `apcupsd.conf` has `NETSERVER on` and `NISIP 0.0.0.0` (the default `127.0.0.1` refuses remote connections). When homelabdash runs in Docker on the same machine, use the host's address rather than `localhost`.

## Config

| key | default | |
|---|---|---|
| `host` | required | machine running apcupsd |
| `port` | `3551` | `NISPORT` in `apcupsd.conf` |
| `batteryAlertPercent` | `50` | warn when the battery charge drops below this; `0` turns it off |

## Options

`view`:
- `summary` (default): status (lower case), load %, battery % (warning at 50, error at 25), time left
- `power`: load in watts (`LOADPCT` x `NOMPOWER` / 100, empty when the UPS does not report `NOMPOWER`), line voltage, battery voltage, model
- `details`: every record of the status, name and value

## Alerts

| id | severity | when |
|---|---|---|
| `onbatt` | error | `STATUS` contains `ONBATT` |
| `status:<STATUS>` | warning | `STATUS` neither starts with `ONLINE` nor is on battery (`COMMLOST`, `SHUTTING DOWN`...) |
| `battery-low` | warning | `BCHARGE` below `batteryAlertPercent` |

## Notes

The plugin sends the `status` command over the NIS protocol (2-byte big-endian length, then the text) and reads length-prefixed records until the zero-length record that ends the reply, so no `apcaccess` binary is needed. A truncated reply, or something on the port that is not apcupsd, fails the fetch instead of showing partial data.
