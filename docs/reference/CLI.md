← [Documentation](../README.md)

# CLI

`homelabdash` is both the server and the tool around it. It's on the path inside the image, so every command also works as `docker exec homelabdash homelabdash <command>`; from a clone, run `node bin/homelabdash.js <command>`.

The config folder is `--config-dir`, else `$HOMELABDASH_CONFIG`, else `/config` when it exists, else `./config`. The data folder is `--data-dir`, else `$HOMELABDASH_DATA`, else `/data` when it exists, else `./data`.

## serve

```sh
homelabdash serve [--config-dir DIR] [--data-dir DIR] [--port 3000] [--host 0.0.0.0]
```

Runs the dashboard (`PORT` and `HOST` in the environment work too). It writes a starter `homelabdash.yaml` into an empty config folder, then watches the folder and applies every change you save. When you're working on the repository, `--watch-builtin` also reloads the builtin plugins as their files change.

## validate

```sh
homelabdash validate [--config-dir DIR] [--json]
```

Checks every file of the config folder, with the schema of every plugin it uses, and prints `ok` or one line per problem:

```
/config/homelabdash.yaml:12:13 sources.sonarr.config.apiKey: is required
/config/homelabdash.yaml:12:46 sources.sonarr.config.apikey: unknown property (allowed: url, apiKey, apiVersion, healthAlerts)
```

It exits with 1 when something is wrong, and `--json` prints the problems as JSON instead.

## schema

```sh
homelabdash schema [--config-dir DIR] [--out FILE]
```

Writes `.schema/config.schema.json` into the config folder, the config schema with the settings and options of every installed plugin included. To point your editor's YAML extension at it, start `homelabdash.yaml` with:

```yaml
# yaml-language-server: $schema=./.schema/config.schema.json
```

## plugin

| Command | |
|---|---|
| `plugin list` | the installed plugins, builtin and yours, with their version and any load error |
| `plugin info <id>` | settings, display options, actions, jobs and examples of a plugin |
| `plugin new <id>` | scaffolds `config/plugins/<id>/` with `index.js`, `README.md`, `fixtures/http.json` and `plugin.test.js`; `--builtin` puts it in the repository's `plugins/`, `--dir` anywhere |
| `plugin run <id>` | runs the plugin once and prints its views, alerts, statuses and data |
| `plugin test [id]` | the contract check and the plugin's own tests, for one plugin or all |
| `plugin capture <id>` | calls the real service and records its answers as fixtures, with hosts, addresses and key-looking values replaced |

`plugin run` uses the plugin's first example and its fixtures by default, so it works with no service at hand:

| Option | |
|---|---|
| `--example N` | another example |
| `--config JSON` or `--config @file.json` | your own settings |
| `--source ID` | the settings of a source of your config, against the real service |
| `--options JSON` | display options; repeat it for several tiles |
| `--fixtures` | answer from fixtures even with `--config` |
| `--job NAME` | run a job, then fetch |
| `--action NAME --input JSON` | run an action |
| `--stream SECONDS` | run the stream for that long and print each update |
| `--quiet` | print the views only |
