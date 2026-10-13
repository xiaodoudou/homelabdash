# sub-quota

Traffic used, quota and expiry date of proxy subscriptions (Clash, mihomo, sing-box providers), read from the `Subscription-Userinfo` header that providers send with the subscription file:

```
Subscription-Userinfo: upload=1073741824; download=29001613312; total=107374182400; expire=1893499200
```

Only the header is kept; the subscription itself is discarded.

```yaml
sources:
  subs:
    plugin: sub-quota
    config:
      subscriptions:
        - name: Provider A
          url: "https://sub-a.example/api/v1/client/subscribe?token=${secret:SUB_A_TOKEN}"
        - name: Provider B
          url: "${secret:SUB_B_URL}"
          userAgent: mihomo
      usageAlertPercent: 90
      expiryAlertDays: 7

sections:
  - { title: Alerts, source: alerts }
  - title: Network
    tiles:
      - { title: Subscriptions, icon: mdi:gauge, source: subs }
      - { title: Quota used, icon: mdi:percent, source: subs, options: { view: stats } }
```

The URL carries the account token: put the token, or the whole URL, in a secret.

## Options

`view`:
- `progress` (default): one bar per subscription, used (upload + download) out of the total, with the percent and the expiry date ("28% - expires 2030-01-01", or only the percent when the provider sends no expiry)
- `stats`: the used percent of each subscription

A subscription that fails (HTTP error, no header) shows its error in its own row; the others still update.

## From OpenClash

On OpenWrt with OpenClash, let the plugin read the subscriptions from the router instead of copying their URLs (it logs in over ubus like LuCI does and picks up renamed or rotated URLs):

```yaml
sources:
  vpn:
    plugin: sub-quota
    config:
      openclash: { url: http://router.example, password: "${secret:ROUTER_PASSWORD}", names: [Provider A, Provider B] }
```

`names` filters by the name shown in OpenClash; without it every enabled subscription is shown.

## Config

| key | default | |
|---|---|---|
| `subscriptions[].name` | required | label on the tile, also part of the alert ids (keep names unique) |
| `subscriptions[].url` | required | subscription URL; use `${secret:...}` |
| `subscriptions[].userAgent` | `clash.meta` | many providers only send the header to Clash clients |
| `usageAlertPercent` | `90` | warning when a subscription has used this much; `0` turns it off |
| `expiryAlertDays` | `7` | warning this many days before expiry; `0` turns it off |

The default interval is 30 minutes: the numbers change slowly and every poll downloads the full subscription.

## Alerts

- `usage:<name>` (warning): used at or above `usageAlertPercent`
- `expiring:<name>:<expire>` (warning): expires within `expiryAlertDays`
- `expired:<name>:<expire>` (error): the expiry date has passed

A renewal changes `expire`, so the expiry alerts of the next term show again even after a dismissal.
