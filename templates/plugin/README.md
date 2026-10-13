# __ID__

TODO: what this plugin shows and which service it talks to.

```yaml
sources:
  __ID__:
    plugin: __ID__
    config:
      url: http://service.example
      apiKey: "${secret:__ID___KEY}"

tiles:
  - { title: __NAME__, source: __ID__ }
  - { title: __NAME__ list, source: __ID__, options: { view: list } }
```

## Config

| key | default | |
|---|---|---|
| `url` | required | base URL |
| `apiKey` | | API key |

## Options

`view`: `summary` (default), `list`.
