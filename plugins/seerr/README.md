# seerr

Requests and issues from [Overseerr](https://overseerr.dev), [Jellyseerr](https://github.com/Fallenbagel/jellyseerr) or Seerr (API v1): request counts, open issues and the pending requests with their titles. Pending requests and open issues become alerts; approving or declining from the dashboard is opt-in.

```yaml
sources:
  requests:
    plugin: seerr
    config:
      url: http://requests.example:5055
      apiKey: "${secret:SEERR_API_KEY}"
      alerts: { pending: true, issues: true }
      allowApprove: false               # true adds Approve / Decline buttons

sections:
  - { title: Alerts, source: alerts }
  - title: Requests
    tiles:
      - { title: Requests, icon: mdi:movie-search, source: requests }
      - { title: Pending, source: requests, options: { view: pending }, span: 2 }
```

The API key is in Settings > General. It acts as the admin account, so keep it in `secrets.yaml`.

## Config

| key | default | |
|---|---|---|
| `url` | required | Overseerr, Jellyseerr or Seerr address |
| `apiKey` | required | sent as `X-Api-Key` |
| `alerts.pending` | `true` | one alert per pending request (id `request:<id>`) |
| `alerts.issues` | `true` | an alert while issues are open (id `issues:<count>`, so it comes back when the count changes) |
| `allowApprove` | `false` | enable the `approve` and `decline` actions, on list rows and alerts |

## Options

`view`: `summary` (default) or `pending`. `stats`: which counts the summary shows and in what order, any of `pending`, `processing`, `available`, `issues` (default all four), e.g. `stats: [pending, issues]`.

- `summary`: stats Pending, Processing, Available, Open issues.
- `pending`: the 10 most recently added pending requests: title (with year), who asked and when, a `4K` badge for 4K requests, a link to the title's page. With `allowApprove: true` each row has Approve and Decline buttons. Empty: "No pending requests".

## Notes

Only the endpoints the tiles and alerts need are called: `/api/v1/request/count`, `/api/v1/issue/count` and `/api/v1/request?filter=pending&take=10`. A request only carries a TMDB id, so the title of each pending one comes from `/api/v1/movie/<id>` or `/api/v1/tv/<id>`; titles are kept in the source state and fetched once. The per-type counts of `/issue/count` (video, audio, subtitles) include closed issues, so only `open` is shown.
