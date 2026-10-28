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
| `model` (default) | the loaded model (or "none loaded", or its state while it starts), the generation and prompt speed of the last request in tokens per second, and Active, the requests running now; while a request runs the speeds are live estimates (or -- tok/s until one is known), and they read "idle" once `idleAfter` seconds pass without a request. With several models loaded (llama-swap groups), it reads "2 models" with their names |
| `models` | one row per loaded model: its state, when it unloads, and the speed of its own last request |
| `gpu` | one GPU (`gpu: 0`, `1`...): load, VRAM in use as a share of the card (warning from 90%) with the GB beside its label, power draw, temperature |
| `host` | average CPU over all cores, RAM in use as a share with the GB beside its label, 1-minute load average |
| `activity` | the last requests, newest first: model, tokens out and in, speed; a failed one is marked |

Finished requests come from llama-swap's activity log, with the speeds the backend reported. vLLM reports none, so for it the plugin divides the output tokens by the request's duration, which undercounts a little because that time includes reading the prompt, and leaves the Prompt stat out.

Running requests come from llama-swap's event stream (`/api/events`, which its own Activity page uses) while the dashboard is open. The stream counts bytes, not tokens. Each finished request tells the plugin how many bytes that model sends per token, and the live speed is the byte rate divided by that, updated about once a second. Until a model has finished one request, it reads -- tok/s.

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
