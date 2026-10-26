// Types for homelabdash plugins. Plugins never import core code at runtime; reference these from JSDoc:
//   /** @type {import('homelabdash/sdk').Plugin} */
//   export default { ... }

export type JSONSchema = Record<string, any>

/** Known values first for completion; plain strings are accepted because JS widens literals, and the view schema checks them at runtime. */
type Loose<T extends string> = T | (string & {})

/** Display formats understood by the frontend. */
export type Format = Loose<
  | 'number' | 'percent' | 'bytes' | 'bits' | 'bitrate' | 'byterate'
  | 'duration' | 'clock' | 'until' | 'since' | 'relativeTime' | 'date' | 'datetime' | 'temperature' | 'text'>

export type Tone = Loose<'ok' | 'info' | 'warning' | 'error' | 'neutral'>

export interface StatItem {
  label: string
  value: number | string | null
  format?: Format
  unit?: string
  /** Value at or above which the item turns warning / error (lower when `invert` is true). */
  warn?: number
  crit?: number
  invert?: boolean
  /** Colour the value directly (for text values such as "yes" / "down"); warn/crit thresholds win for numbers. */
  tone?: Tone
  href?: string
}

export interface ListAction {
  /** Action name (a key of the plugin's `actions`). On the alerts tile: "dismiss" or "run". */
  action: string
  title: string
  input?: unknown
  /** For actions that are hard to undo: the first click shows this question on the button, a second click runs it. */
  confirm?: string
}

export interface ListItem {
  key?: string
  title: string
  /** Colours the row's edge (alerts use it); for a status pill use `badge`. */
  tone?: Tone
  subtitle?: string
  value?: number | string
  format?: Format
  href?: string
  time?: string | number
  badge?: { text: string, tone?: Tone }
  /** Glyph at the start of the row: `mdi:<name>` or `si:<name>`, e.g. `mdi:pause`. */
  icon?: string
  /** `start` and `end` (epoch ms) make the bar fill by time, ticking in the browser. */
  progress?: { value: number, max?: number, start?: number, end?: number }
  actions?: ListAction[]
}

export interface ProgressItem {
  label: string
  /** null: no bar, `detail` explains why (a failed source, no data yet). */
  value: number | null
  max?: number
  format?: Format
  /** Text shown on the right instead of the formatted value. */
  detail?: string
  warn?: number
  crit?: number
}

/** Buttons under the tile. Return only the ones that make sense now (e.g. Resume while paused, nothing unless control is allowed). */
type TileActions = { actions?: ListAction[] }

export type View =
  | ({ type: 'stats', items: StatItem[] } & TileActions)
  | ({ type: 'list', items: ListItem[], limit?: number, empty?: string, dense?: boolean } & TileActions)
  | ({ type: 'progress', items: ProgressItem[] } & TileActions)
  | ({ type: 'text', text: string, tone?: Tone, mono?: boolean } & TileActions)
  | ({ type: 'log', lines: (string | { time?: string | number, text: string, tone?: Tone })[], follow?: boolean } & TileActions)
  | { type: 'custom', [key: string]: unknown }

export interface Alert {
  /** Stable id: a dismissed alert comes back when the id changes, so include what makes it "new" (e.g. a date). */
  id: string
  severity?: Loose<'info' | 'warning' | 'error'>
  title?: string
  message?: string
  href?: string
  time?: string | number
  /** Buttons that run one of the plugin's actions. */
  actions?: { name: string, title?: string, input?: unknown }[]
}

export type Status = Loose<'up' | 'down' | 'warn' | 'unknown'> | { state: Loose<'up' | 'down' | 'warn' | 'unknown'>, label?: string }

export interface HttpOptions {
  method?: string
  headers?: Record<string, string | number>
  query?: Record<string, string | number | boolean | null | undefined>
  /** JSON body (sets content-type, defaults method to POST). */
  json?: unknown
  /** Form body (application/x-www-form-urlencoded). */
  form?: Record<string, string>
  body?: string | Buffer
  auth?: { bearer?: string, basic?: { username: string, password: string }, header?: string, value?: string }
  /** Milliseconds, default 10000. */
  timeout?: number
  /** Retries on network errors and 5xx. Default 1 for GET, 0 otherwise. */
  retries?: number
  /** Talk HTTP over a unix socket, e.g. /var/run/docker.sock. */
  socketPath?: string
  /** Accept self-signed certificates. */
  insecure?: boolean
  parse?: 'auto' | 'json' | 'text'
  /** Default true: a status >= 400 throws an HttpError. */
  throwOnError?: boolean
  signal?: AbortSignal
}

export interface HttpResponse<T = any> {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: T
  url: string
}

export interface SshTarget {
  host: string
  port?: number
  username: string
  password?: string
  /** PEM private key (use a ${secret:...}). */
  privateKey?: string
  /** Path to a private key file, relative to the config folder. */
  privateKeyPath?: string
  passphrase?: string
  /** "SHA256:..." as printed by ssh-keygen -lf. Without it the first key seen is trusted and pinned. */
  hostFingerprint?: string
  timeout?: number
}

export interface WsConnection extends AsyncIterable<any> {
  opened?: Promise<unknown>
  send (data: unknown): Promise<void> | void
  close (): void
}

