import { describe, it, expect } from 'vitest'
import { fit, planRows } from '../../web/src/fit.js'

// jsdom draws nothing, so each element reports the widths a browser would: 100 px a stat column.
const cols = (/** @type {Element} */ el) => Number(/** @type {HTMLElement} */ (el).style.getPropertyValue('--scols') || el.children.length)

/** @param {HTMLElement} el @param {() => number} scroll @param {number} client */
function widths (el, scroll, client) {
  Object.defineProperty(el, 'scrollWidth', { get: scroll })
  Object.defineProperty(el, 'clientWidth', { get: () => client })
}

/** A stats block of n numbers inside `parent`, reporting 100 px a column. */
function stats (/** @type {HTMLElement} */ parent, /** @type {number} */ n) {
  const el = document.createElement('div')
  el.className = 'v-stats'
  for (let i = 0; i < n; i++) el.append(document.createElement('div'))
  Object.defineProperty(el, 'scrollWidth', { get: () => cols(el) * 100 })
  parent.append(el)
  return el
}

function page () {
  const root = document.createElement('div')
  const groups = document.createElement('div')
  groups.className = 'groups'
  root.append(groups)
  return { root, groups }
}

describe('fit', () => {
  it('wraps the numbers of a card that overflows into balanced rows, and keeps them there while the width stays', () => {
    const { root, groups } = page()
    const card = document.createElement('article')
    card.className = 'tile'
    card.dataset.tile = 'ups'
    groups.append(card)
    const block = stats(card, 4)
    let room = 250
    Object.defineProperty(card, 'scrollWidth', { get: () => cols(block) * 100 })
    Object.defineProperty(card, 'clientWidth', { get: () => room })
    const memory = new Map()
    expect(fit(root, memory).ups).toEqual({ cols: 2, wrapped: true })
    room = 1000
    expect(fit(root, memory).ups).toEqual({ cols: 2, wrapped: true })
    expect(fit(root, new Map()).ups).toEqual({ cols: 4, wrapped: false })
  })

  it('a merged card still too narrow at two rows a panel wraps its panels, then their numbers start over', () => {
    const { root, groups } = page()
    const card = document.createElement('article')
    card.className = 'tile tile-merged'
    card.dataset.tile = 'host:merged'
    groups.append(card)
    const blocks = ['ram', 'gpu'].map(id => {
      const panel = document.createElement('div')
      panel.dataset.cell = id
      card.append(panel)
      return stats(panel, 4)
    })
    widths(card, () => {
      const each = blocks.map(b => cols(b) * 100)
      return card.classList.contains('is-wrapping') ? Math.max(...each) : each.reduce((a, b) => a + b, 0)
    }, 350)
    const out = fit(root, new Map())
    expect(card.classList.contains('is-wrapping')).toBe(true)
    expect(out.ram).toEqual({ cols: 2, wrapped: true })
    expect(out.gpu).toEqual({ cols: 2, wrapped: true })
  })
})

describe('planRows', () => {
  /** @param {[string, number, number?][]} spec id, content width, percent */
  function section (spec) {
    const { root, groups } = page()
    groups.dataset.groups = 'system'
    const row = document.createElement('div')
    row.className = 'group-row'
    groups.append(row)
    for (const [id, w, pct] of spec) {
      const g = document.createElement('div')
      g.className = 'group'
      g.dataset.section = id
      if (pct) g.style.setProperty('--pct', String(pct))
      g.getBoundingClientRect = () => /** @type {DOMRect} */ ({ width: w })
      row.append(g)
    }
    return root
  }

  it('cuts groups into rows by the width the browser drew them at, as evenly as it can', () => {
    expect(planRows(section([['a', 1100], ['b', 500], ['c', 800]]), 2000, 16, new Map()).system).toEqual([['a'], ['b', 'c']])
    expect(planRows(section([['a', 600], ['b', 500], ['c', 500]]), 2000, 16, new Map()).system).toEqual([['a', 'b', 'c']])
  })

  it('groups with a width that add up to the row stay on it even when wider content, and a group never gets narrower', () => {
    const fixed = section([['host', 1300, 45], ['ai', 400, 30], ['ups', 300, 25], ['gpus', 1500]])
    expect(planRows(fixed, 2000, 16, new Map()).system).toEqual([['host', 'ai', 'ups'], ['gpus']])
    const seen = new Map([['a', 1500]])
    expect(planRows(section([['a', 600], ['b', 500], ['c', 500]]), 2000, 16, seen).system).toEqual([['a'], ['b', 'c']])
  })
})
