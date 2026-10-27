← [Documentation](../README.md)

# Views and formats

Plugins don't draw anything themselves. `render(data, options)` returns a view, a plain object of one of the types below, and the page draws it. Each view is checked against a schema on every render, so an unknown key or a wrong type puts an error on the tile rather than drawing it blank. The types are in [`sdk/index.d.ts`](../../sdk/index.d.ts) and the schemas in [`src/views/schema.js`](../../src/views/schema.js).

Every view type accepts `actions`, buttons under the tile written as `[{ action, title, input?, confirm? }]`, where `action` names one of the plugin's actions. Only return the buttons that make sense right now: Pause while running, Resume while paused. For an action that's hard to undo, `confirm` holds a question such as "Stop this stream?": the first click shows it on the button in red, and only a second click within four seconds runs the action.

## stats

A row of numbers with a label under each.

```js
{ type: 'stats', items: [
  { label: 'CPU', value: 23.4, format: 'percent', warn: 80, crit: 95 },
  { label: 'Down', value: 1048576, format: 'byterate' },
  { label: 'Node', value: 'Tokyo 01', format: 'text' }
] }
```

| Item key | |
|---|---|
| `label`, `value` | `value` is a number, a string or `null` (shown as `-`) |
| `format`, `unit` | see [Formats](#formats); `unit` is appended in small type |
| `warn`, `crit` | the value turns amber, then red, at or above these (at or below with `invert: true`) |
| `tone` | colors the value directly: `ok`, `info`, `warning`, `error`, `neutral` |
| `href` | makes the value a link |

An item can also carry `detail`, a short text drawn beside its label, to give a second reading of the same thing: VRAM as `52%` with `12.4 / 24.0 GB` next to the label. Zeros are drawn dimmed, and a single stat whose label just repeats the tile title ("CPU" in a tile called CPU) drops the label. With `graph:` on the tile, each number gets a line of its last hour underneath.

## list

Rows with a title, a line of detail and an optional value on the right.

```js
{ type: 'list', dense: true, empty: 'Nothing playing', items: [
  { title: 'Example Show: S01E05', subtitle: 'Alice - Living Room TV', icon: 'mdi:play',
    value: endsAt, format: 'until', progress: { value: 40, max: 100, start, end: endsAt } }
] }
```

| View key | |
|---|---|
| `items` | the rows |
| `empty` | text shown when there are no rows |
| `limit` | rows shown before a "Show N more" button |
| `dense` | one line per row: the detail next to the title, progress as a thin line under it |

| Row key | |
|---|---|
| `title`, `subtitle`, `href` | |
| `key` | a stable id for the row, so the page updates it in place |
| `value`, `format` | right-aligned value |
| `time` | a timestamp shown after the subtitle as "5m ago" or "in 2h" |
| `icon` | a glyph at the start of the row, `mdi:<name>` or `si:<name>`, for example `mdi:pause` |
| `badge` | `{ text, tone? }`, a small pill before the title |
| `tone` | a colored dot at the start of the row; the alerts list uses it for severity |
| `progress` | `{ value, max? }` draws a bar under the title. With `start` and `end` (epoch milliseconds) the bar fills by time, in the browser, between two fetches |
| `actions` | buttons on the row, `[{ action, title, input?, confirm? }]` |

## progress

Labelled bars, for quotas and disks.

```js
{ type: 'progress', items: [
  { label: 'Provider A', value: 30e9, max: 100e9, format: 'bytes', detail: '28% - expires 2030-01-01', warn: 90, crit: 100 }
] }
```

Here `warn` and `crit` are percentages of `max`, and `detail` replaces the text to the right of the label. A `null` value shows the detail next to a warning dot instead of an empty bar, which is how a plugin says the service didn't answer.

## text and log

`{ type: 'text', text, tone?, mono? }` is a paragraph, for a status line or a message such as "conntrack is off".

`{ type: 'log', lines, follow? }` is a scrolling block of lines, each a string or `{ text, time?, tone? }`, that sticks to the bottom unless you've scrolled up. The `ssh` plugin uses it to follow a log file.

## custom

`{ type: 'custom', ... }`, with any other keys you like, is the way out when no type fits: the plugin ships a `widget.js` that defines a custom element, and the page hands it the view. The types above are still the better choice when one fits, since they come with the theme, the layout and the checks.

## Formats

| Format | Value | Shown as |
|---|---|---|
| `number` | number | `1,234`, three significant digits below 1,000 (`12.5`) |
| `percent` | number, 0 to 100 | `7.5%`, `42%` |
| `bytes` | bytes | `233 GB` (powers of 1024) |
| `bits` | bits | `1.2 Gb` |
| `bitrate` | bits per second | `18.8 Mb/s` |
| `byterate` | bytes per second | `1.75 MB/s` |
| `duration` | seconds | `21d 15h`, `3h 52m`, `14m`, `2m 30s` |
| `clock` | seconds | `00:14:56` |
| `until` | timestamp | time left, as `00:14:56`, counting down every second in the browser |
| `since` | timestamp | time elapsed, as a duration |
| `relativeTime` | timestamp | `5m ago`, `in 2h` |
| `date`, `datetime` | timestamp | in the browser's locale |
| `temperature` | degrees Celsius | `63°C` |
| `text` | anything | as is |

Timestamps can be milliseconds or seconds since 1970, or an ISO string. Units are drawn smaller than the number, so `1.75 MB/s` reads as a number first.

## Tones

`ok`, `info`, `warning`, `error` and `neutral` map to green, blue, amber, red and gray in both themes.