export interface Context<C = Record<string, any>> {
  /** Source id from the config. */
  source: string
  /** The source's `config`, validated against the plugin's `config` schema, defaults applied. */
  config: C
  /** Tiles showing this source and their `options`. */
  tiles: { id: string, options: Record<string, any> }[]
  /** Aborted on timeout (fetch, job, action) or when a stream must stop. */
  signal: AbortSignal
  /** Latest data from fetch() or emit(). */
  readonly data: any
  /** Small persisted key/value store for this source (session tokens, job results, counters). */
  state: {
    get<T = any> (key: string, fallback?: unknown): T
    set (key: string, value: unknown): void
    delete (key: string): void
    all (): Record<string, any>
  }
  log: { debug (...a: unknown[]): void, info (...a: unknown[]): void, warn (...a: unknown[]): void, error (...a: unknown[]): void }
  /** Ask the core to run fetch() again now. */
  refresh (): void
  http: {
    request<T = any> (url: string, o?: HttpOptions): Promise<HttpResponse<T>>
    json<T = any> (url: string, o?: HttpOptions): Promise<T>
    text (url: string, o?: HttpOptions): Promise<string>
    /** One item per line of a streamed response (JSON-parsed when possible). */
    stream (url: string, o?: HttpOptions): AsyncGenerator<any>
  }
  ws: {
    connect (url: string, o?: { headers?: Record<string, string>, protocols?: string[], signal?: AbortSignal, parse?: 'auto' | 'text', insecure?: boolean }): WsConnection
  }
  ssh: {
    exec (target: SshTarget, command: string, o?: { timeout?: number, signal?: AbortSignal }): Promise<{ stdout: string, stderr: string, code: number | null }>
    /** Runs a long-lived command and yields stdout lines, e.g. `tail -F /var/log/syslog`. */
    lines (target: SshTarget, command: string, o?: { signal?: AbortSignal }): AsyncGenerator<string>
  }
  tcp: {
    check (host: string, port: number, o?: { timeout?: number }): Promise<{ ok: boolean, ms: number, error?: string }>
    request (host: string, port: number, payload: string | Buffer, o?: { timeout?: number, until?: string | RegExp, maxBytes?: number }): Promise<Buffer>
  }
  ping (host: string, o?: { timeout?: number }): Promise<{ ok: boolean, ms: number | null }>
  dns: {
    resolve (name: string, type?: string): Promise<any>
    reverse (ip: string): Promise<string[]>
  }
  /** Runs a program inside the container, without a shell. */
  exec (command: string, args?: string[], o?: { timeout?: number, cwd?: string, env?: Record<string, string>, input?: string }): Promise<{ stdout: string, stderr: string, code: number | null }>
}

export interface Job<C = any> {
  /** 5-field cron (local time), @hourly/@daily/..., or a duration such as "10m". Sources can override it. */
  schedule: string
  description?: string
  timeout?: string | number
  /** Re-run fetch() (or render) after the job. Default true. */
  refresh?: boolean
  run (ctx: Context<C>): Promise<unknown> | unknown
}

export interface Action<C = any> {
  title?: string
  description?: string
  /** JSON Schema of the input, for documentation. */
  input?: JSONSchema
  run (ctx: Context<C>, input: any): Promise<unknown> | unknown
}

export interface Plugin<C = any, D = any> {
  /** Must match the folder name. */
  id?: string
  name?: string
  version?: string
  description?: string
  /** Default polling interval ("30s"); sources can override. */
  interval?: string | number
  /** Default timeout for fetch, actions ("10s"). */
  timeout?: string | number
  /** Minimum time between two renders while streaming. Default 250ms. */
  throttle?: string | number
  /** Keep stream() running while no browser is connected. */
  keepStreaming?: boolean
  /** JSON Schema of the source `config` (connection settings, secrets). */
  config?: JSONSchema
  /** JSON Schema of each tile's `options` (what to display). */
  options?: JSONSchema
  /** Poll: return the data every tile of this source renders from. */
  fetch? (ctx: Context<C>): Promise<D> | D
  /** Realtime: keep a connection open and call emit(data) (or emit(prev => next)) whenever something changes. */
  stream? (ctx: Context<C>, emit: (next: D | ((prev: D | undefined) => D)) => void): Promise<void>
  /** Turn data into a view for one tile. Without it, fetch() must return a view. */
  render? (data: D, options: Record<string, any>, ctx: Context<C>): View | null | Promise<View | null>
  /** Alerts shown in the built-in alerts source. */
  alerts? (data: D, ctx: Context<C>): Alert[] | Promise<Alert[]>
  /** Status dot for tiles that point at this source with `status: { key }` (or `container:`). */
  status? (data: D, key: string, ctx: Context<C>): Status | null | Promise<Status | null>
  actions?: Record<string, Action<C>>
  jobs?: Record<string, Job<C>>
  /**
   * Ready-to-run configurations. The contract test renders each one against fixtures/, every enum
   * value of `options` must appear in one, and `homelabdash plugin run <id>` runs the first.
   */
  examples?: Example[]
}

export interface Example {
  title: string
  description?: string
  config: Record<string, any>
  /** One tile with these options (or use `tiles`). */
  options?: Record<string, any>
  tiles?: { id?: string, options?: Record<string, any> }[]
  statusKeys?: { tileId: string, key: string }[]
}
