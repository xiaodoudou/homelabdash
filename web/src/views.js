/** What views and layout agree on, without any rendering: kept apart so the layout and the tests can use it. */

const UNIT_FORMATS = new Set(['number', 'percent', 'bytes', 'bits', 'bitrate', 'byterate', 'duration', 'since', 'temperature'])

/** What `hideWhen: empty` hides: no rows, no text, or stats that are all zero (an idle player, an empty queue). @param {any} view */
export function isEmpty (view) {
  if (!view) return true
  if (view.type === 'stats') return view.items.every((/** @type {any} */ it) => it.value === 0 || it.value === null)
  if (view.type === 'list' || view.type === 'progress') return !view.items.length
  if (view.type === 'log') return !view.lines.length
  if (view.type === 'text') return !view.text
  return false
}

/**
 * A formatted value split into number and unit parts, so the unit can be drawn smaller: "30.7 KB/s" reads as a number first.
 * @param {string} text @param {string | undefined} format @param {string | undefined | null} unit
 * @returns {{ text: string, unit: boolean }[]}
 */
export function valueParts (text, format, unit) {
  if (!(UNIT_FORMATS.has(/** @type {string} */ (format)) || format === undefined || unit) || !/\d/.test(text)) return [{ text, unit: false }]
  return text.split(/\s*([^\d.,\s-]+)/).map((p, i) => ({ text: p, unit: i % 2 === 1 })).filter(p => p.text)
}

/** A single stat whose label repeats the tile or group title ("CPU" under CPU) shows no label. @param {any} view @param {(string | undefined)[]} titles */
export function hidesLabel (view, titles) {
  if (view.items.length !== 1) return false
  const label = String(view.items[0].label).toLowerCase()
  return titles.some(t => t && t.toLowerCase() === label)
}

/** A merged-card tile that can show as icon, value and title: one stat without a graph, or no data yet. @param {any} view @param {any} t */
export function compactCell (view, t) {
  return !view || (view.type === 'stats' && view.items.length === 1 && !t.graph)
}

/** The groups a section lays out: its own, or its tiles as one untitled group so they share the page columns. @param {any} s */
export function sectionGroups (s) {
  return s.groups?.length ? s.groups : [{ id: `${s.id}.tiles`, tiles: s.tiles, hideWhen: 'never', merge: s.merge }]
}

/** Sections with `layout.columns` or `layout.minTileWidth` keep a plain CSS grid instead of the page columns. @param {any} s */
export function isGrid (s) {
  return !!(s.layout?.columns || s.layout?.minTileWidth)
}

/** "qBittorrent answered 403: add ..." split into its first clause and the advice after it. @param {string} err */
export function errorParts (err) {
  const at = err.indexOf(': ')
  const rest = at > 0 ? err.slice(at + 2) : ''
  return { head: at > 0 ? err.slice(0, at) : err, rest: rest ? rest[0].toUpperCase() + rest.slice(1) : '' }
}
