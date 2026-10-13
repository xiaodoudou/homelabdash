<script setup>
import { computed } from 'vue'
import { clockTime, toMs } from '../../format.js'
import { useSecond } from './second.js'

/** Time left to `end` (epoch ms or ISO), as HH:MM:SS counting down every second. */
const props = defineProps({ end: { type: [Number, String], required: true } })
const now = useSecond()
const left = computed(() => clockTime((toMs(props.end) - now.value) / 1000))
</script>

<template>
  <span class="v-row-value">{{ left }}</span>
</template>
