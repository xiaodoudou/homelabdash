<script setup>
import { computed } from 'vue'
import { state, tiles } from '../store.js'
import ViewRenderer from './views/ViewRenderer.vue'
import { useViewContext } from './context.js'

/** A header section's tile: its list items as chips, and the full list with its actions in a panel over the page. */
const props = defineProps({ tile: { type: Object, required: true } })

const TOP_CHIPS = 3
const view = computed(() => tiles.get(props.tile.id)?.view)
const open = computed(() => state.openTop === props.tile.id)
const shown = computed(() => state.phone ? 1 : TOP_CHIPS)
const ctx = useViewContext(() => props.tile)

function toggle () {
  state.openTop = open.value ? null : props.tile.id
}
</script>

<template>
  <div
    v-if="view?.type === 'list' && view.items.length"
    class="top-chips"
    :data-top="tile.id"
  >
    <button
      v-for="(it, i) in view.items.slice(0, shown)"
      :key="it.key ?? i"
      class="chip"
      :data-tone="it.tone ?? undefined"
      :aria-expanded="open"
      :title="[it.title, it.subtitle].filter(Boolean).join(' - ')"
      @click="toggle"
    >
      <span>{{ it.title }}</span>
    </button>
    <button
      v-if="view.items.length > shown"
      class="chip chip-more"
      :aria-expanded="open"
      @click="toggle"
    >
      +{{ view.items.length - shown }}
    </button>
    <div
      v-if="open"
      class="top-panel"
    >
      <ViewRenderer
        :view="{ ...view, limit: undefined }"
        :ctx="ctx"
      />
    </div>
  </div>
</template>
