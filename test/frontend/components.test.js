import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ListView from '../../web/src/components/views/ListView.vue'
import StatsView from '../../web/src/components/views/StatsView.vue'
import MergedCard from '../../web/src/components/MergedCard.vue'
import TopChips from '../../web/src/components/TopChips.vue'
import { tiles, state } from '../../web/src/store.js'

/** @param {Partial<import('../../web/src/components/context.js').ViewCtx>} [o] */
const ctx = (o = {}) => ({ tileId: 't', pending: new Set(), expanded: false, graph: undefined, history: undefined, window: 3_600_000, titles: [], stats: undefined, onToggle () {}, onAction () {}, ...o })

afterEach(() => {
  vi.useRealTimers()
  tiles.clear()
  state.phone = false
  state.openTop = null
})

describe('ListView', () => {
  it('a playing stream counts down every second and its bar fills by time; a paused one stays put', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const end = 1_800_000_000_000 + 90_000
    const view = {
      type: 'list',
      dense: true,
      items: [
        { title: 'Show', icon: 'mdi:play', value: end, format: 'until', progress: { value: 50, start: end - 180_000, end } },
        { title: 'Movie', icon: 'mdi:pause', value: 600, format: 'clock', progress: { value: 20, max: 100 } }
      ]
    }
    const w = mount(ListView, { props: { view, ctx: ctx() } })
    const values = () => w.findAll('.v-row-value').map(v => v.text())
    expect(values()).toEqual(['00:01:30', '00:10:00'])
    expect(w.find('.v-list').classes()).toContain('dense')
    expect(w.find('.v-row-icon').attributes('style')).toContain('/icons/mdi/play.svg')

    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(values()).toEqual(['00:01:27', '00:10:00'])
    expect(w.findAll('.bar-fill')[0].attributes('style')).toContain('width: 51.6')
    w.unmount()
  })

  it('shows the empty text, and a limit with a button for the rest', async () => {
    expect(mount(ListView, { props: { view: { type: 'list', items: [], empty: 'Nothing playing' }, ctx: ctx() } }).text()).toContain('Nothing playing')
    const items = Array.from({ length: 5 }, (_, i) => ({ title: `Row ${i}` }))
    const onToggle = vi.fn()
    const w = mount(ListView, { props: { view: { type: 'list', items, limit: 2 }, ctx: ctx({ onToggle }) } })
    expect(w.findAll('.v-row')).toHaveLength(2)
    await w.find('.v-more').trigger('click')
    expect(onToggle).toHaveBeenCalled()
  })
})

describe('StatsView', () => {
  it('draws units small, dims zeros, colors thresholds and drops a label that repeats the title', () => {
    const view = { type: 'stats', items: [{ label: 'CPU', value: 97, format: 'percent', warn: 80, crit: 95 }] }
    const w = mount(StatsView, { props: { view, ctx: ctx({ titles: ['CPU'] }) } })
    expect(w.find('.v-stat-value').classes()).toContain('tone-error')
    expect(w.find('.u').text()).toBe('%')
    expect(w.find('.v-stat-label').exists()).toBe(false)

    const z = mount(StatsView, { props: { view: { type: 'stats', items: [{ label: 'Queue', value: 0 }] }, ctx: ctx() } })
    expect(z.find('.v-stat-value').classes()).toContain('is-zero')
  })

  it('takes its column count from the layout', () => {
    const view = { type: 'stats', items: [1, 2, 3, 4].map(i => ({ label: `L${i}`, value: i })) }
    const w = mount(StatsView, { props: { view, ctx: ctx({ stats: { cols: 2, wrapped: true } }) } })
    expect(w.find('.v-stats').classes()).toContain('is-wrapped')
    expect(w.find('.v-stats').attributes('style')).toContain('--scols: 2')
  })
})

