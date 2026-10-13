# openwrt

WAN status, traffic and rates, conntrack usage, load, memory and uptime of an OpenWrt router, read over ubus (the JSON-RPC endpoint `/ubus` that LuCI uses). No package to install on the router beyond the stock `uhttpd-mod-ubus` and `rpcd`.

```yaml
sources:
  router:
    plugin: openwrt
    config:
      url: http://router.example
      username: root
      password: "${secret:ROUTER_PASSWORD}"
      interface: wan

sections:
  - { title: Alerts, source: alerts }
  - title: Network
    tiles:
      - { title: WAN, icon: mdi:wan, source: router }
      - { title: Conntrack, icon: mdi:connection, source: router, options: { view: conntrack } }
      - { title: Router, icon: mdi:router-wireless, source: router, options: { view: system } }
```

## Options

`view`:
- `wan` (default): how long the interface has been up (`down` in red when it is not), its IPv4 address, bytes received and sent by its device, download and upload rates
- `conntrack`: active connection tracking entries and how full the table is (warning at 80%, error at 90%)
- `system`: 1 minute load, memory used, uptime

Rates are computed from the device counters of two consecutive polls, so the first poll after a start shows none. A PPPoE redial or a reboot resets the counters; that sample is skipped too.

## Config

| key | default | |
|---|---|---|
| `url` | required | router web address; the plugin posts to `<url>/ubus` |
| `username` | `root` | rpcd login |
| `password` | required | use `${secret:...}` |
| `insecure` | `false` | accept the self-signed certificate of uhttpd over HTTPS |
| `interface` | `wan` | logical interface (`network.interface.<name>`), e.g. `wan`, `wan6`, `lte` |
| `conntrack` | `true` | read `/proc/sys/net/netfilter/nf_conntrack_count` and `_max` |
| `conntrackAlertPercent` | `90` | alert when the conntrack table is this full; `0` turns it off |

## Alerts

- `wan-down` (error): the interface is down
- `conntrack-high` (warning): the conntrack table is at or above `conntrackAlertPercent`

## Read-only user

root works, but a dedicated user only needs these calls. Create `/usr/share/rpcd/acl.d/homelabdash.json` on the router (with your interface name in place of `wan`):

```json
{
  "homelabdash": {
    "description": "Read-only access for homelabdash",
    "read": {
      "ubus": {
        "network.interface.wan": ["status"],
        "network.device": ["status"],
        "system": ["info"],
        "file": ["read"]
      },
      "file": {
        "/proc/sys/net/netfilter/nf_conntrack_count": ["read"],
        "/proc/sys/net/netfilter/nf_conntrack_max": ["read"]
      }
    }
  }
}
```

and a login in `/etc/config/rpcd` (hash the password with `uhttpd -m <password>`), then `service rpcd restart`:

```
config login
	option username 'homelabdash'
	option password '$1$...'
	list read 'homelabdash'
```

When the ACL leaves out the conntrack files, the conntrack tile says so and the other tiles keep working.

## Notes

- The session from `session.login` (600 s, extended by every call) is kept in the source state and reused. When the router answers "Access denied" (JSON-RPC error -32002) or status 6 before any call of a poll succeeded, the session expired (reboot, timeout): the plugin logs in again once and retries.
- Each request carries a `?call=<object>.<method>` query parameter (plus `path` for file reads). uhttpd ignores it; it names the call in logs and lets fixtures tell the calls apart.
- `system.info` reports the load as fixed point (value / 65536); the tile shows the real figure.
