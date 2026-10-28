import { describe, it, expect } from 'vitest'
import { arrange, statColumns } from '../../web/src/arrange.js'

// jsdom has no canvas, so text measures 12 px a character: predictable widths for the tests.
const m = { value: 22, gap: 16, padX: 20, cellPad: 12, family: 'sans-serif' }
const stats = (/** @type {number} */ n, format = 'number') => ({ view: { type: 'stats', items: Array.from({ length: n }, (_, i) => ({ label: `L${i}`, value: i, format })) } })

/** @param {any[]} sections @param {Record<string, any>} states @param {number} width @param {Map<string, number>} [widths] */
const run = (sections, states, width, widths = new Map()) => arrange({
  sections,
  width,
  metrics: m,
  tile: id => states[id],
  def: () => undefined,
  hidden: t => !!states[t.id]?.hidden,
  widths
})

describe('arrange', () => {
  it('picks the column count from the page width', () => {
    const s = [{ id: 's', tiles: [{ id: 'a' }] }]
    expect(run(s, {}, 1600).C).toBe(24)
    expect(run(s, {}, 1000).C).toBe(12)
    expect(run(s, {}, 700).C).toBe(6)
    expect(run(s, {}, 390).C).toBe(2)
  })

  it('places groups side by side and gives each tile a span', () => {
    const sections = [{ id: 'sys', tiles: [], groups: [{ id: 'host', tiles: [{ id: 'cpu' }] }, { id: 'net', tiles: [{ id: 'wan' }] }] }]
    const out = run(sections, { cpu: stats(1), wan: stats(4) }, 1600)
    expect(out.groups.host).toMatch(/^1 \/ span \d+$/)
    expect(out.groups.net).toMatch(/^span \d+$/)
    expect(Object.keys(out.tiles).sort()).toEqual(['cpu', 'wan'])
  })

  it('never makes a tile narrower than it was, so rows do not jitter as values change', () => {
    const sections = [{ id: 's', tiles: [{ id: 'a' }, { id: 'b' }] }]
    const widths = new Map()
    run(sections, { a: stats(5), b: stats(1) }, 1600, widths)
    const wide = widths.get('a')
    run(sections, { a: stats(1), b: stats(1) }, 1600, widths)
    expect(widths.get('a')).toBe(wide)
  })

  it('a merged group is one box, and hidden tiles take no room', () => {
    const sections = [{ id: 'm', tiles: [], groups: [{ id: 'backlog', merge: true, tiles: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] }] }]
    const out = run(sections, { x: stats(1), y: stats(1), z: { ...stats(1), hidden: true } }, 1600)
    expect(Object.keys(out.tiles)).toEqual(['backlog:merged'])
  })

  it('a panel of a merged card is at least as wide as its title, so one number does not cut it short', () => {
    const card = (/** @type {string} */ title) => {
      const widths = new Map()
      const tiles = [{ id: 'x', title, graph: true }, { id: 'y', graph: true }]
      run([{ id: 'm', tiles: [], groups: [{ id: 'host', merge: true, tiles }] }], { x: stats(1), y: stats(3) }, 1600, widths)
      return /** @type {number} */ (widths.get('host:merged'))
    }
    expect(card('A long panel title')).toBeGreaterThan(card('A'))
  })

  it('a width in percent becomes columns, used as given, and the tiles of the group share them', () => {
    const sections = [{ id: 's', tiles: [], groups: [
      { id: 'a', width: 45, merge: true, tiles: [{ id: 'x', graph: true }, { id: 'y', graph: true }] },
      { id: 'b', width: 30, tiles: [{ id: 'p' }, { id: 'q' }] },
      { id: 'c', width: 25, tiles: [{ id: 'r' }] }
    ] }]
    const states = { x: stats(1), y: stats(4), p: stats(2), q: stats(1), r: stats(4) }
    const out = run(sections, states, 1600)
    expect(out.groups).toEqual({ a: '1 / span 11', b: 'span 7', c: 'span 6' })
    expect(out.tiles['a:merged']).toBe('1 / span 11')
    expect(Object.values(run(sections, states, 390).groups).every(g => g.endsWith('span 2'))).toBe(true)
  })

  it('a merged card too narrow for its panels wraps the widest one first, and on a phone each panel on its own', () => {
    const sections = [{ id: 's', tiles: [], groups: [{ id: 'a', width: 25, merge: true, tiles: [{ id: 'x', graph: true }, { id: 'y', graph: true }] }] }]
    const states = { x: stats(1), y: stats(4) }
    const narrow = run(sections, states, 1600)
    expect(narrow.stats.y).toEqual({ cols: 2, wrapped: true })
    expect(narrow.stats.x).toEqual({ cols: 1, wrapped: false })
    const wide = arrange({ sections, width: 1600, metrics: m, tile: id => states[id], def: () => undefined, hidden: () => false, widths: new Map(), phone: true })
    expect(wide.stats.y.wrapped).toBe(false)
  })

  it('wraps a tile\'s stats into balanced rows when one row does not fit', () => {
    expect(statColumns([100, 100, 100, 100], 1000, m)).toEqual({ cols: 4, wrapped: false })
    expect(statColumns([100, 100, 100, 100], 330, m)).toEqual({ cols: 2, wrapped: true })
  })
})
