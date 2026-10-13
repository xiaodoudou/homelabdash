<script setup>
import { computed } from 'vue'
import { useSecond } from './second.js'

/** A progress bar filled by time between `start` and `end` (epoch ms), moving every second. */
const props = defineProps({
  start: { type: Number, required: true },
  end: { type: Number, required: true }
})
const now = useSecond()
const width = computed(() => `${Math.max(0, Math.min(1, (now.value - props.start) / (props.end - props.start))) * 100}%`)
</script>

<template>
  <div class="bar">
    <div
      class="bar-fill"
      :style="{ width }"
    />
  </div>
</template>
