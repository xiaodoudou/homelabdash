import { fmt } from './format.js'
import { plan, fill } from './layout.js'
import { hidesLabel, compactCell, sectionGroups, isGrid } from './views.js'

/**
 * @typedef {{ value: number, gap: number, padX: number, cellPad: number, family: string }} Metrics
 * @typedef {{ key: string, need: number, cells: number[] | null, flex: number, span: number, start: boolean }} Box
 * @typedef {{ C: number, groups: Record<string, string>, tiles: Record<string, string>, stats: Record<string, { cols: number, wrapped: boolean }> }} Arrangement
 */

/** Widest value of each format, measured instead of the live value so a tile keeps its width as numbers change. */
const SAMPLES = /** @type {Record<string, [string, string]>} */ ({
  byterate: ['888.8', 'KB/s'], bitrate: ['888.8', 'Mb/s'], bytes: ['888.8', 'GB'], bits: ['888.8', 'Mb'],
  percent: ['88.8', '%'], temperature: ['88', '°C'], duration: ['88 88', 'dh'], since: ['88 88', 'dh']
})

/** @type {CanvasRenderingContext2D | null | undefined} */
let canvas
/** @type {Map<string, number>} */
const textWidths = new Map()

/** @param {string} text @param {string} font */
export function textWidth (text, font) {
  const key = `${font}|${text}`
  let w = textWidths.get(key)
  if (w === undefined) {
    if (canvas === undefined) canvas = document.createElement('canvas').getContext('2d')
    if (canvas) {
      canvas.font = font
      w = canvas.measureText(text).width
      textWidths.set(key, w)
    }
  }
  return w ?? text.length * 12
}

/** Sizes the layout reads from the theme, so custom.css and the phone media query are respected. @returns {Metrics} */
export function metrics () {
  const css = getComputedStyle(document.documentElement)
  const px = (/** @type {string} */ name, /** @type {number} */ d) => parseFloat(css.getPropertyValue(name)) || d
  return { value: px('--value', 22), gap: px('--gap', 16), padX: px('--pad-x', 20), cellPad: px('--cell-pad', 16), family: css.getPropertyValue('--font') || 'sans-serif' }
}

/**
 * Width one stat cell needs: its widest value in the value font (units at 0.6em) or its label.
 * @param {any} it @param {boolean} hideLabel @param {Metrics} m
 */
export function cellNeed (it, hideLabel, m) {
  const sample = SAMPLES[it.format]
  const [main, unit] = sample ?? [fmt(it.value, it.format, it.unit), '']
  const vw = textWidth(main, `620 ${m.value}px ${m.family}`) +
    (unit ? textWidth(unit, `500 ${m.value * 0.6}px ${m.family}`) + unit.length * 0.2 * m.value * 0.6 : 0)
  const lw = hideLabel ? 0 : textWidth(String(it.label), `400 12px ${m.family}`) + (it.detail ? 6 + textWidth(String(it.detail), `400 12px ${m.family}`) : 0)
  return Math.ceil(Math.max(56, vw, lw)) + 4
}

/**
 * Lays out every section of a page on the page's shared columns: how many columns, where each group and tile starts and
 * how wide it is, and how many stat columns each tile gets. Tile widths come from the shape of their views (never their
 * live values) and only ever grow, through `widths`, so rows do not jitter while the page is open.
 * @param {{ sections: any[], width: number, metrics: Metrics, tile: (id: string) => any, def: (id: string) => any, hidden: (t: any) => boolean, widths: Map<string, number> }} o
 * @returns {Arrangement}
 */
