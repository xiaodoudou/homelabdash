<script setup>
import { computed } from 'vue'
import { tiles } from '../store.js'
import { useViewContext } from './context.js'
import AppIcon from './AppIcon.vue'
import TileError from './TileError.vue'
import ViewRenderer from './views/ViewRenderer.vue'

/** A cell of a merged card that keeps the tile's whole view (a list, several stats, graphs) under a small heading. */
const props = defineProps({
  tile: { type: Object, required: true },
  groupTitle: { type: String, default: undefined }
})

const st = computed(() => tiles.get(props.tile.id))
const ctx = useViewContext(() => props.tile, () => props.groupTitle)
</script>

<template>
  <div
    :class="['mpanel', { 'is-list': st?.view?.type === 'list' }]"
    :style="{ '--cells': st?.view?.type === 'stats' ? st.view.items.length : 2 }"
    :data-cell="tile.id"
  >
    <header class="tile-head">
      <AppIcon :icon="tile.icon" />
      <a
        v-if="tile.href"
        class="tile-title"
        :href="tile.href"
        :target="tile.target"
        rel="noopener"
      >{{ tile.title ?? '' }}</a>
      <span
        v-else
        class="tile-title"
      >{{ tile.title ?? '' }}</span>
    </header>
    <div :class="{ stale: st?.stale }">
      <div
        v-if="!st || st.loading"
        class="skeleton"
      />
      <TileError
        v-else-if="st.error && !st.view"
        :error="st.error"
      />
      <ViewRenderer
        v-else
        :view="st.view"
        :ctx="ctx"
      />
    </div>
  </div>
</template>