describe('MergedCard', () => {
  const group = { id: 'media.backlog', title: 'Backlog' }
  const one = (/** @type {number} */ value) => ({ view: { type: 'stats', items: [{ label: 'Missing', value }] } })

  it('single numbers become compact cells, two of them mirrored', () => {
    tiles.set('a', { id: 'a', ...one(3) })
    tiles.set('b', { id: 'b', ...one(0) })
    const w = mount(MergedCard, { props: { group, tiles: [{ id: 'a', title: 'Movies' }, { id: 'b', title: 'Episodes' }] } })
    expect(w.findAll('.mcell')).toHaveLength(2)
    expect(w.findAll('.mcell')[1].classes()).toContain('mcell-end')
    expect(w.findAll('.mcell-sep')).toHaveLength(1)
    expect(w.text()).toContain('Movies')
  })

  it('any other view keeps its whole body, and then every cell does', () => {
    tiles.set('a', { id: 'a', ...one(3) })
    tiles.set('l', { id: 'l', view: { type: 'list', items: [{ title: 'Show' }] } })
    const w = mount(MergedCard, { props: { group, tiles: [{ id: 'a', title: 'Count' }, { id: 'l', title: 'Plex' }] } })
    expect(w.findAll('.mcell')).toHaveLength(0)
    expect(w.findAll('.mpanel')).toHaveLength(2)
    expect(w.find('.mpanel.is-list').exists()).toBe(true)
  })
})

describe('TopChips', () => {
  const alerts = { view: { type: 'list', items: [1, 2, 3, 4, 5].map(i => ({ title: `Alert ${i}`, tone: 'warning' })) } }

  it('three chips and a count, one chip on a phone, and the full list on click', async () => {
    tiles.set('al', { id: 'al', ...alerts })
    const w = mount(TopChips, { props: { tile: { id: 'al' } } })
    expect(w.findAll('.chip:not(.chip-more)')).toHaveLength(3)
    expect(w.find('.chip-more').text()).toBe('+2')

    state.phone = true
    await nextTick()
    expect(w.findAll('.chip:not(.chip-more)')).toHaveLength(1)
    expect(w.find('.chip-more').text()).toBe('+4')

    await w.find('.chip').trigger('click')
    expect(w.findAll('.top-panel .v-row')).toHaveLength(5)
  })
})

describe('action buttons', () => {
  const view = { type: 'list', items: [{ title: 'Movie', actions: [{ action: 'stop', title: 'Stop', confirm: 'Stop this stream?', input: { id: 'a' } }, { action: 'pause', title: 'Pause', input: { id: 'a' } }] }] }

  it('a plain action runs on the first click', async () => {
    const onAction = vi.fn()
    const w = mount(ListView, { props: { view, ctx: ctx({ onAction }) } })
    await w.findAll('.btn-mini')[1].trigger('click')
    expect(onAction).toHaveBeenCalledWith('pause', { id: 'a' })
  })

  it('an action with confirm asks on the button first, and runs on the second click', async () => {
    const onAction = vi.fn()
    const w = mount(ListView, { props: { view, ctx: ctx({ onAction }) } })
    const stop = () => w.findAll('.btn-mini')[0]
    await stop().trigger('click')
    expect(onAction).not.toHaveBeenCalled()
    expect(stop().text()).toBe('Stop this stream?')
    expect(stop().classes()).toContain('is-confirm')
    await stop().trigger('click')
    expect(onAction).toHaveBeenCalledWith('stop', { id: 'a' })
    expect(stop().text()).toBe('Stop')
  })

  it('the question goes away by itself after four seconds', async () => {
    vi.useFakeTimers()
    const onAction = vi.fn()
    const w = mount(ListView, { props: { view, ctx: ctx({ onAction }) } })
    await w.findAll('.btn-mini')[0].trigger('click')
    vi.advanceTimersByTime(4000)
    await nextTick()
    expect(w.findAll('.btn-mini')[0].text()).toBe('Stop')
    await w.findAll('.btn-mini')[0].trigger('click')
    expect(onAction).not.toHaveBeenCalled()
  })
})
