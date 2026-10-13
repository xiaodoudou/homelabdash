# ssh

Runs commands on a host over SSH on every poll and follows a log live. Good for anything without an API: a router, a Raspberry Pi, a NAS shell.

```yaml
sources:
  router:
    plugin: ssh
    interval: 30s
    config:
      host: router.example
      username: monitor
      privateKeyPath: ssh/id_ed25519        # relative to the config folder
      commands:
        conntrack: { run: cat /proc/sys/net/netfilter/nf_conntrack_count, parse: number, alert: { above: 50000 } }
        mem: { run: "awk '/MemTotal|MemAvailable/ {print $1 $2*1024}' /proc/meminfo", parse: kv }
      follow: { command: logread -f, lines: 300 }

tiles:
  - title: Router
    source: router
    options:
      view: stats
      items:
        - { command: conntrack, label: Conns }
        - { command: mem, field: MemAvailable, label: Free RAM, format: bytes }
  - { title: Router log, source: router, options: { view: log, filter: "err|warn" }, span: full }
```

## Config

Connection: `host`, `port` (22), `username`, and `privateKeyPath`, `privateKey` or `password` (use `${secret:...}`), `passphrase`. `hostFingerprint` (`SHA256:...` from `ssh-keygen -lf`) pins the host key; without it the first key seen is trusted and stored in the data folder, and a changed key is refused.

`commands.<name>`: `run`, `parse` (`text`, `number`, `lines`, `kv`, `json`), `timeout` (ms), `alert` (`above`, `below`, `match`, `failed`, `severity`, `message`).

`follow`: a command that keeps running (`tail -n 50 -F file`, `logread -f`, `journalctl -f`). Its lines are pushed to the browser as they arrive while a dashboard is open, and the connection is closed when nobody is watching.

## Options

`view`: `auto` (log if `follow` is set, else stats if `items`, else text), `stats` (`items: [{ command, field?, label, format?, unit?, warn?, crit? }]`), `text` (`command`: output of one command), `log` (`filter` regex, `lines`, `highlight`).

All commands of a source share one SSH connection, which closes after a minute without use.
