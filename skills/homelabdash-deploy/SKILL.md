---
name: homelabdash-deploy
description: Install, upgrade, expose and troubleshoot homelabdash with Docker, docker compose or an Unraid template, behind a reverse proxy, with auth. Use when the user wants to run or update the dashboard, put it on a domain, fix a tile that shows an error, a stuck or missing update, permission problems with the docker socket or config folder, or WebSocket issues behind a proxy.
---

# Deploy and operate homelabdash

One image: `ghcr.io/xiaodoudou/homelabdash` (amd64, arm64). Port 3000. Volumes: `/config` (what the user edits) and `/data` (what the dashboard writes: alert dismissals, plugin state, job history, icon cache, pinned SSH host keys). An empty `/config` gets a starter `homelabdash.yaml`.

## Run

docker compose: start from `compose.example.yaml` in the repository.

Plain Docker:
```sh
mkdir -p /srv/homelabdash/data
docker run -d --name homelabdash -p 3000:3000 --user "$(stat -c %u:%g /srv/homelabdash)" \
  -v /srv/homelabdash:/config -v /srv/homelabdash/data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  --group-add "$(stat -c %g /var/run/docker.sock)" \
  ghcr.io/xiaodoudou/homelabdash:latest
```

Unraid: template `unraid/homelabdash.xml`. Appdata is owned by `nobody:users`, so the template runs the container with `--user 99:100`; `--group-add` must match the docker socket group (`stat -c %g /var/run/docker.sock`, often 281 on Unraid). A dedicated LAN address (br0 with a fixed IP) works like any other container.

Permissions:
- The image runs as a non-root user. `/data` must be writable by the user it runs as; `/config` only needs to be writable for `plugin new` and the starter file.
- Docker socket: needed only by the `docker` plugin. `:ro` does not restrict the Docker API; for least privilege put a socket proxy in front and set `url:` on the docker source instead of mounting the socket.
- ICMP ping from a non-root container may need `--cap-add NET_RAW`; TCP checks (`ctx.tcp.check`) need nothing.

## Reverse proxy

The page needs a WebSocket at `/api/ws`. Nginx Proxy Manager: tick "Websockets Support". Plain nginx: `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_set_header Host $host;`. Requests are refused when the browser's Origin differs from Host (or X-Forwarded-Host), so keep the Host header; a Host without a port (nginx `$host`) matches on the host name. Empty tiles with a red dot mean the WebSocket is refused or blocked: an upgrade through the proxy must answer 101 (see `docs/operations/TROUBLESHOOTING.md`).

Access: keep the dashboard to local addresses (proxy allow-list of the LAN ranges, a VPN from outside; deny the router's own address when it masquerades forwarded traffic), or put an identity proxy in front and set `settings.auth: { type: header, header: <its header> }` (Authentik `X-authentik-username`, Authelia `Remote-User`, oauth2-proxy `X-Auth-Request-User`, Cloudflare Access `Cf-Access-Authenticated-User-Email`, Tailscale Serve `Tailscale-User-Login`). homelabdash only checks that the header is present: the proxy must set it itself, and port 3000 must not be reachable without the proxy. `{ type: basic }` is a shared password for a LAN. `/api/health` stays open. Details: `docs/operations/DEPLOY.md#who-can-reach-it`.

## Upgrade

`docker pull ghcr.io/xiaodoudou/homelabdash:latest && docker restart homelabdash` (or recreate). Config and data are untouched. User plugins in `/config/plugins` keep working; run `docker exec homelabdash homelabdash plugin test` after an upgrade to confirm.

## Troubleshoot

1. `curl http://host:3000/api/health`: `status`, number of config errors, failing sources.
2. `docker exec homelabdash homelabdash validate`: config problems with file and line.
3. `curl http://host:3000/api/debug`: every source with last run, duration, error, failures, next run, stream state and jobs. Add `?source=<id>&data=1` to see the data a plugin returned (secrets redacted).
4. `docker logs homelabdash`: plugin logs are prefixed with the source id.
5. Reproduce one source outside the dashboard: `docker exec homelabdash homelabdash plugin run <plugin> --source <id>` uses the real config and network and prints views, alerts and data.

Common causes:
- Tile shows "Stale:" + an error: the source failed after a success; it retries with backoff (up to 5 minutes).
- `connect ENOENT /var/run/docker.sock` or `EACCES`: socket not mounted, or `--group-add` does not match its group.
- `host key changed`: the SSH host was reinstalled; delete its entry from `/data/ssh_known_hosts.json` or set `hostFingerprint`.
- Page shows "Reconnecting": the WebSocket is blocked by the proxy (see above).
- A tile never updates while others do: check its source `interval`; without an open browser everything slows to `idleInterval`.
