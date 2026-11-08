<script setup>
import { computed } from 'vue'
import { isHidden, visibleTiles, layout } from '../store.js'
import AppIcon from './AppIcon.vue'
import TileCard from './TileCard.vue'
import MergedCard from './MergedCard.vue'

const props = defineProps({ group: { type: Object, required: true } })

const shown = computed(() => props.group.tiles.filter((/** @type {any} */ t) => !isHidden(t)))
/** The shown tiles in the rows fit.js planned for them (each row still wraps on its own); one row until then. */
const rows = computed(() => {
  const plan = layout.rows[`tiles:${props.group.id}`]
  if (!plan) return [shown.value]
  const out = plan.map(ids => shown.value.filter((/** @type {any} */ t) => ids.includes(t.id)))
  const rest = shown.value.filter((/** @type {any} */ t) => !plan.some(ids => ids.includes(t.id)))
  if (rest.length) out.push(rest)
  return out.filter(r => r.length)
})
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
    <div
      v-if="group.merge && shown.length"
      class="tiles"
    >
      <MergedCard
        :group="group"
        :tiles="shown"
      />
    </div>
    <div
      v-else
      class="tile-rows"
    >
      <div
        v-for="(row, i) in rows"
        :key="i"
        class="tiles"
      >
        <TileCard
          v-for="t in row"
          :key="t.id"
          :tile="t"
          :group-title="group.title"
        />
      </div>
    </div>
  </div>
</template>
