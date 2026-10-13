<script setup>
import { computed } from 'vue'
import { tiles } from '../store.js'
import { fmt, threshold } from '../format.js'
import AppIcon from './AppIcon.vue'
import ValueText from './views/ValueText.js'

/** A compact cell of a merged card: large icon, the tile's one value and its title. */
const props = defineProps({
  tile: { type: Object, required: true },
  end: { type: Boolean, default: false }
})

const st = computed(() => tiles.get(props.tile.id))
const item = computed(() => st.value?.view?.type === 'stats' ? st.value.view.items[0] : null)
const tone = computed(() => item.value ? threshold(item.value) || (item.value.tone && item.value.tone !== 'neutral' ? item.value.tone : '') : '')
const zero = computed(() => !tone.value && item.value?.value === 0)
</script>

<template>
  <component
    :is="tile.href ? 'a' : 'div'"
    :class="['mcell', { 'mcell-end': end }]"
    :data-cell="tile.id"
    :href="tile.href || undefined"
    :target="tile.href ? tile.target : undefined"
    :rel="tile.href ? 'noopener' : undefined"
  >
    <AppIcon
      :icon="tile.icon"
      size="lg"
    />
    <span class="mcell-text">
      <span
        v-if="!st || st.loading"
        class="skeleton mcell-skeleton"
      />
      <span
        v-else-if="st.error && !st.view"
        class="badge tone-error"
        :title="st.error"
      >error</span>
      <span
        v-else-if="item"
        :class="['v-stat-value', tone && `tone-${tone}`, { 'is-zero': zero }]"
      >
        <ValueText
          :text="fmt(item.value, item.format, item.unit)"
          :format="item.format"
          :unit="item.unit"
        />
      </span>
      <span
        v-else
        class="v-stat-value is-zero"
      >-</span>
      <span class="mcell-title">
        {{ tile.title ?? '' }}
        <span
          v-if="tile.hasStatus && st?.status"
          :class="['dot', `dot-${st.status.state}`]"
          :title="st.status.label ?? st.status.state"
        />
      </span>
    </span>
  </component>
</template>
