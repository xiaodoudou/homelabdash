/**
 * Splits a sequence of column spans into rows of at most C columns:
 * fewest rows first, then the most even fill (sum of squared leftovers).
 * Neighbours that were given a width (`fixed`) and fit on one row together are never split: their widths were meant
 * as one row.
 * @param {number[]} spans
 * @param {number} C
 * @param {boolean[]} [fixed]
 * @returns {[number, number][]} [start, end) index pairs
 */
export function plan (spans, C, fixed = []) {
  const n = spans.length
  /** @type {boolean[]} joined[i]: no row break between i and i + 1 */
  const joined = []
  for (let i = 0, run = 0; i < n; i++) {
    run = fixed[i] ? run + spans[i] : 0
    joined[i] = !!fixed[i] && !!fixed[i + 1] && run + spans[i + 1] <= C
    if (!joined[i]) run = 0
  }
  /** @type {{ cost: number, rows: [number, number][] }[]} */
  const memo = new Array(n + 1)
  memo[n] = { cost: 0, rows: [] }
  for (let i = n - 1; i >= 0; i--) {
    /** @type {{ cost: number, rows: [number, number][] } | null} */
    let best = null
    let sum = 0
    for (let j = i; j < n; j++) {
      sum += spans[j]
      if (sum > C && j > i) break
      if (joined[j] && j + 1 < n) continue
      const left = Math.max(0, C - sum)
      const cost = memo[j + 1].cost + 1e4 + left * left
      // on a tie the earlier row takes more, so the page reads in the order it was written
      if (!best || cost <= best.cost) best = { cost, rows: [[i, j + 1], ...memo[j + 1].rows] }
    }
    memo[i] = /** @type {{ cost: number, rows: [number, number][] }} */ (best)
  }
  return memo[0].rows
}

/**
 * Hands a row's spare columns, one at a time, to its most cramped tile (need x flex per pixel of width).
 * A tile alone on its row stops growing at 2.5x what it needs, instead of stretching across the page, and a tile with
 * a set width (`fixed`) keeps it.
 * @param {{ need: number, flex: number, span: number, fixed?: number }[]} all
 * @param {number} C
 * @param {(span: number) => number} width
 */
export function fill (all, C, width) {
  let left = C - all.reduce((n, t) => n + t.span, 0)
  const tiles = all.filter(t => !t.fixed)
  const lone = all.length === 1 && tiles.length === 1 && tiles[0].flex === 1 && C > 2
  const ratio = (/** @type {{ need: number, flex: number, span: number }} */ t) => (t.need * t.flex) / width(t.span)
  while (left > 0 && tiles.length) {
    let best = tiles[0]
    for (const t of tiles) if (ratio(t) > ratio(best)) best = t
    if (lone && width(best.span + 1) > best.need * 2.5) break
    best.span++
    left--
  }
}
