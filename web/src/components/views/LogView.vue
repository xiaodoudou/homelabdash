<script setup>
import { nextTick, ref, watch } from 'vue'
import { clock } from '../../format.js'

/** Log lines that stick to the bottom while the reader has not scrolled up. */
const props = defineProps({ lines: { type: Array, required: true } })

/** @type {import('vue').Ref<HTMLElement | null>} */
const box = ref(null)
let stick = true

function scrolled () {
  const b = box.value
  if (b) stick = b.scrollTop + b.clientHeight >= b.scrollHeight - 8
}

watch(() => props.lines, async () => {
  await nextTick()
  if (stick && box.value) box.value.scrollTop = box.value.scrollHeight
}, { immediate: true, flush: 'post' })

/** @param {any} l */
const line = l => typeof l === 'string' ? { text: l } : l
</script>

<template>
  <div
    ref="box"
    class="v-log mono"
    @scroll="scrolled"
  >
    <div
      v-for="(l, i) in lines.map(line)"
      :key="i"
      :class="['v-log-line', l.tone && `tone-${l.tone}`]"
    >
      <span
        v-if="l.time"
        class="v-log-time"
        v-text="clock(l.time)"
      /><span v-text="l.text" />
    </div>
  </div>
</template>
