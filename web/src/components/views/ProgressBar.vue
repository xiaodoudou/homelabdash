<script setup>
import { computed } from 'vue'

const props = defineProps({
  value: { type: Number, required: true },
  max: { type: Number, default: 100 },
  tone: { type: String, default: '' }
})
const width = computed(() => `${Math.max(0, Math.min(100, props.max ? (props.value / props.max) * 100 : 0))}%`)
</script>

<template>
  <div class="bar">
    <div
      :class="['bar-fill', tone && `tone-${tone}`]"
      :style="{ width }"
    />
  </div>
</template>
