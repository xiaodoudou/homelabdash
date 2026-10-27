# llama-swap

What [llama-swap](https://github.com/mostlygeek/llama-swap) has loaded and how fast it answers, plus the GPU, CPU and memory gauges it reports. Every tile of a source shares the same three read-only requests per interval: `/running`, `/metrics` and `/api/metrics/activity`. The plugin never sends a completion and never touches a backend directly, so watching the dashboard can't load or swap a model. The only thing it can change is unloading the current model, with `allowControl` and a confirmed click.

```yaml
sources:
  ai:
    plugin: llama-swap
    config: { url: http://ai.example:8080 }

sections:
  - title: AI server
    merge: true
    tiles:
      - { title: Model, icon: mdi:brain, source: ai, graph: [Generation] }
      - { title: GPU0, icon: mdi:expansion-card, source: ai, options: { view: gpu, gpu: 0 }, graph: [Load] }
      - { title: GPU1, icon: mdi:expansion-card, source: ai, options: { view: gpu, gpu: 1 }, graph: [Load] }
      - { title: Host, icon: mdi:server, source: ai, options: { view: host } }
```

## Options

`view`:

| | |
|---|---|
| `model` (default) | the loaded model (or "none loaded", or its state while it starts), and the generation and prompt speed of the last request in tokens per second; both read "idle" once `idleAfter` seconds pass without a request. With several models loaded (llama-swap groups), it reads "2 models" with their names |
| `models` | one row per loaded model: its state, when it unloads, and the speed of its own last request |
| `gpu` | one GPU (`gpu: 0`, `1`...): load, VRAM in use as a share of the card (warning from 90%) and in GB, power draw, temperature |
| `host` | average CPU over all cores, RAM in use, 1-minute load average |
| `activity` | the last requests, newest first: model, tokens out and in, speed; a failed one is marked |

Speeds come from llama-swap's activity log, which records each request once it has finished. A request still streaming shows up when it ends.

A tile can take a status dot from a model, `status: { source: ai, key: my-model }`: up while it's loaded and ready.

## Config

| key | default | |
|---|---|---|
| `url` | required | llama-swap address |
| `apiKey` | none | bearer token, when llama-swap is set up with `apiKeys` |
| `insecure` | `false` | accept a self-signed certificate |
| `idleAfter` | `300` | seconds after the last request when the speeds read idle |
| `allowControl` | `false` | Unload buttons, each asking first and needing a second click: on the model view ("Unload all" when several models are loaded) and on each row of the models view. It unloads through llama-swap, whichever backend (vLLM, llama.cpp) runs the model |

The gauges and the activity log are newer llama-swap features (both are in v260). An older llama-swap without them still shows the model, and the GPU and host views say there is nothing to show.
