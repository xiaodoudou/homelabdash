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

  it('wraps a tile\'s stats into balanced rows when one row does not fit', () => {
    expect(statColumns([100, 100, 100, 100], 1000, m)).toEqual({ cols: 4, wrapped: false })
    expect(statColumns([100, 100, 100, 100], 330, m)).toEqual({ cols: 2, wrapped: true })
  })
})
