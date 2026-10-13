const NUMERIC_FORMATS = new Set([undefined, 'number', 'percent', 'bytes', 'bits', 'bitrate', 'byterate', 'duration', 'temperature'])

/**
 * Rolling history of the numeric stats of tiles that ask for a graph: one point per `step`
 * (the newest value inside a step wins), `window` long. Persisted so a restart keeps the graphs.
 */
export class History {
  /**
   * @param {import('./store.js').Store} store
   * @param {{ window?: number, step?: number }} [o]
   */
  constructor (store, o = {}) {
    this.store = store
    this.window = o.window ?? 3_600_000
    this.step = o.step ?? 10_000
    /** @type {Record<string, Record<string, { t: number[], v: number[] }>>} */
    this.series = store.get('history', {})
    /** @type {NodeJS.Timeout | null} */
    this.saveTimer = null
  }

  /**
   * @param {string} tileId
   * @param {any} view
   * @param {true | string[]} labels which stats to keep
   * @param {number} [now]
   */
  record (tileId, view, labels, now = Date.now()) {
    if (view?.type !== 'stats') return
    const tile = (this.series[tileId] ??= {})
    const seen = new Set()
    for (const item of view.items) {
      // Series are keyed by label: a repeated label ("Used" as % then as bytes) keeps the first one.
      if (seen.has(item.label)) continue
      seen.add(item.label)
      if (labels !== true && !labels.includes(item.label)) continue
      if (typeof item.value !== 'number' || !Number.isFinite(item.value) || !NUMERIC_FORMATS.has(item.format)) continue
      const s = (tile[item.label] ??= { t: [], v: [] })
      const last = s.t.length - 1
      if (last >= 0 && Math.floor(s.t[last] / this.step) === Math.floor(now / this.step)) {
        s.t[last] = now
        s.v[last] = item.value
      } else {
        s.t.push(now)
        s.v.push(item.value)
      }
      const cut = s.t.findIndex(t => t >= now - this.window)
      if (cut > 0) { s.t.splice(0, cut); s.v.splice(0, cut) }
    }
    this.saveTimer ??= setTimeout(() => { this.saveTimer = null; this.store.set('history', this.series) }, 60_000)
    this.saveTimer.unref?.()
  }

  /** Latest point of each series of a tile: what a live update carries. @param {string} tileId */
  last (tileId) {
    const tile = this.series[tileId]
    if (!tile) return null
    /** @type {Record<string, [number, number]>} */
    const out = {}
    for (const [label, s] of Object.entries(tile)) {
      if (s.t.length) out[label] = [s.t[s.t.length - 1], s.v[s.v.length - 1]]
    }
    return out
  }

  /** Full series of these tiles, sent once when a browser connects. @param {string[]} tileIds */
  dump (tileIds) {
    /** @type {Record<string, Record<string, { t: number[], v: number[] }>>} */
    const out = {}
    for (const id of tileIds) if (this.series[id]) out[id] = this.series[id]
    return out
  }

  /** Drops tiles that no longer graph anything. @param {Map<string, true | string[]>} wanted */
  keep (wanted) {
    for (const id of Object.keys(this.series)) {
      const labels = wanted.get(id)
      if (!labels) { delete this.series[id]; continue }
      if (labels !== true) for (const label of Object.keys(this.series[id])) if (!labels.includes(label)) delete this.series[id][label]
    }
  }

  flush () {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
    this.store.set('history', this.series)
  }
}
