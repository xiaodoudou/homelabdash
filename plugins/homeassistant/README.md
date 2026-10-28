# homeassistant

Entities from Home Assistant: lights, switches, sensors, thermostats and people, as rows or as numbers, a summary of the home, and the updates waiting to be installed. Every tile of a source shares one request per interval, and while the dashboard is open the tiles follow state changes live over Home Assistant's WebSocket API. Lights, switches, fans, input booleans and automations can get a button to turn them on or off.

```yaml
sources:
  home:
    plugin: homeassistant
    config:
      url: http://homeassistant.example:8123
      token: "${secret:HOMEASSISTANT_TOKEN}"
      allowControl: true

sections:
  - title: Home
    tiles:
      - { title: Home, icon: si:homeassistant, source: home, options: { view: summary } }
      - title: Lights
        icon: mdi:lightbulb-group
        source: home
        options:
          entities: [light.kitchen, light.living_room, switch.coffee_machine, { id: person.alex, name: Alex }]
      - title: Climate
        icon: mdi:thermometer
        source: home
        options:
          view: stats
          entities: [{ id: sensor.outdoor_temperature, name: Outside }, climate.living_room]
      - { title: Updates, icon: mdi:package-up, source: home, options: { view: updates }, hideWhen: empty }
```

Create the token in Home Assistant: open your profile, then the Security tab, then Long-lived access tokens. It acts as your user, so the dashboard can do whatever you can; `allowControl` only decides whether the buttons are offered.

## Options

`view`:

| | |
|---|---|
| `entities` (default) | one row per entity in `entities`, with its state; numbers keep their unit, a thermostat shows its temperature and target, an unavailable entity gets a warning badge |
| `stats` | the entities in `entities` side by side as numbers, with their unit |
| `summary` | lights on, people at home (when Home Assistant has people) and pending updates; Updates opens the updates page of Home Assistant. Many devices expose their status LEDs as lights: list the real ones in `entities` and only those count |
| `updates` | each update waiting to be installed, from installed to latest version, linking to its release notes |

`entities`: entity ids, as Home Assistant shows them in Settings > Entities, for example `light.kitchen`. Write `{ id: light.kitchen, name: Kitchen light }` to show another name than Home Assistant's.

A tile can also take a status dot from an entity, with `status: { source: home, key: binary_sensor.nas_online }`: up while it's on, a warning while it's off or away, down while it's unavailable.

## Config

| key | default | |
|---|---|---|
| `url` | required | Home Assistant address, for example `http://homeassistant.example:8123` |
| `token` | required | long-lived access token, sent as a bearer token |
| `insecure` | `false` | accept a self-signed certificate |
| `allowControl` | `false` | offer Turn on / Turn off on lights, switches, fans, input booleans and automations |
| `updateAlerts` | `true` | raise one alert while updates are waiting, which comes back when a newer version appears |

Point `url` at Home Assistant itself rather than at a reverse proxy in front of it, when you can: the dashboard keeps a WebSocket open to it while a page is open, and fetches every entity's state each interval.
