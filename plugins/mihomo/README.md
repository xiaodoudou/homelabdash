# mihomo

Current node of a proxy group, open connections, live download and upload rates and traffic totals from the [mihomo](https://github.com/MetaCubeX/mihomo) (Clash Meta) REST API, the `external-controller` that dashboards like metacubexd and zashboard use. Works with OpenClash, ShellCrash, nikki and plain mihomo.

```yaml
sources:
  proxy:
    plugin: mihomo
    config:
      url: http://router.example:9090
      secret: "${secret:MIHOMO_SECRET}"
      group: Proxy

sections:
  - title: Network
    tiles:
      - { title: Proxy, icon: mdi:shield-airplane, source: proxy }
      - { title: Proxy traffic, icon: mdi:swap-vertical, source: proxy, options: { view: traffic } }
```

## Options

`view`:
- `summary` (default): current node of `group`, open connections, download and upload rates
- `traffic`: download and upload rates, total downloaded and uploaded since mihomo started

## Config

| key | default | |
|---|---|---|
| `url` | required | `external-controller` address (port 9090 by default) |
| `secret` | | `secret` from the mihomo config, sent as `Authorization: Bearer`; use `${secret:...}` |
| `group` | `Proxy` | proxy group whose node in use the summary shows |

## Notes

- Polls `/proxies/<group>` and `/connections` (only the counts and totals are kept, the connection list can be large). While a dashboard is open, `/traffic` streams one sample per second and the rates update live; without a viewer the rates are empty.
- When the group's `now` is itself a group (a `url-test`, `fallback` or `load-balance`), the summary follows its choice down to the node really in use and shows the group on a small line over the node; names keep their emoji.
- Recent builds also send running totals on `/traffic`; with them the totals update every second too.
