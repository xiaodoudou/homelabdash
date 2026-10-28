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

## An account that can only do this

The dashboard keeps its SSH key on disk, so treat that key as something that can leak. Give it an account where a leaked key gets someone nowhere.

1. Create the key on the machine running the dashboard, inside the config folder, readable only by the container's user:

   ```sh
   mkdir -p config/ssh
   ssh-keygen -t ed25519 -N "" -C homelabdash -f config/ssh/myhost_ed25519
   chmod 600 config/ssh/myhost_ed25519
   ```

2. On the target, make a user for it with no password and no sudo:

   ```sh
   sudo useradd --create-home --shell /bin/sh homelabdash
   sudo passwd -l homelabdash
   ```

3. Put the public key in that user's `~/.ssh/authorized_keys` (mode 600, the directory 700) with a forced command in front:

   ```text
   restrict,command="cat /proc/uptime" ssh-ed25519 AAAA... homelabdash
   ```

   `command=` runs that one command whatever the client asks for, and `restrict` turns off the shell, port and agent forwarding and the terminal. Point `run:` in the source at the same command; the output is what counts.

4. Pin the host key: `hostFingerprint` takes what `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` prints on the target.

Check it from the dashboard's machine: `ssh -i config/ssh/myhost_ed25519 homelabdash@myhost whoami` should print the forced command's output, not the user name.

A forced command covers one command, so a source that runs several needs either one key (and one source) per command, or a small read-only script on the target that prints everything, set as the forced command. Some systems, Unraid among them, have no ordinary shell users; there the key goes to root, and the forced command is what keeps it to that one read.

## Config

Connection: `host`, `port` (22), `username`, and `privateKeyPath`, `privateKey` or `password` (use `${secret:...}`), `passphrase`. `hostFingerprint` (`SHA256:...` from `ssh-keygen -lf`) pins the host key; without it the first key seen is trusted and stored in the data folder, and a changed key is refused.

`commands.<name>`: `run`, `parse` (`text`, `number`, `lines`, `kv`, `json`), `timeout` (ms), `alert` (`above`, `below`, `match`, `failed`, `severity`, `message`).

`follow`: a command that keeps running (`tail -n 50 -F file`, `logread -f`, `journalctl -f`). Its lines are pushed to the browser as they arrive while a dashboard is open, and the connection is closed when nobody is watching.

## Options

`view`: `auto` (log if `follow` is set, else stats if `items`, else text), `stats` (`items: [{ command, field?, label, format?, unit?, warn?, crit? }]`), `text` (`command`: output of one command), `log` (`filter` regex, `lines`, `highlight`).

All commands of a source share one SSH connection, which closes after a minute without use.
