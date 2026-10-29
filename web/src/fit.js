import { plan } from './layout.js'

/** The gap between cards, read from the theme so custom.css and the phone media query count. */
export function pageGap () {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gap')) || 16
}

/**
 * Cuts each section's groups into rows: fewest rows, then the most even fill, from the width each group takes at its
 * content size as the browser draws it. A group with `width: 45%` takes that share as given: when its content is wider,
 * fit() wraps the numbers instead of moving the group to another row.
 * `seen` keeps the widest each group has been so rows only change when a group grows.
 * @param {ParentNode} root @param {number} W @param {number} gap @param {Map<string, number>} seen
 * @returns {Record<string, string[][]>}
 */
export function planRows (root, W, gap, seen) {
  /** @type {Record<string, string[][]>} */
  const out = {}
  for (const box of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.groups[data-groups]'))) {
    const groups = /** @type {HTMLElement[]} */ ([...box.querySelectorAll(':scope > .group-row > .group')])
    box.classList.add('is-measuring')
    const widths = groups.map(g => {
      const w = Math.max(g.getBoundingClientRect().width, seen.get(g.dataset.section ?? '') ?? 0)
      seen.set(g.dataset.section ?? '', w)
      return w
    })
    box.classList.remove('is-measuring')
    const pct = groups.map(g => parseFloat(g.style.getPropertyValue('--pct')) || 0)
    const spans = widths.map((w, i) => Math.min(24, pct[i] ? pct[i] / 100 * 24 : ((w + gap) / (W + gap)) * 24))
    out[box.dataset.groups ?? ''] = plan(spans, 24.001, pct.map(Boolean)).map(([a, b]) => groups.slice(a, b).map(g => g.dataset.section ?? ''))
  }
  return out
}

/**
 * Marks the stacks whose groups went under each other, so they share its height evenly: a stack is a wrapping row,
 * and only where its groups landed says whether they fit side by side.
 * @param {ParentNode} root
 */
export function stack (root) {
  for (const s of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.stack-groups'))) {
    s.classList.remove('is-stacked')
    const tops = new Set([...s.children].map(c => /** @type {HTMLElement} */ (c).offsetTop))
    s.classList.toggle('is-stacked', tops.size > 1)
  }
}

/**
 * Wraps the numbers of the cards that are wider than the room the page gives them. The browser sizes and places the
 * cards (theme.css); this only reads what it drew, so no text is estimated. While a card overflows, its stats block with
 * the most columns (then the widest) loses one, rounded to balanced rows (4 as 2x2, 3 as 2+1). First only blocks of four
 * numbers or more go to two rows, since a pair split into two lines of one wastes the room beside it; then the panels of
 * a merged card wrap, and only then do the numbers go further.
 * `cols` keeps what was decided between calls so it only goes one way while the page width stays the same: numbers that
 * change do not make a card jump back and forth.
 * @param {ParentNode} root
 * @param {Map<string, number>} cols
 * @returns {Record<string, { cols: number, wrapped: boolean }>}
 */
export function fit (root, cols) {
  const blocks = [...root.querySelectorAll('.groups .v-stats')].flatMap(el => {
    const host = /** @type {HTMLElement | null} */ (el.closest('[data-cell], [data-tile]'))
    const card = /** @type {HTMLElement | null} */ (el.closest('.tile'))
    const id = host?.dataset.cell ?? host?.dataset.tile
    return id && card ? [{ el: /** @type {HTMLElement} */ (el), id, card, n: el.children.length }] : []
  })
  /** @typedef {typeof blocks[0]} Block */
  const get = (/** @type {string} */ id) => cols.get(id) ?? 1
  const set = (/** @type {Block} */ b, /** @type {number} */ k) => {
    cols.set(b.id, k)
    b.el.style.setProperty('--scols', String(k))
    b.el.classList.toggle('is-wrapped', k < b.n)
  }
  const overflows = (/** @type {HTMLElement} */ card) => card.scrollWidth > card.clientWidth + 1

  /** Takes a column from the widest block of every overflowing card, down to `floor`, until none overflows. @param {(b: Block) => number} floor */
  const shrink = floor => {
    for (let guard = 0; guard < 200; guard++) {
      let changed = false
      for (const card of new Set(blocks.filter(b => overflows(b.card)).map(b => b.card))) {
        const open = blocks.filter(b => b.card === card && get(b.id) > floor(b))
        if (!open.length) continue
        const b = open.reduce((a, c) => (get(c.id) > get(a.id) || (get(c.id) === get(a.id) && c.el.scrollWidth > a.el.scrollWidth) ? c : a))
        const k = get(b.id) - 1
        set(b, Math.max(floor(b), Math.min(k, Math.ceil(b.n / Math.ceil(b.n / k)))))
        changed = true
      }
      if (!changed) break
    }
  }

  for (const b of blocks) set(b, Math.max(1, Math.min(b.n, cols.get(b.id) ?? b.n)))
  const cards = new Set(blocks.map(b => b.card))
  for (const card of cards) card.classList.toggle('is-wrapping', cols.get(`wrap:${card.dataset.tile}`) === 1)
  shrink(b => b.n >= 4 ? Math.ceil(b.n / 2) : b.n)
  for (const card of cards) {
    if (!card.classList.contains('tile-merged') || !overflows(card)) continue
    card.classList.add('is-wrapping')
    cols.set(`wrap:${card.dataset.tile}`, 1)
    // the panels now have a line each to share: their numbers start over from one row
    for (const b of blocks) if (b.card === card) set(b, b.n)
  }
  shrink(() => 1)
  return Object.fromEntries(blocks.map(b => [b.id, { cols: get(b.id), wrapped: get(b.id) < b.n }]))
}
