<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { state, layout, expanded, start } from './store.js'
import { fit, planRows, pageGap } from './fit.js'
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
/** Stat columns of each tile; reset when the page width changes, otherwise they only go down. */
const cols = new Map()
let queued = false
let measured = 0

/** Widest each group has been at its content size: rows only change when a group grows. */
const seen = new Map()

async function relayout () {
  queued = false
  if (!width.value || !main.value) return
  if (width.value !== measured) cols.clear()
  measured = width.value
  const rows = planRows(main.value, width.value, pageGap(), seen)
  if (JSON.stringify(rows) !== JSON.stringify(layout.rows)) {
    layout.rows = rows
    await nextTick()
  }
  layout.stats = fit(main.value, cols)
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
