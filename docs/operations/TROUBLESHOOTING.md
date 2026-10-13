← [Documentation](../README.md)

# Troubleshooting

## Where to look

1. `curl http://host:3000/api/health` answers with the status, the number of config errors and how many sources fail.
2. `docker exec homelabdash homelabdash validate` lists config problems with file and line.
3. `curl http://host:3000/api/debug` shows every source: last run, duration, error, failures in a row, next run, stream and jobs. `?source=<id>&data=1` adds the data the plugin returned, secrets removed.
4. `docker logs homelabdash`: plugin messages start with the source id in brackets.
5. `docker exec homelabdash homelabdash plugin run <plugin> --source <id>` runs one source with your real config, outside the dashboard, and prints what it renders.

## A tile shows an error

The message is what the service answered, or what went wrong reaching it. Most often:

| Message | Cause |
|---|---|
| `401`, `403`, `Forbidden`, `login ... refused` | wrong key or password, or the key lacks a permission (an Unraid key that may read notifications but not archive them) |
| `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND` | wrong URL, or the container cannot reach that host: check from inside with `docker exec homelabdash wget -qO- <url>` |
| `connect ENOENT /var/run/docker.sock`, `EACCES` | the socket is not mounted, or `--group-add` does not match its group |
| `host key changed` | the SSH host was reinstalled: remove its entry from `/data/ssh_known_hosts.json` or set its fingerprint in the config |
| `invalid "stats" view: ...` | the plugin returned something the page cannot draw; this is a plugin bug |
| qBittorrent `403` | the dashboard's address is not in qBittorrent's "Bypass authentication for clients in whitelisted IP subnets", and no username and password are set |

## A tile says "stale"

The source failed after having worked. The tile keeps showing the last values while the source retries, waiting a little longer each time, up to 5 minutes, and hovering the badge shows the error.

## The page loads but tiles stay empty

The red dot next to the clock means the WebSocket isn't connected, and that's how tiles get their data. The reverse proxy is usually the culprit:

- it does not pass WebSocket upgrades (Nginx Proxy Manager: "Websockets Support"),
- or the server refused the `Origin`: the browser's address must match the `Host` the proxy sends, or the `X-Forwarded-Host`. A proxy that rewrites `Host` to the container's address breaks this.

From a shell, an upgrade through the proxy should answer `101 Switching Protocols`:

```sh
curl -si https://dash.example/api/ws -H "Origin: https://dash.example" \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" | head -1
```

`403` means the origin check refused it, `400` or a plain page means the proxy did not pass the upgrade.

## A tile never changes

Look at the source's `interval` in `/api/debug`. Some plugins default to a minute or more (Seerr, the arrs, Docker), and while no browser is connected every source slows down to `settings.idleInterval`, 5 minutes by default. Also, a tile with `hideWhen: empty` disappears rather than showing zeros.

## The config does not apply

The page lists the errors at the top, and the last good config keeps running until they're fixed. If the watcher misses a change (some network shares don't report them), reload by hand with `curl -X POST -H 'Content-Type: application/json' -d '{}' http://host:3000/api/reload`.
