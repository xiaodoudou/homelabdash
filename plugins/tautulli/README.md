# tautulli

What Plex is playing right now, from the [Tautulli](https://tautulli.com) API (`get_activity`): one row per stream with its progress, time left, who is watching, the player and whether it is transcoded, plus a stream count and total bandwidth. All tiles of a source share one request per interval.

```yaml
sources:
  plex:
    plugin: tautulli
    config:
      url: http://tautulli.example:8181
      apiKey: "${secret:TAUTULLI_API_KEY}"

sections:
  - title: Plex
    tiles:
      - { title: Now playing, icon: mdi:plex, source: plex, span: 2 }
      - { title: Streams, icon: mdi:play-network, source: plex, options: { view: summary } }
```

## Config

| key | default | |
|---|---|---|
| `url` | required | Tautulli address |
| `apiKey` | required | Settings > Web Interface > API key, sent as the `apikey` query parameter |
| `allowControl` | `false` | offer a Stop button on each stream |
| `stopMessage` | none | message the viewer sees on their player when a stream is stopped from the dashboard |

## Options

`view`: `sessions` (default) or `summary`.

- `sessions`: list, one line per stream. Episodes read "Show: S01E05 - Episode", movies "Movie (Year)", music "Artist - Track". Next to the title come the user, the player and `transcode`, `direct play` or `direct stream`; a play, pause or hourglass icon shows the state. The value is the time left as `HH:MM:SS`, counting down every second in the browser while the stream plays, and the thin bar under the row fills along with it; a paused stream stays put. Each fetch sets the position again from Tautulli. Empty: "Nothing playing".
- `summary`: stats Streams, Transcodes, Bandwidth.

`showUser` (default `true`): set `false` to keep user names off a shared screen.

With `allowControl: true`, each stream gets a Stop button. The first click turns it into "Stop this stream?", and a second click within four seconds stops it through Tautulli's `terminate_session`. Plex only stops streams for a server whose owner has Plex Pass; without it, the button reports Tautulli's error.

## Notes

The API returns most numbers as strings (`"stream_count": "3"`, durations and offsets in milliseconds) and bandwidth in kbps; the plugin converts them, so Bandwidth is in bits per second. A `copy` transcode decision is what Tautulli calls direct stream.
