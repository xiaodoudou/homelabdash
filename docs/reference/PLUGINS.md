← [Documentation](../README.md)

# Builtin plugins

Each plugin's folder has a README with its settings, its display options and an example. `homelabdash plugin info <id>` prints the same from the installed version.

| Plugin | Shows | Alerts | Buttons (off until the flag is set) | Default interval |
|---|---|---|---|---|
| [adguard](../../plugins/adguard) | queries, blocked, filtered and latency, today or over AdGuard's retention; top blocked domains | protection off | enable and disable protection (`allowControl`) | 30s |
| [apcupsd](../../plugins/apcupsd) | UPS status, load, battery, runtime, power details | on battery, low charge | | 15s |
| [arr](../../plugins/arr) | missing items, download queue with errors and warnings, health issues of Radarr, Sonarr, Lidarr or Readarr | each health check | | 1m |
| [comfyui](../../plugins/comfyui) | generating or idle, queue, last jobs with their duration, VRAM | recent failed jobs, one alert for all of them | interrupt the running job, free the VRAM (`allowControl`, confirmed) | 5s |
| [docker](../../plugins/docker) | running, stopped, unhealthy and missing containers, a list of them, disk usage | an expected container not running, an unhealthy one | start, stop and restart on list rows (`allowControl`) | 1m, plus Docker events live |
| [glances](../../plugins/glances) | CPU, memory, load, GPU, sensors, disks, uptime | GPU temperature, sensors past their critical value | | 10s |
| [homeassistant](../../plugins/homeassistant) | entities (lights, switches, sensors, thermostats, people) as rows or numbers; lights on, people at home, pending updates | updates waiting, one alert for all of them | turn lights, switches, fans, input booleans and automations on and off (`allowControl`) | 1m, plus state changes live |
| [http-json](../../plugins/http-json) | any JSON API: one or several requests, values picked and computed with JSONata | whatever its `alerts` expression returns | | 30s |
| [llama-swap](../../plugins/llama-swap) | loaded model, tokens per second of the last requests, GPU, CPU and memory gauges | | unload the model (`allowControl`, confirmed) | 10s |
| [mihomo](../../plugins/mihomo) | current node of a proxy group, connections, live traffic | | | 15s, plus live traffic |
| [npm](../../plugins/npm) | Nginx Proxy Manager proxy hosts and certificates | certificates expired or about to expire | | 5m |
| [nvidia](../../plugins/nvidia) | load, VRAM, power, temperature and fan of each GPU, over SSH or in the container | a GPU at or above `tempAlert` | | 10s |
| [openwrt](../../plugins/openwrt) | WAN uptime, address, traffic and rates; conntrack; load, memory and uptime | WAN down, conntrack table nearly full | | 10s |
| [qbittorrent](../../plugins/qbittorrent) | leeching and seeding counts, speeds, active torrents | torrents with missing files or in error, one alert per kind | | 10s |
| [sabnzbd](../../plugins/sabnzbd) | rate, queue, time left, space left | queue paused, disk space low | pause and resume (`allowControl`) | 10s |
| [seerr](../../plugins/seerr) | request and issue counts, pending requests | pending requests, open issues | approve and decline (`allowApprove`) | 1m |
| [ssh](../../plugins/ssh) | results of commands run over SSH (number, text, key=value, JSON), a log followed live | per command: above, below, match, failed | | 1m, plus the log live |
| [sub-quota](../../plugins/sub-quota) | traffic used, quota and expiry of proxy subscriptions | usage over a percentage, expiry close | | 30m |
| [tautulli](../../plugins/tautulli) | Plex streams playing now with a live countdown; stream, transcode and bandwidth counts | | stop a stream, after a second click to confirm (`allowControl`) | 15s |
| [unraid](../../plugins/unraid) | CPU, memory, array, pools, uptime, notifications | Unraid notifications | Archive on notification alerts (`notifications.archive`, on by default) | 15s |

A source's `interval` overrides the default. Alerts reach the page through the builtin `alerts` source (see [Concepts](../start/CONCEPTS.md#alerts)).

## When none fits

`http-json` covers most JSON APIs without code: several requests merged into one result, any header or query authentication, JSONata to compute each value. When a service needs a login flow, a non-HTTP protocol or real logic, [write a plugin](../extending/PLUGINS.md). Plugins in `config/plugins/` load next to the builtin ones and can replace one by using the same id.
