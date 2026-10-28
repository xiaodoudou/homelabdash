<script setup>
import { ref, onBeforeUnmount } from 'vue'

const props = defineProps({
  action: { type: Object, required: true },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['run'])

// An action with `confirm` asks first: the button shows the question, and a second click runs it.
const asking = ref(false)
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer

function click () {
  clearTimeout(timer)
  if (props.action.confirm && !asking.value) {
    asking.value = true
    timer = setTimeout(() => { asking.value = false }, 4000)
    return
  }
  asking.value = false
  emit('run')
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <button
    :class="['btn-mini', { 'is-confirm': asking }]"
    :disabled="disabled"
    @click.prevent="click"
  >
    {{ asking ? action.confirm : action.title }}
  </button>
</template>
