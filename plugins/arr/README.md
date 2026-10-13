# arr

Missing items, the download queue and health checks from Radarr or Sonarr (API v3), and Lidarr or Readarr (API v1, set `apiVersion: v1`). One source per app; it calls only the endpoints its tiles and alerts need. Every health check the app reports becomes an alert linking to its wiki page.

```yaml
sources:
  radarr:
    plugin: arr
    config:
      url: http://radarr.example:7878
      apiKey: "${secret:RADARR_API_KEY}"
  sonarr:
    plugin: arr
    config:
      url: http://sonarr.example:8989
      apiKey: "${secret:SONARR_API_KEY}"
  lidarr:
    plugin: arr
    config:
      url: http://lidarr.example:8686
      apiKey: "${secret:LIDARR_API_KEY}"
      apiVersion: v1

sections:
  - { title: Alerts, source: alerts }
  - title: Media
    tiles:
      - { title: Movies, icon: di:radarr, source: radarr, options: { view: summary } }
      - { title: Shows, icon: di:sonarr, source: sonarr, options: { view: summary } }
      - { title: Sonarr health, source: sonarr, options: { view: health }, span: 2 }
```

## Config

| key | default | |
|---|---|---|
| `url` | required | app address (include the URL base if one is set, e.g. `http://media.example/radarr`) |
| `apiKey` | required | Settings > General > API Key, sent as `X-Api-Key` |
| `apiVersion` | `v3` | `v3` for Radarr and Sonarr, `v1` for Lidarr, Readarr and Prowlarr |
| `healthAlerts` | `true` | one alert per health check (id `<source>:<message>`, title `<appName>: <message>`) |

## Options

`view`: `missing` (default), `queue`, `summary`, `health`.

- `missing`: stats Missing (monitored items without a file, from `wanted/missing`).
- `queue`: stats Queue, Errors, Warnings (from `queue/status`; the API only says whether some queue item has an error or a warning, so those two read `yes` or `no`).
- `summary`: stats Missing, Queue, Health issues.
- `health`: list of health checks, with the type (`error`, `warning`, `notice`) as a badge and the wiki page as the link. Empty: "Healthy".

## Notes

`system/status` is only called while there are health checks to alert on, since the app name is only used in alert titles. Prowlarr has no `wanted/missing` or queue: use it with `apiVersion: v1` and `view: health` only.
