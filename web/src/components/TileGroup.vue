<script setup>
import { computed } from 'vue'
import { isHidden, visibleTiles } from '../store.js'
import AppIcon from './AppIcon.vue'
import TileCard from './TileCard.vue'
import MergedCard from './MergedCard.vue'

const props = defineProps({ group: { type: Object, required: true } })

const shown = computed(() => props.group.tiles.filter((/** @type {any} */ t) => !isHidden(t)))
const stackShown = computed(() => props.group.stack && (visibleTiles(props.group).length || props.group.hideWhen !== 'empty'))
</script>

<template>
  <div
    v-if="stackShown"
    class="group stack"
    :data-section="group.id"
    :style="group.width ? { '--pct': group.width } : undefined"
  >
    <h3
      v-if="group.title"
      class="group-title"
    >
      <AppIcon
        :icon="group.icon"
        size="xs"
      />{{ group.title }}
    </h3>
    <div class="stack-groups">
      <TileGroup
        v-for="g in group.groups"
        :key="g.id"
        :group="g"
      />
    </div>
  </div>
  <div
    v-else-if="!group.stack && (shown.length || group.hideWhen !== 'empty')"
    class="group"
    :data-section="group.id"
    :style="group.width ? { '--pct': group.width } : undefined"
  >
    <h3
      v-if="group.title"
      class="group-title"
    >
      <AppIcon
        :icon="group.icon"
        size="xs"
      />{{ group.title }}
    </h3>
    <div class="tiles">
      <MergedCard
        v-if="group.merge && shown.length"
        :group="group"
        :tiles="shown"
      />
      <template v-else>
        <TileCard
          v-for="t in shown"
          :key="t.id"
          :tile="t"
          :group-title="group.title"
        />
      </template>
    </div>
  </div>
</template>
