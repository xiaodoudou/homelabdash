<script setup>
import { computed } from 'vue'
import { state, defs, minute, visibleTiles } from '../store.js'
import AppIcon from './AppIcon.vue'
import TopChips from './TopChips.vue'

const props = defineProps({
  page: { type: Object, default: null },
  topSections: { type: Array, required: true }
})

const clockFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const clock = computed(() => { void minute.value; return clockFmt.format(new Date()) })

const graphs = computed(() => { void state.dash; return [...defs.values()].some(t => t.graph) })
const step = computed(() => Math.round((state.dash?.history?.step ?? 10_000) / 1000))
const windowMin = computed(() => Math.round((state.dash?.history?.window ?? 3_600_000) / 60_000))
const topTiles = computed(() => props.topSections.flatMap((/** @type {any} */ s) => visibleTiles(s)))
</script>

<template>
  <header class="top">
    <h1 class="brand">
      {{ state.dash.title }}
    </h1>
    <nav
      v-if="state.dash.pages.length > 1"
      class="tabs"
    >
      <a
        v-for="p in state.dash.pages"
        :key="p.id"
        :href="`#/${p.id}`"
        :class="{ active: p === page }"
      >
        <AppIcon
          :icon="p.icon"
          size="sm"
        />{{ p.title }}
      </a>
    </nav>
    <div
      v-if="topSections.length"
      class="top-strip"
    >
      <TopChips
        v-for="t in topTiles"
        :key="t.id"
        :tile="t"
      />
    </div>
    <div class="top-right">
      <span
        v-if="graphs"
        class="top-note"
        :title="`One point every ${step} s`"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        ><path
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M3 17l5-6 4 3 4-7 5 5"
        /></svg>
        Graphs: last {{ windowMin >= 60 ? 'hour' : `${windowMin} min` }}
      </span>
      <span class="clock">{{ clock }}</span>
      <span
        :class="['conn', `conn-${state.conn}`]"
        :title="state.conn === 'live' ? 'Live' : 'Reconnecting'"
      />
    </div>
  </header>
</template>
