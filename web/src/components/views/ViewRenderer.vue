<script setup>
import StatsView from './StatsView.vue'
import ListView from './ListView.vue'
import ProgressView from './ProgressView.vue'
import LogView from './LogView.vue'

/** Draws one view returned by a plugin's render(); the types are in src/views/schema.js. */
defineProps({
  view: { type: Object, default: null },
  /** @type {import('vue').PropType<import('../context.js').ViewCtx>} */
  ctx: { type: Object, required: true }
})
</script>

<template>
  <template v-if="view">
    <StatsView
      v-if="view.type === 'stats'"
      :view="view"
      :ctx="ctx"
    />
    <ListView
      v-else-if="view.type === 'list'"
      :view="view"
      :ctx="ctx"
    />
    <ProgressView
      v-else-if="view.type === 'progress'"
      :view="view"
    />
    <div
      v-else-if="view.type === 'text'"
      :class="['v-text', { mono: view.mono }, view.tone && `tone-${view.tone}`]"
      v-text="view.text"
    />
    <LogView
      v-else-if="view.type === 'log'"
      :lines="view.lines"
    />
    <div
      v-else
      class="v-text mono"
      v-text="JSON.stringify(view, null, 2)"
    />
  </template>
</template>
