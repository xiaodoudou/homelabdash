# qbittorrent

Leeching and seeding counts with the global download and upload speeds (the same four numbers as the homepage qBittorrent widget), and a list of active torrents. Torrents in `error` or `missingFiles` become alerts, one per kind of problem ("3 torrents have missing files") with the names in the message. Uses the WebUI API v2: `/api/v2/transfer/info` and `/api/v2/torrents/info`.

```yaml
sources:
  qbittorrent:
    plugin: qbittorrent
    config:
      url: http://qbittorrent.example:8080
      # only when the dashboard is not in the auth whitelist:
      # username: admin
      # password: "${secret:QBT_PASSWORD}"

sections:
  - { title: Alerts, source: alerts }
  - title: Downloads
    tiles:
      - { title: qBittorrent, icon: di:qbittorrent, source: qbittorrent }
      - { title: Active torrents, source: qbittorrent, options: { view: active, limit: 5 }, span: 2 }
```

## Authentication

Either add the dashboard's address to Options > WebUI > Bypass authentication for clients in whitelisted IP subnets and leave `username` / `password` out, or set both. With credentials the plugin logs in (`POST /api/v2/auth/login`), keeps the session cookie in the source state and logs in again once when a call returns 403. Without credentials a 403 fails the tile with a message pointing at the whitelist.

Too many failed logins make qBittorrent ban the IP for a while; the login then answers 403 and the tile says so.

## Options

`view`: `summary` (default: Leech, Download, Seed, Upload) or `active` (torrents that are downloading or moving data, fastest download first, with state, progress and download speed). `limit` (default `10`): rows in the active view.

## Config

| key | default | |
|---|---|---|
| `url` | required | WebUI address |
| `username` | | WebUI user, needs `password` |
| `password` | | WebUI password, needs `username` |

Leech counts `downloading`, `stalledDL`, `metaDL`, `forcedDL`, `queuedDL`, `checkingDL`, `forcedMetaDL`; seed counts `uploading`, `stalledUP`, `forcedUP`, `queuedUP`, `checkingUP`. Paused or stopped torrents are in neither.

Alerts: `error:<hash>` (error) for each torrent in `error` or `missingFiles`.

The session cookie is `SID` on most versions; newer versions name it `QBT_SID_<port>`, and both are handled.
