# sabnzbd

Download rate, queue size, time left and data left from SABnzbd, plus the queue itself. Raises an alert when the queue is paused and, if you set a threshold, when free disk space runs low. Pause and resume are available as tile buttons once `allowControl` is on.

```yaml
sources:
  sabnzbd:
    plugin: sabnzbd
    config:
      url: http://sabnzbd.example:8080
      apiKey: "${secret:SABNZBD_API_KEY}"
      diskSpaceAlertGb: 50        # alert below 50 GB free
      allowControl: false         # true enables Pause / Resume

sections:
  - { title: Alerts, source: alerts }
  - title: Downloads
    tiles:
      - { title: SABnzbd, icon: di:sabnzbd, source: sabnzbd }
      - { title: Queue, source: sabnzbd, options: { view: queue, limit: 5 }, span: 2 }
```

The API key is under Config > General > Security. Use the API key, not the NZB key: the NZB key can only add downloads.

## Options

`view`: `summary` (default: rate, queue size, time left, data left) or `queue` (one row per download with its status, progress and time left). `limit` (default `10`): rows in the queue view; only that many slots are requested.

## Config

| key | default | |
|---|---|---|
| `url` | required | web UI address, including the base path if SABnzbd runs under one |
| `apiKey` | required | sent as the `apikey` query parameter |
| `allowControl` | `false` | enable the `pause` and `resume` actions |
| `diskSpaceAlertGb` | `0` (off) | alert when the incomplete or complete folder has less free space than this |

## Alerts and actions

- `paused` (warning) while the queue is paused, with a Resume button when `allowControl` is on.
- `diskspace` (warning) when the fuller of the two folders drops below `diskSpaceAlertGb`.

`pause` and `resume` are tile actions: the dashboard shows them on every tile of the source, so they stay refused with an error until `allowControl: true`.

SABnzbd answers a wrong API key with HTTP 200 and `{ "error": "API Key Incorrect" }`; the tile shows that message. Sizes use 1024-based units, as in the SABnzbd UI.
