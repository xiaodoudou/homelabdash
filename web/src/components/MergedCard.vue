<script setup>
import { computed } from 'vue'
import { tiles as states } from '../store.js'
import { compactCell } from '../views.js'
import MergedCell from './MergedCell.vue'
import MergedPanel from './MergedPanel.vue'

/**
 * One card for a merged group. A tile with a single value becomes a compact cell (icon, value, title; with two such
 * cells the icons sit on the outer edges); any other view keeps its full body under a small heading.
 */
const props = defineProps({
  group: { type: Object, required: true },
  tiles: { type: Array, required: true }
})

// Cells of one card share a style: compact only when every tile is a single ungraphed value.
const compact = computed(() => props.tiles.every((/** @type {any} */ t) => compactCell(states.get(t.id)?.view, t)))
const mirror = computed(() => compact.value && props.tiles.length === 2)
const key = computed(() => `${props.group.id}:merged`)
</script>

<template>
  <article
    class="tile tile-merged"
    :data-tile="key"
  >
    <template
      v-for="(t, i) in tiles"
      :key="t.id"
    >
      <i
        v-if="i"
        class="mcell-sep"
      />
      <MergedCell
        v-if="compact"
        :tile="t"
        :end="mirror && i === 1"
      />
      <MergedPanel
        v-else
        :tile="t"
        :group-title="group.title"
      />
    </template>
  </article>
</template>
