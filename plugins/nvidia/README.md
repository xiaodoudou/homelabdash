# nvidia

Load, VRAM, power, temperature and fan of NVIDIA GPUs, from one `nvidia-smi` query. It runs over SSH on the machine with the GPUs, or inside the dashboard container when that container has GPU access and no `host` is set.

```yaml
sources:
  gpus:
    plugin: nvidia
    config:
      host: gpu.example
      username: homelabdash
      privateKeyPath: ssh/gpu_ed25519
      tempAlert: 88

sections:
  - title: GPUs
    merge: true
    tiles:
      - { title: GPU0, icon: mdi:expansion-card, source: gpus, options: { gpu: 0 }, graph: [Load] }
      - { title: GPU1, icon: mdi:expansion-card, source: gpus, options: { gpu: 1 }, graph: [Load] }
```

## A key that can only read the GPUs

The plugin only ever runs this one command:

```sh
nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,power.draw,power.limit,temperature.gpu,fan.speed,pstate --format=csv,noheader,nounits
```

So the key can be locked to it. On the GPU machine, give a user without sudo this line in `~/.ssh/authorized_keys` (one line, with the dashboard's public key at the end):

```text
restrict,command="nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,power.draw,power.limit,temperature.gpu,fan.speed,pstate --format=csv,noheader,nounits" ssh-ed25519 AAAA... homelabdash
```

`command=` runs that query whatever the client asks for, and `restrict` turns off shells, port forwarding and the rest. Someone who got the dashboard's key could read your GPU load, and nothing else. Set `hostFingerprint` too, or let the first connection pin the host key.

## Options

`view`: `gpu` (default) shows one GPU (`gpu: 0`, `1`...) as Load, VRAM (share of the card in use, warning from 90%), Used, Power and Temp; `list` shows one row per GPU with its load as a bar, VRAM, power, temperature and fan.

## Config

| key | default | |
|---|---|---|
| `host` | none | machine reached over SSH; without it, `nvidia-smi` runs in the container |
| `port`, `username`, `password`, `privateKey`, `privateKeyPath`, `passphrase`, `hostFingerprint` | | SSH connection, as for the [ssh plugin](../ssh/README.md) |
| `tempAlert` | none | raise an alert while a GPU is at or above this temperature in °C; it turns to an error 5°C above |

Values a card doesn't report (`[N/A]`, `[Not Supported]`) stay empty instead of failing the tile.
