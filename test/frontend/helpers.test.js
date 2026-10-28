import { describe, it, expect } from 'vitest'
import { fmt, clockTime, duration, threshold } from '../../web/src/format.js'
import { isEmpty, valueParts, hidesLabel, compactCell, sectionGroups, errorParts } from '../../web/src/views.js'
import { plan, fill } from '../../web/src/layout.js'

describe('formats', () => {
  it('prints numbers, sizes and rates the way the tiles show them', () => {
    expect(fmt(1234)).toBe('1,234')
    expect(fmt(7.5, 'percent')).toBe('7.5%')
    expect(fmt(42, 'percent')).toBe('42%')
    expect(fmt(250 * 1024 ** 3, 'bytes')).toBe('250 GB')
    expect(fmt(1_800_000, 'byterate')).toBe('1.72 MB/s')
    expect(fmt(null)).toBe('-')
    expect(fmt(null, 'number', 'tok/s')).toBe('-- tok/s')
    expect(valueParts('-- tok/s', 'number', 'tok/s')).toEqual([{ text: '--', unit: false }, { text: 'tok/s', unit: true }])
  })

  it('durations drop seconds past ten minutes, clocks always show hours', () => {
    expect(duration(150)).toBe('2m 30s')
    expect(duration(14 * 60 + 5)).toBe('14m')
    expect(duration(3 * 86400 + 5 * 3600)).toBe('3d 5h')
    expect(clockTime(365)).toBe('00:06:05')
    expect(clockTime(3765)).toBe('01:02:45')
    expect(clockTime(-5)).toBe('00:00:00')
  })

  it('thresholds turn a value amber then red, or the other way with invert', () => {
    expect(threshold({ value: 85, warn: 80, crit: 95 })).toBe('warning')
    expect(threshold({ value: 97, warn: 80, crit: 95 })).toBe('error')
    expect(threshold({ value: 10, warn: 20, invert: true })).toBe('warning')
    expect(threshold({ value: null, warn: 1 })).toBe('')
  })
})

describe('view helpers', () => {
  it('an all-zero stats view counts as empty, so an idle player hides', () => {
    expect(isEmpty({ type: 'stats', items: [{ value: 0 }, { value: null }] })).toBe(true)
    expect(isEmpty({ type: 'stats', items: [{ value: 0 }, { value: 2 }] })).toBe(false)
    expect(isEmpty({ type: 'list', items: [] })).toBe(true)
    expect(isEmpty(null)).toBe(true)
  })

  it('splits units off numbers, and leaves text alone', () => {
    expect(valueParts('30.7 KB/s', 'byterate')).toEqual([{ text: '30.7', unit: false }, { text: 'KB/s', unit: true }])
    expect(valueParts('21d 15h', 'duration')).toEqual([{ text: '21', unit: false }, { text: 'd', unit: true }, { text: ' 15', unit: false }, { text: 'h', unit: true }])
    expect(valueParts('online', 'text')).toEqual([{ text: 'online', unit: false }])
  })

  it('a single stat does not repeat the title above it', () => {
    const view = { items: [{ label: 'CPU' }] }
    expect(hidesLabel(view, ['CPU', undefined])).toBe(true)
    expect(hidesLabel(view, ['Server', 'Host'])).toBe(false)
    expect(hidesLabel({ items: [{ label: 'CPU' }, { label: 'Load' }] }, ['CPU'])).toBe(false)
  })

  it('merged cells are compact for one ungraphed number', () => {
    const one = { type: 'stats', items: [{ label: 'Missing', value: 3 }] }
    expect(compactCell(one, {})).toBe(true)
    expect(compactCell(one, { graph: true })).toBe(false)
    expect(compactCell({ type: 'list', items: [] }, {})).toBe(false)
    expect(compactCell(undefined, {})).toBe(true)
  })

  it('a section without groups is laid out as one group of its tiles', () => {
    const s = { id: 'home.server', tiles: [{ id: 'a' }], merge: true }
    expect(sectionGroups(s)).toEqual([{ id: 'home.server.tiles', tiles: s.tiles, hideWhen: 'never', merge: true }])
    expect(sectionGroups({ id: 'x', tiles: [], groups: [{ id: 'g' }] })).toEqual([{ id: 'g' }])
  })

  it('an error reads as a short clause and the advice after it', () => {
    expect(errorParts('qBittorrent answered 403: add the address')).toEqual({ head: 'qBittorrent answered 403', rest: 'Add the address' })
    expect(errorParts('timeout')).toEqual({ head: 'timeout', rest: '' })
  })
})

describe('row packing', () => {
  it('uses the fewest rows, then the most even fill', () => {
    expect(plan([10, 10, 4], 24)).toEqual([[0, 3]])
    expect(plan([16, 10, 10], 24)).toEqual([[0, 1], [1, 3]])
  })

  it('keeps neighbours with a set width on one row when they fit, and fills earlier rows first on a tie', () => {
    expect(plan([11, 7, 6, 16, 24], 24)).toEqual([[0, 2], [2, 4], [4, 5]])
    expect(plan([11, 7, 6, 16, 24], 24, [true, true, true, false, false])).toEqual([[0, 3], [3, 4], [4, 5]])
    expect(plan([12, 12], 24, [true, false])).toEqual([[0, 2]])
  })

  it('leaves a tile with a set width as it is', () => {
    const tiles = [{ need: 600, flex: 1, span: 6, fixed: 6 }, { need: 200, flex: 1, span: 4 }]
    fill(tiles, 12, span => span * 100)
    expect(tiles.map(t => t.span)).toEqual([6, 6])
  })

  it('gives spare columns to the most cramped tile', () => {
    const tiles = [{ need: 600, flex: 1, span: 6 }, { need: 200, flex: 1, span: 4 }]
    fill(tiles, 12, span => span * 100)
    expect(tiles.map(t => t.span)).toEqual([8, 4])
  })
})
