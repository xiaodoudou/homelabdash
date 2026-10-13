# http-json

Any HTTP API that returns JSON (or text). One request or several in parallel, any auth, and [JSONata](https://jsonata.org) expressions to pick, merge and compute values. No limit on the number of fields.

## One request

```yaml
sources:
  npm:
    plugin: http-json
    config:
      url: http://proxy.example:81/api/nginx/proxy-hosts
      auth: { bearer: "${secret:NPM_TOKEN}" }
tiles:
  - title: Proxy hosts
    source: npm
    options:
      items:
        - { label: Hosts, value: "$count($)" }
        - { label: SSL, value: "$count($[certificate_id > 0])" }
```

## Several requests merged

Each request's body lands under its name, so expressions can combine them:

```yaml
sources:
  missing:
    plugin: http-json
    interval: 5m
    config:
      requests:
        movies:   { url: http://radarr.example/api/v3/wanted/missing, query: { pageSize: 1 }, auth: { header: X-Api-Key, value: "${secret:RADARR_KEY}" } }
        episodes: { url: http://sonarr.example/api/v3/wanted/missing, query: { pageSize: 1 }, auth: { header: X-Api-Key, value: "${secret:SONARR_KEY}" } }
tiles:
  - { title: Movies, source: missing, options: { items: [{ label: Missing, value: movies.totalRecords }] } }
  - { title: Episodes, source: missing, options: { items: [{ label: Missing, value: episodes.totalRecords }] } }
```

## Config

Per request (top level for a single one, or under `requests.<name>`): `url`, `method`, `headers`, `query`, `json` (body), `form`, `auth` (`bearer`, `basic: { username, password }`, or `header` + `value`), `insecure` (self-signed TLS), `parse` (`auto`, `json`, `text`), `response: true` to keep `{ status, headers, body }` (needed to read a header).

`transform`: JSONata applied once per fetch; tiles see its result.
`alerts`: JSONata returning `[{ id, message, severity?, title?, href? }]`.

## Options (pick one)

- `items: [{ label, value, format?, unit?, warn?, crit?, invert?, href? }]`: stats, `value` is an expression.
- `list: { items, title, subtitle?, value?, format?, href?, badge?, tone?, limit?, empty? }`: `items` returns an array, the other expressions run on each element.
- `progress: [{ label, value, max, format?, detail?, warn?, crit? }]`: `max` is a number or an expression.
- `text`: an expression returning a string (`mono: true` for a monospace block).

Without options the tile shows the data as JSON, handy while writing expressions. `homelabdash plugin run http-json --config '{...}'` prints the data without starting the dashboard.
