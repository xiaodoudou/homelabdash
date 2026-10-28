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
