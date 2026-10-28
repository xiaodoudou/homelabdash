<script setup>
import { computed } from 'vue'
import { isHidden } from '../store.js'
import AppIcon from './AppIcon.vue'
import TileCard from './TileCard.vue'
import MergedCard from './MergedCard.vue'

const props = defineProps({ group: { type: Object, required: true } })

const shown = computed(() => props.group.tiles.filter((/** @type {any} */ t) => !isHidden(t)))
</script>

<template>
  <div
    v-if="shown.length || group.hideWhen !== 'empty'"
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