export function arrange ({ sections, width: W, metrics: m, tile, def, hidden, widths }) {
  const C = W >= 1400 ? 24 : W >= 960 ? 12 : W >= 600 ? 6 : 2
  const unit = (W + m.gap) / C
  const width = (/** @type {number} */ span) => span * unit - m.gap
  /** @type {Arrangement} */
  const out = { C, groups: {}, tiles: {}, stats: {} }

  /** @param {any} t @param {string | undefined} groupTitle @returns {Box} */
  const tileBox = (t, groupTitle) => {
    const st = tile(t.id)
    const view = st?.view
    let need = 220
    let flex = 1
    /** @type {number[] | null} */
    let cells = null
    if (t.bare || t.span === 'full' || view?.type === 'log') need = Infinity
    else if (t.kind === 'link') need = 190
    else if (st?.error && !view) { need = 340; flex = 1.5 } else if (view?.type === 'stats') {
      const hide = hidesLabel(view, [t.title, groupTitle])
      cells = view.items.map((/** @type {any} */ it) => cellNeed(it, hide, m))
      const shown = /** @type {number[]} */ (cells).slice(0, 5)
      need = Math.max(190, shown.reduce((a, b) => a + b, 0) + m.cellPad * (2 * shown.length - 1) + 2 * m.padX + 2)
    } else if (view?.type === 'list') { need = 340; flex = 1.5 } else if (view?.type === 'progress') { need = 320; flex = 1.5 } else if (view?.type === 'text') need = 260
    if (typeof t.span === 'number' && t.span > 1) need = Math.max(need, t.span * 220)
    return grown({ key: t.id, need, cells, flex, span: 1, start: false })
  }

  /** @param {string} key @param {any[]} members @returns {Box} */
  const mergedBox = (key, members) => {
    const compact = members.every(t => compactCell(tile(t.id)?.view, t))
    const need = members.reduce((sum, t) => sum + mergedCellNeed(t, compact), 0) + (members.length - 1) * (compact ? 33 : 41) + 2 * m.padX + 2
    // A card holding a list takes spare width first, like a list tile; a row of plain numbers takes it last.
    const flex = members.some(t => tile(t.id)?.view?.type === 'list') ? 1.5 : compact ? 0.6 : 1
    return grown({ key, need, cells: null, flex, span: 1, start: false })
  }

  /** Width one cell of a merged card needs, without the card padding. @param {any} t @param {boolean} compact */
  const mergedCellNeed = (t, compact) => {
    const view = tile(t.id)?.view
    if (compact) {
      const value = view ? cellNeed(view.items[0], true, m) : 56
      return 30 + 14 + Math.max(value, textWidth(String(def(t.id)?.title ?? t.title ?? ''), `400 12.5px ${m.family}`)) + 4
    }
    if (!view) return 150
    if (view.type === 'list') return 340
    if (view.type === 'stats') return view.items.reduce((/** @type {number} */ a, /** @type {any} */ it) => a + cellNeed(it, false, m), 0) + m.cellPad * (2 * view.items.length - 1)
    return 260
  }

  /** @param {Box} b */
  const grown = b => {
    b.need = Math.max(b.need, widths.get(b.key) ?? 0)
    widths.set(b.key, b.need)
    return b
  }

  for (const s of sections) {
    if (isGrid(s)) continue
    /** @type {{ id: string, span: number, tiles: Box[] }[]} */
    const groups = sectionGroups(s).flatMap((/** @type {any} */ g) => {
      const shown = g.tiles.filter((/** @type {any} */ t) => !hidden(t))
      if (!shown.length && g.hideWhen === 'empty') return []
      const boxes = g.merge && shown.length ? [mergedBox(`${g.id}:merged`, shown)] : shown.map((/** @type {any} */ t) => tileBox(t, g.title))
      return [{ id: g.id, span: 0, tiles: boxes }]
    })
    for (const g of groups) {
      for (const t of g.tiles) {
        t.span = t.need === Infinity
          ? C
          : C <= 2 ? (t.need <= 240 ? 1 : 2) : Math.min(C, Math.max(1, Math.ceil((t.need + m.gap) / unit)))
      }
      g.span = Math.max(1, g.tiles.reduce((a, t) => a + t.span, 0))
    }
    for (const [a, b] of plan(groups.map(g => Math.min(C, g.span)), C)) {
      const row = groups.slice(a, b)
      if (row.length === 1 && row[0].span > C) {
        const g = row[0]
        for (const [x, y] of plan(g.tiles.map(t => t.span), C)) {
          const r = g.tiles.slice(x, y)
          fill(r, C, width)
          r[0].start = true
        }
        out.groups[g.id] = `1 / span ${C}`
      } else {
        fill(row.flatMap(g => g.tiles), C, width)
        row.forEach((g, i) => {
          if (g.tiles[0]) g.tiles[0].start = true
          const span = Math.max(1, g.tiles.reduce((n, t) => n + t.span, 0))
          out.groups[g.id] = i === 0 ? `1 / span ${span}` : `span ${span}`
        })
      }
    }
    for (const g of groups) {
      for (const t of g.tiles) {
        out.tiles[t.key] = t.start ? `1 / span ${t.span}` : `span ${t.span}`
        if (t.cells) out.stats[t.key] = statColumns(t.cells, width(t.span), m)
      }
    }
  }
  return out
}

/**
 * Wraps a tile's stats into balanced rows (2x2, 3+2) when one row of cells does not fit its width.
 * @param {number[]} cells @param {number} w @param {Metrics} m
 */
export function statColumns (cells, w, m) {
  const n = cells.length
  const inner = w - 2 * m.padX - 2
  let cols = n
  if (cells.reduce((a, b) => a + b, 0) + m.cellPad * (2 * n - 1) > inner + 6) {
    const sorted = [...cells].sort((a, b) => b - a)
    let k = n - 1
    while (k > 1 && sorted.slice(0, k).reduce((a, b) => a + b, 0) + 16 * (k - 1) > inner) k--
    cols = Math.ceil(n / Math.ceil(n / k))
  }
  return { cols, wrapped: cols < n }
}
