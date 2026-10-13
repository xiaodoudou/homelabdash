# adguard

DNS queries, blocked and filtered counts and average latency from AdGuard Home, plus the top blocked domains. Raises an alert while protection is disabled. Enabling and disabling protection is available as tile buttons once `allowControl` is on.

```yaml
sources:
  adguard:
    plugin: adguard
    config:
      url: http://adguard.example
      username: admin
      password: "${secret:ADGUARD_PASSWORD}"
      allowControl: false         # true enables the protection buttons

sections:
  - { title: Alerts, source: alerts }
  - title: Network
    tiles:
      - { title: AdGuard, icon: di:adguard-home, source: adguard }
      - { title: Top blocked, source: adguard, options: { view: blocked, limit: 5 } }
```

## Options

`view`: `summary` (default) or `blocked`. `period` (summary): `all` (default) counts over the whole statistics retention set in AdGuard (24 hours to 90 days), `today` shows today's bucket (the last 24 hours when AdGuard keeps hourly stats); latency is always over the retention.

- `summary`: Queries (`num_dns_queries`), Blocked (`num_blocked_filtering`), Filtered (safe browsing + parental control + safe search replacements) and Latency (average processing time, in ms).
- `blocked`: top blocked domains with their counts; `limit` (default `5`) rows.

Counts cover AdGuard Home's statistics period (Settings > General settings > Statistics, 24 hours by default).

## Config

| key | default | |
|---|---|---|
| `url` | required | web UI address |
| `username` | | AdGuard Home user, sent with basic auth; needs `password` |
| `password` | | needs `username` |
| `allowControl` | `false` | enable the `enable` and `disable` actions |

## Alerts and actions

- `protection-off` (error) while protection is disabled, with how long until it comes back when it was paused for a while, and an Enable protection button when `allowControl` is on.

`enable` and `disable` (`POST /control/protection`) are tile actions: the dashboard shows them on every tile of the source, so they stay refused with an error until `allowControl: true`. Disabling from the dashboard turns protection off without a time limit.
