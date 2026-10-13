/**
 * Splits a sequence of column spans into rows of at most C columns:
 * fewest rows first, then the most even fill (sum of squared leftovers).
 * @param {number[]} spans
 * @param {number} C
 * @returns {[number, number][]} [start, end) index pairs
 */
export function plan (spans, C) {
  const n = spans.length
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
      const left = Math.max(0, C - sum)
      const cost = memo[j + 1].cost + 1e4 + left * left
      if (!best || cost < best.cost) best = { cost, rows: [[i, j + 1], ...memo[j + 1].rows] }
    }
    memo[i] = /** @type {{ cost: number, rows: [number, number][] }} */ (best)
  }
  return memo[0].rows
}

/**
 * Hands a row's spare columns, one at a time, to its most cramped tile (need x flex per pixel of width).
 * A tile alone on its row stops growing at 2.5x what it needs, instead of stretching across the page.
 * @param {{ need: number, flex: number, span: number }[]} tiles
 * @param {number} C
 * @param {(span: number) => number} width
 */
export function fill (tiles, C, width) {
  let left = C - tiles.reduce((n, t) => n + t.span, 0)
  const lone = tiles.length === 1 && tiles[0].flex === 1 && C > 2
  const ratio = (/** @type {{ need: number, flex: number, span: number }} */ t) => (t.need * t.flex) / width(t.span)
  while (left > 0 && tiles.length) {
    let best = tiles[0]
    for (const t of tiles) if (ratio(t) > ratio(best)) best = t
    if (lone && width(best.span + 1) > best.need * 2.5) break
    best.span++
    left--
  }
}
