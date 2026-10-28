<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { state, layout, tiles, defs, expanded, isHidden, start } from './store.js'
import { arrange, metrics } from './arrange.js'
import TopBar from './components/TopBar.vue'
import ConfigErrors from './components/ConfigErrors.vue'
import PageSection from './components/PageSection.vue'

const page = computed(() => state.dash?.pages.find((/** @type {any} */ p) => p.id === state.page) ?? state.dash?.pages[0])
const sections = computed(() => page.value?.sections ?? [])
const topSections = computed(() => sections.value.filter((/** @type {any} */ s) => s.placement === 'top'))
const pageSections = computed(() => sections.value.filter((/** @type {any} */ s) => s.placement !== 'top'))

/** @type {import('vue').Ref<HTMLElement | null>} */
const main = ref(null)
const width = ref(0)
/** Widest each tile has needed so far: widths only grow, so rows never jitter. */
const widths = new Map()
let queued = false

function relayout () {
  queued = false
  if (!width.value) return
  Object.assign(layout, arrange({
    sections: pageSections.value,
    width: width.value,
    metrics: metrics(),
    tile: id => tiles.get(id),
    def: id => defs.get(id),
    hidden: isHidden,
    widths,
    phone: state.phone
  }))
}

watch([() => state.version, () => state.page, () => state.phone, () => expanded.size, width], () => {
  if (queued) return
  queued = true
  requestAnimationFrame(relayout)
}, { flush: 'post' })

const observer = new ResizeObserver(() => { width.value = main.value?.clientWidth ?? 0 })
watch(main, (el, old) => {
  if (old) observer.unobserve(old)
  if (el) observer.observe(el)
})

onMounted(start)
onBeforeUnmount(() => observer.disconnect())
</script>

<template>
  <div
    v-if="!state.dash"
    class="boot"
  >
    Loading...
  </div>
  <template v-else>
    <TopBar
      :page="page"
      :top-sections="topSections"
    />
    <ConfigErrors
      v-if="state.errors.length"
      :errors="state.errors"
    />
    <main
      ref="main"
      class="page"
    >
      <template v-if="page">
        <PageSection
          v-for="s in pageSections"
          :key="s.id"
          :section="s"
        />
      </template>
      <p
        v-else
        class="muted"
      >
        No pages configured.
      </p>
    </main>
    <div
      v-if="state.toast"
      :class="['toast', `tone-${state.toast.tone}`]"
    >
      {{ state.toast.text }}
    </div>
  </template>
</template>
