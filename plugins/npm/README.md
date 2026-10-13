# npm

Proxy hosts and SSL certificates from the [Nginx Proxy Manager](https://nginxproxymanager.com/) API. Certificates that expired or are about to expire become alerts.

```yaml
sources:
  proxy:
    plugin: npm
    config:
      url: http://proxy.example:81
      email: admin@proxy.example
      password: "${secret:NPM_PASSWORD}"
      certExpiryDays: 14

sections:
  - { title: Alerts, source: alerts }
  - title: Network
    tiles:
      - { title: Proxy, icon: di:nginx-proxy-manager, source: proxy, href: http://proxy.example:81 }
      - { title: Certificates, icon: mdi:certificate, source: proxy, options: { view: certificates, limit: 5 }, span: 2 }
```

## Config

| key | default | |
|---|---|---|
| `url` | required | admin UI (port 81 by default) |
| `email`, `password` | required | an NPM user; use `${secret:...}` for the password |
| `certExpiryDays` | `14` | warn when a certificate expires within this many days; `0` turns the warning off |

The API only lists the hosts and certificates the user may see, so use an administrator or a user whose item visibility is "All Items".

## Options

`view`:
- `summary` (default): `Hosts` (enabled proxy hosts), `SSL` (enabled hosts with a certificate), `Disabled`
- `certificates`: soonest expiry first, named after the certificate's name or its first domain, with its domains, the expiry time and a badge (`expired`, `expiring` within `certExpiryDays`, `valid`). `limit` (default `10`) sets the number of rows.

## Alerts

| id | severity | when |
|---|---|---|
| `cert:<id>:<expires_on>` | warning | expires within `certExpiryDays` |
| `cert:<id>:<expires_on>:expired` | error | expired |

A renewal changes `expires_on`, so the next expiry raises a new alert even if the last one was dismissed.

## Notes

The plugin logs in with `POST /api/tokens`, keeps the token and its expiry in the source state, and reuses it until a minute before it expires. A 401 on a stored token triggers one new login and one retry. Booleans come back as `true`/`false` in recent NPM versions and `1`/`0` in older ones; both are accepted. On SQLite installs `expires_on` has no time zone and is read as UTC.
