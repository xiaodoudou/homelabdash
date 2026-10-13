<script setup>
import { computed } from 'vue'
import { minute, actionKey } from '../../store.js'
import { fmt, relative } from '../../format.js'
import CountDown from './CountDown.vue'
import TimeBar from './TimeBar.vue'
import ProgressBar from './ProgressBar.vue'

const props = defineProps({
  view: { type: Object, required: true },
  /** @type {import('vue').PropType<import('../context.js').ViewCtx>} */
  ctx: { type: Object, required: true }
})

const rows = computed(() => {
  const cut = props.view.limit && !props.ctx.expanded ? props.view.limit : props.view.items.length
  return props.view.items.slice(0, cut)
})

/** @param {any} it */
function sub (it) {
  void minute.value
  return `${it.subtitle ?? ''}${it.subtitle && it.time ? ' - ' : ''}${it.time ? relative(it.time) : ''}`
}

/** @param {string} icon e.g. mdi:pause */
const glyph = icon => ({ '--icon': `url('/icons/${icon.replace(':', '/')}.svg')` })
</script>

<template>
  <div
    v-if="!view.items.length"
    class="v-empty"
  >
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    ><circle
      cx="12"
      cy="12"
      r="8.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
    /><path
      fill="currentColor"
      d="M9.5 8.5h1.8v7H9.5zm3.2 0h1.8v7h-1.8z"
    /></svg>
    {{ view.empty ?? 'Nothing to show' }}
  </div>
  <template v-else>
    <ul :class="['v-list', { dense: view.dense }]">
      <li
        v-for="(it, i) in rows"
        :key="it.key ?? `${i}:${it.title}`"
        class="v-row"
        :data-tone="it.tone ?? undefined"
      >
        <span
          v-if="it.icon"
          class="v-row-icon icon-mono"
          :style="glyph(it.icon)"
        />
        <span
          v-if="it.badge"
          :class="['badge', `tone-${it.badge.tone ?? 'neutral'}`]"
        >{{ it.badge.text }}</span>
        <div class="v-row-main">
          <a
            v-if="it.href"
            class="v-row-title"
            :href="it.href"
            target="_blank"
            rel="noopener"
          >{{ it.title }}</a>
          <span
            v-else
            class="v-row-title"
          >{{ it.title }}</span>
          <span
            v-if="it.subtitle || it.time"
            class="v-row-sub"
          >{{ sub(it) }}</span>
          <TimeBar
            v-if="it.progress && it.progress.end > it.progress.start"
            :start="it.progress.start"
            :end="it.progress.end"
          />
          <ProgressBar
            v-else-if="it.progress"
            :value="it.progress.value"
            :max="it.progress.max ?? 100"
          />
        </div>
        <template v-if="it.value !== undefined && it.value !== null">
          <CountDown
            v-if="it.format === 'until'"
            :end="it.value"
          />
          <span
            v-else
            class="v-row-value"
          >{{ fmt(it.value, it.format) }}</span>
        </template>
        <span
          v-if="it.actions?.length"
          class="v-row-actions"
        >
          <button
            v-for="a in it.actions"
            :key="actionKey(ctx.tileId, a.action, a.input)"
            class="btn-mini"
            :disabled="ctx.pending.has(actionKey(ctx.tileId, a.action, a.input))"
            @click.prevent="ctx.onAction(a.action, a.input)"
          >
            {{ a.title }}
          </button>
        </span>
      </li>
    </ul>
    <button
      v-if="view.limit && view.items.length > view.limit"
      class="v-more"
      @click="ctx.onToggle"
    >
      {{ ctx.expanded ? 'Show less' : `Show ${view.items.length - view.limit} more` }}
    </button>
  </template>
</template>
