<script setup>
/** An icon from /api/dashboard: a single-color glyph drawn through a mask, or a picture. */
defineProps({
  /** @type {import('vue').PropType<{ url: string, mono: boolean, color?: string } | null>} */
  icon: { type: Object, default: null },
  size: { type: String, default: '' }
})

/** @param {Event} e */
function hide (e) { /** @type {HTMLElement} */ (e.target).style.visibility = 'hidden' }
</script>

<template>
  <span
    v-if="icon && icon.mono"
    :class="['icon', size && `icon-${size}`, 'icon-mono']"
    :style="{ '--icon': `url('${icon.url}')`, color: icon.color }"
  />
  <img
    v-else-if="icon"
    :class="['icon', size && `icon-${size}`]"
    :src="icon.url"
    alt=""
    @error="hide"
  >
</template>
