# comfyui

Whether [ComfyUI](https://github.com/comfyanonymous/ComfyUI) is generating, how many jobs wait, how long the last ones took, whether any failed, and its VRAM. It reads `/queue`, `/history` and `/system_stats`; with `allowControl` it can also interrupt the running job and free the VRAM, and it never queues anything. No prompt, workflow or file name reaches the dashboard, only counts, durations and the error of a failed job.

```yaml
sources:
  comfy:
    plugin: comfyui
    config:
      url: http://ai.example:8188
      apiKey: "${secret:COMFYUI_API_KEY}"

sections:
  - title: Images
    tiles:
      - { title: ComfyUI, icon: mdi:image-auto-adjust, source: comfy }
      - { title: Last jobs, icon: mdi:history, source: comfy, options: { view: history } }
```

## Options

`view`:

| | |
|---|---|
| `queue` (default) | Status (generating or idle), Queued (jobs waiting), Last job (how long the last finished job took) |
| `history` | the last jobs, newest first: done with how many outputs, failed with the node and the first line of its error, or interrupted; with their duration |
| `system` | VRAM in use on the first device, free RAM, ComfyUI version |

## Config

| key | default | |
|---|---|---|
| `url` | required | ComfyUI address |
| `apiKey` | none | bearer token, for a ComfyUI behind a login such as ComfyUI-RigShare |
| `insecure` | `false` | accept a self-signed certificate |
| `historySize` | `20` | how many finished jobs to read |
| `failureAlerts` | `true` | raise one alert while recent jobs have failed; dismissing it lasts until another job fails |
| `allowControl` | `false` | buttons on the queue view: Interrupt (stops the running job, only while one runs) and Free VRAM (unloads the models); both ask first and need a second click |
