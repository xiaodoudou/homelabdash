<script setup>
import { computed } from 'vue'
import { fmt, threshold } from '../../format.js'
import ProgressBar from './ProgressBar.vue'

const props = defineProps({ view: { type: Object, required: true } })

const bars = computed(() => props.view.items.map((/** @type {any} */ it) => {
  // No value: a note instead of an empty bar that would read as 0%.
  if (it.value === null || it.value === undefined) return { it, note: it.detail ?? 'No data' }
  const max = it.max ?? 100
  const pct = max ? (it.value / max) * 100 : 0
  const right = it.detail ?? (it.max !== null && it.max !== undefined && it.format !== 'percent'
    ? `${fmt(it.value, it.format)} / ${fmt(it.max, it.format)}`
    : fmt(it.format === 'percent' || it.max === undefined ? it.value : pct, 'percent'))
  return { it, max, right, tone: threshold({ value: pct, warn: it.warn, crit: it.crit }) }
}))
</script>

<template>
  <div class="v-progress">
    <div
      v-for="(b, i) in bars"
      :key="i"
      class="v-prog"
    >
      <div class="v-prog-head">
        <span>{{ b.it.label }}</span>
        <span
          v-if="!b.note"
          class="muted"
        >{{ b.right }}</span>
      </div>
      <div
        v-if="b.note"
        class="v-prog-note"
      >
        <i class="dot dot-warn" /><span>{{ b.note }}</span>
      </div>
      <ProgressBar
        v-else
        :value="b.it.value"
        :max="b.max"
        :tone="b.tone"
      />
    </div>
  </div>
</template>
