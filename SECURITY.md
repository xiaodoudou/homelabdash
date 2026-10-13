← [homelabdash](README.md)

# Security

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private reporting: the repository's **Security** tab, then **Report a vulnerability**. Say what an attacker can do, in which configuration, and how to reproduce it.

## Who should reach it

The dashboard shows what your services are doing, and with the action flags on it can pause downloads, stop containers or approve requests. Treat it like the admin pages of those services: either only your own network reaches it, or every request goes through a login you trust.

Keeping it local is the simplest. Publish the port on your LAN only, and when a reverse proxy serves it on a domain, have the proxy accept local addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) and refuse the rest. From outside, come in over a VPN such as WireGuard or Tailscale rather than opening the dashboard to the internet.

If it really has to be reachable from anywhere, put an identity proxy in front of it: Authentik, Authelia, oauth2-proxy, Cloudflare Access or Tailscale Serve. The proxy signs you in and passes your user name in a header, and with `settings.auth: { type: header, header: ... }` homelabdash turns away any request that arrives without it.

Basic auth (`settings.auth: { type: basic }`) is one shared password. On a LAN that's a reasonable lock; on the internet it isn't enough.

[Deploying](docs/operations/DEPLOY.md#who-can-reach-it) has the allow-lists for Nginx Proxy Manager, nginx, Caddy and Traefik, and the header each identity proxy sends.

## What the dashboard protects

homelabdash holds the API keys and passwords of your services, and with the action flags on it can change things in some of them. Those keys stay on the server.

`${secret:NAME}` is resolved on the server, from `secrets.yaml`, an environment variable or a Docker secret, and only inside a source's settings or `settings.auth`. The page never receives a source's settings, only the views the plugins render, and secret values are scrubbed from errors, logs and `/api/debug`.

Buttons that change something upstream (starting or stopping a container, pausing downloads, approving a request, turning off AdGuard protection) stay hidden until a flag in that source's settings turns them on. Archiving an Unraid notification is the one exception: it's on by default, and `notifications.archive: false` turns it off.

POST requests have to send JSON. Both POST requests and the WebSocket are refused when the browser's `Origin` doesn't match the `Host` (or `X-Forwarded-Host`) the server sees, so another site open in your browser can't act on the dashboard.

Each plugin runs in a worker thread, so one that hangs or crashes doesn't take the server down with it. That isn't a sandbox, though. A plugin can do whatever Node.js can do inside the container, so only install plugins you've read.

For SSH, the first key a host presents is pinned in `/data`, and a different key later is refused; set `hostFingerprint` to pin it from the start. The image itself runs as a non-root user.

## What it doesn't do

- There's no login by default. Anyone who reaches the port sees every tile and can press every button you turned on, which is why the section above matters.
- With `auth: { type: header }`, the server lets in any request carrying that header, whatever its value. The proxy has to set the header itself, overwriting one a client sends, and nothing but the proxy may reach the port.
- There are no users or roles. Whoever can open the page can do everything it offers.
- The Docker socket gives full control of the host to whoever controls the container, and mounting it read-only doesn't change that. Use a socket proxy that only allows the read calls the `docker` plugin needs, or leave the plugin out.

## Before it leaves your LAN

- Decide who reaches it: local addresses (plus a VPN from outside), or an identity proxy in front. With the proxy, don't publish port 3000 at all.
- Serve it over TLS from the reverse proxy.
- Keep keys in `secrets.yaml` or Docker secrets, and keep `secrets.yaml` out of git.
- Turn on only the action flags you use.
- Put a read-only socket proxy in front of the Docker socket, or don't mount it.
- Read user plugins before dropping them into `config/plugins/`.
- Update the image when a release comes out; the [changelog](CHANGELOG.md) says what changed.
