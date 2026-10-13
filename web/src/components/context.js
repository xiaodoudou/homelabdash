import { computed } from 'vue'
import { state, history, pending, expanded, layout, runAction, toggleExpanded } from '../store.js'

/**
 * What a view needs from the tile around it: its id for actions, the graph history, whether its list is expanded,
 * the titles a single stat should not repeat, and the stat columns the layout chose.
 * @typedef {{ tileId: string, pending: Set<string>, expanded: boolean, graph: true | string[] | null | undefined,
 *   history: Record<string, { t: number[], v: number[] }> | undefined, window: number, titles: (string | undefined)[],
 *   stats: { cols: number, wrapped: boolean } | undefined, onToggle: () => void, onAction: (action: string, input: unknown) => void }} ViewCtx
 */

/**
 * @param {() => any} tile the tile definition
 * @param {() => string | undefined} [groupTitle]
 * @returns {import('vue').ComputedRef<ViewCtx>}
 */
export function useViewContext (tile, groupTitle = () => undefined) {
  return computed(() => {
    const t = tile()
    return {
      tileId: t.id,
      pending,
      expanded: expanded.has(t.id),
      graph: t.graph,
      history: history.get(t.id),
      window: state.dash?.history?.window ?? 3_600_000,
      titles: [t.title, groupTitle()],
      stats: layout.stats[t.id],
      onToggle: () => toggleExpanded(t.id),
      onAction: (action, input) => runAction(t.id, action, input)
    }
  })
}
