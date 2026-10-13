<script setup>
import { computed } from 'vue'
import { errorParts } from '../views.js'

/** An error as a bold first clause and the advice after it: "qBittorrent answered 403. Add ..." */
const props = defineProps({ error: { type: String, required: true } })
const parts = computed(() => errorParts(props.error))
</script>

<template>
  <div
    class="tile-error"
    :title="error"
  >
    <b>{{ parts.head }}.</b> {{ parts.rest }}
  </div>
</template>
