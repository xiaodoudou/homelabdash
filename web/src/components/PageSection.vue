<script setup>
import { computed } from 'vue'
import { layout, isHidden, visibleTiles } from '../store.js'
import { sectionGroups, isGrid } from '../views.js'
import AppIcon from './AppIcon.vue'
import TileGroup from './TileGroup.vue'
import TileCard from './TileCard.vue'

const props = defineProps({ section: { type: Object, required: true } })

const hidden = computed(() => props.section.hideWhen === 'empty' && !visibleTiles(props.section).length)
const grid = computed(() => isGrid(props.section))
const gridTiles = computed(() => props.section.tiles.filter((/** @type {any} */ t) => !isHidden(t)))
const gridStyle = computed(() => {
  const l = props.section.layout ?? {}
  return {
    '--min': l.minTileWidth ? `${l.minTileWidth}px` : undefined,
    '--cols': l.columns,
    '--gap': l.gap !== undefined ? `${l.gap}px` : undefined
  }
})
</script>

<template>
  <section
    v-if="!hidden"
    class="band"
    :data-section="section.id"
  >
    <h2
      v-if="section.title"
      class="band-title"
    >
      <AppIcon
        :icon="section.icon"
        size="sm"
      />{{ section.title }}
    </h2>
    <div
      v-if="grid"
      :class="['grid', { fixed: section.layout.columns }]"
      :style="gridStyle"
    >
      <TileCard
        v-for="t in gridTiles"
        :key="t.id"
        :tile="t"
      />
    </div>
    <div
      v-else
      class="groups"
      :style="{ '--page-cols': layout.C }"
    >
      <TileGroup
        v-for="g in sectionGroups(section)"
        :key="g.id"
        :group="g"
      />
    </div>
  </section>
</template>
