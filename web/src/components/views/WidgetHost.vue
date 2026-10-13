<script setup>
import { onMounted, ref, watch } from 'vue'

/**
 * Hosts a plugin's own custom element: plugins/<id>/widget.js defines <hd-w-<id>>, which receives the view as a property.
 * Created by hand once the element is defined, so the property lands on the upgraded element and not on a placeholder.
 */
const props = defineProps({
  view: { type: Object, required: true },
  plugin: { type: String, required: true }
})

/** @type {import('vue').Ref<HTMLElement | null>} */
const box = ref(null)

async function draw () {
  const tag = `hd-w-${props.plugin}`
  await customElements.whenDefined(tag)
  if (!box.value) return
  let el = /** @type {any} */ (box.value.firstElementChild)
  if (!el || el.localName !== tag) {
    el = document.createElement(tag)
    box.value.replaceChildren(el)
  }
  el.view = props.view
}

onMounted(draw)
watch(() => [props.view, props.plugin], draw)
</script>

<template>
  <div ref="box" />
</template>
