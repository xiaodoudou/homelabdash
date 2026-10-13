# docker

Container states from the Docker API, kept live by the `/events` stream: a status dot flips within a second of a container stopping. Also gives status dots to any tile (`container: name`), alerts for containers that should be running or are unhealthy, and disk usage through a job.

```yaml
sources:
  docker:
    plugin: docker
    config:
      expected: [media-server, dns]     # alert when one of these is not running
      allowControl: false               # true adds start / stop / restart buttons

sections:
  - title: Containers
    tiles:
      - { title: Docker, icon: mdi:docker, source: docker }
      - { title: Problems, source: docker, options: { view: list, show: problems }, span: 2 }
      - { title: Disk, source: docker, options: { view: disk } }
  - title: Apps
    tiles:
      - { title: Media, icon: di:jellyfin, href: http://media.example, container: media-server }
```

`container:` works on any tile as soon as there is exactly one docker source (otherwise set `settings.containerSource` or `status: { source, key }`).

## Config

| key | default | |
|---|---|---|
| `socket` | `/var/run/docker.sock` | mounted into the homelabdash container |
| `url` | | a Docker API or socket proxy instead of the socket |
| `expected` | `[]` | names that must be running |
| `expectedLabel` | `homelabdash.expected` | containers with this label set to `true` are expected too |
| `ignore` | `[]` | names left out entirely |
| `allowControl` | `false` | enable the start / stop / restart actions |

Mounting the socket `:ro` does not restrict the API. For least privilege, run a socket proxy that only allows `GET /containers`, `/events` and `/system/df`, and point `url` at it.

## Options

`view`: `summary` (default), `list`, `disk`. List: `show` (`all`, `running`, `stopped`, `problems`), `containers` (names), `limit`. `problems` lists unhealthy, paused and restarting containers and expected ones that are not running; a container whose health check is still starting is not a problem yet. A stopped container counts as stopped, whatever health status Docker kept from before it stopped.

## Job

`df` (every 30 min, override with `jobs: { df: { schedule: "0 * * * *" } }` on the source): image, volume and build cache sizes for the `disk` view. It is a job because `/system/df` can take a long time on a busy host.
