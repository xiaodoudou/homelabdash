← [Documentation](../README.md)

# Deploying

homelabdash ships as one image on Docker Hub, `xiaodoudoufr/homelabdash`, for amd64 and arm64. It listens on port 3000 and uses two folders:

| Folder | Holds | Needs |
|---|---|---|
| `/config` | `homelabdash.yaml`, `secrets.yaml`, your plugins and icons | read; write only for the starter file on first start and for `plugin new` |
| `/data` | dismissed alerts, plugin state and jobs, graph history, cached icons, pinned SSH host keys | read and write |

You can pull `latest`, a minor version such as `0.1` (its newest patch), or an exact one like `0.1.0`. The image runs as a non-root user and has a health check on `/api/health`.

## docker compose

The repository's [`compose.example.yaml`](../../compose.example.yaml) is a complete file:

```sh
mkdir -p config data
printf 'UID=%s\nGID=%s\nDOCKER_GID=%s\n' "$(id -u)" "$(id -g)" "$(stat -c %g /var/run/docker.sock)" > .env
docker compose -f compose.example.yaml up -d
```

The `.env` file tells compose which user the container runs as (the owner of `config` and `data`) and the group of the Docker socket.

## Plain Docker

```sh
mkdir -p /srv/homelabdash/data
docker run -d --name homelabdash --restart unless-stopped -p 3000:3000 \
  --user "$(stat -c %u:%g /srv/homelabdash)" \
  -v /srv/homelabdash:/config -v /srv/homelabdash/data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  --group-add "$(stat -c %g /var/run/docker.sock)" \
  xiaodoudoufr/homelabdash:latest
```

Only the `docker` plugin needs the Docker socket and `--group-add`. Mounting the socket read-only doesn't limit what the Docker API lets you do, so for least privilege put a socket proxy in front of it and give the `docker` source its `url` instead.

## Unraid

Search for homelabdash in the Apps tab (Community Applications). The template lives in [xiaodoudou/unraid-templates](https://github.com/xiaodoudou/unraid-templates/blob/main/homelabdash/homelabdash.xml); if the Apps tab doesn't list it, load it by hand from the Unraid terminal:

```sh
curl -fsSL -o /boot/config/plugins/dockerMan/templates-user/my-homelabdash.xml   https://raw.githubusercontent.com/xiaodoudou/unraid-templates/main/homelabdash/homelabdash.xml
```

then go to Docker, Add Container, and pick homelabdash under Template.

Appdata belongs to `nobody:users`, so the template runs the container with `--user 99:100`, and `--group-add` has to match the Docker socket's group, which `stat -c %g /var/run/docker.sock` prints. Giving the container its own LAN address (br0 with a fixed IP) works like for any other container.

## Behind a reverse proxy

The page talks to the server over a WebSocket at `/api/ws`, so the proxy has to pass WebSocket upgrades.

- Nginx Proxy Manager: tick "Websockets Support" on the proxy host.
- nginx:

  ```nginx
  location / {
    proxy_pass http://homelabdash:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
  ```

- Caddy and Traefik pass WebSockets without extra settings.

Requests that change something (POST and the WebSocket) are refused when the browser's `Origin` doesn't match the `Host` the server receives, or `X-Forwarded-Host` if the proxy sets one, which keeps other sites from acting through your browser. Since nginx's `$host` drops the port, a `Host` without a port is compared on the host name alone, so `https://dash.example:9443` passes with `Host: dash.example`. If the page loads but every tile stays empty next to a red dot, the WebSocket is being refused or blocked, and [Troubleshooting](TROUBLESHOOTING.md#the-page-loads-but-tiles-stay-empty) has the checks.

## Who can reach it

There's no login by default, so anyone who reaches the port sees every tile and can use every button you turned on. Before anything you don't trust can reach the dashboard, pick one of the setups below; [SECURITY.md](../../SECURITY.md#who-should-reach-it) explains the reasoning.

### Only local addresses

Here the reverse proxy accepts your LAN ranges and refuses everything else. When you're away, connect over a VPN (WireGuard, Tailscale) and you count as local.

- Nginx Proxy Manager: create an Access List whose Access rules allow your LAN ranges and end with `deny all`, then select it on the proxy host.
- nginx, in the `location` (or `server`) block:

  ```nginx
  allow 10.0.0.0/8;
  allow 172.16.0.0/12;
  allow 192.168.0.0/16;
  deny all;
  ```

- Caddy:

  ```caddy
  dash.example {
    @outside not remote_ip private_ranges
    respond @outside 403
    reverse_proxy homelabdash:3000
  }
  ```

- Traefik, as a middleware on the router:

  ```yaml
  http:
    middlewares:
      lan-only:
        ipAllowList:
          sourceRange: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
  ```

Check which address the proxy actually sees, though. If your router forwards the port with its own address as the source (masquerading, or NAT loopback), every outside request looks local. In that case deny the router's address before the allow rules: `deny <router address>;` in nginx, or a deny line at the top of the NPM Access List.

### Behind an identity proxy

Authentik, Authelia, oauth2-proxy, Cloudflare Access and Tailscale Serve sign you in and then pass your user name to homelabdash in a header. Tell homelabdash which header to expect:

```yaml
settings:
  auth: { type: header, header: X-authentik-username }
```

| Identity proxy | Header |
|---|---|
| Authentik (proxy provider, forward auth) | `X-authentik-username` |
| Authelia | `Remote-User` |
| oauth2-proxy | `X-Auth-Request-User` behind nginx `auth_request` (with `--set-xauthrequest`), `X-Forwarded-User` when it is the reverse proxy |
| Cloudflare Access | `Cf-Access-Authenticated-User-Email` |
| Tailscale Serve | `Tailscale-User-Login` |

For the proxy side, follow the identity proxy's own guide for your reverse proxy; most have one for Nginx Proxy Manager, nginx, Caddy and Traefik.

homelabdash only checks that the header is there, not what it says. The proxy therefore has to set the header itself and overwrite any value a client sends, which the forward auth snippets of Authentik and Authelia do with `proxy_set_header`. It also means port 3000 must only be reachable through the proxy: don't publish it, and put the proxy and homelabdash on the same Docker network, because anyone who reaches the port directly can send the header too.

The page's WebSocket (`/api/ws`) goes through the same check, so the proxy has to pass WebSocket upgrades as described in [Behind a reverse proxy](#behind-a-reverse-proxy).

### A password

```yaml
settings:
  auth: { type: basic, username: me, password: "${secret:DASH_PASSWORD}" }
```

That's one shared password, which the browser asks for. It's fine on a LAN but not enough on the internet, and it should always go over TLS.

Whatever you choose, `/api/health` stays open for health checks.

## Upgrading

```sh
docker pull xiaodoudoufr/homelabdash:latest
docker rm -f homelabdash   # then the same docker run as before, or: docker compose up -d
```

Config and data stay as they are; the [changelog](../../CHANGELOG.md) says if anything in the config changed. Your own plugins keep working, and `docker exec homelabdash homelabdash plugin test` confirms it.

## Backups

`/config` is what you wrote, and worth keeping in git (without `secrets.yaml`). Losing `/data` isn't a disaster: the dashboard rebuilds it, and all you lose are dismissed alerts, the last hour of graphs and the pinned SSH host keys, which get pinned again on the next connection.
