import type { Alert } from './index.js'

export interface RunOptions {
  /** Source config (validated against the plugin schema, defaults applied). */
  config?: Record<string, any>
  /** Options of a single tile with id "tile". */
  options?: Record<string, any>
  /** Several tiles instead of `options`. */
  tiles?: { id: string, options?: Record<string, any> }[]
  statusKeys?: { tileId: string, key: string }[]
  state?: Record<string, any>
  /** true (default): answer from the plugin's fixtures/*.json. An object: these fixtures. false: real network. */
  fixtures?: boolean | Record<string, any>
  /** Run this job first. */
  job?: string
  /** Run this action first, with `input`. */
  action?: string
  input?: unknown
  /** Run stream() and collect updates (stops at `updates` emits, stream end, or `timeout` ms). */
  stream?: boolean | { updates?: number, timeout?: number }
  timeout?: number
  sourceId?: string
  dataDir?: string
  configDir?: string
  capture?: boolean
}

export interface RunResult {
  meta: Record<string, any>
  data: any
  // Views are loosely typed here so tests can reach into them without narrowing first.
  views: Record<string, { view?: any, error?: string }>
  /** View of the first tile. */
  view: any
  alerts: Alert[]
  alertsError?: string
  statuses: Record<string, { state: 'up' | 'down' | 'warn' | 'unknown', label?: string }>
  state: Record<string, any>
  result: unknown
  updates: { data: any, derived: any }[]
  logs: { level: string, msg: string }[]
  captured?: Record<string, any>
  durationMs: number
}

export function runPlugin (dir: string, o?: RunOptions): Promise<RunResult>
