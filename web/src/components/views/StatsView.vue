<script setup>
import { computed } from 'vue'
import { minute } from '../../store.js'
import { fmt, threshold } from '../../format.js'
import { hidesLabel } from '../../views.js'
import ValueText from './ValueText.js'
import SparkLine from './SparkLine.vue'

const props = defineProps({
  view: { type: Object, required: true },
  /** @type {import('vue').PropType<import('../context.js').ViewCtx>} */
  ctx: { type: Object, required: true }
})

const hide = computed(() => hidesLabel(props.view, props.ctx.titles))

/** A label graphed twice (two "Used" in one tile) keeps only its first stat. */
const cells = computed(() => {
  void minute.value
  const { graph, history } = props.ctx
  const graphed = (/** @type {string} */ label) => graph === true || (Array.isArray(graph) && graph.includes(label))
  const seen = new Set()
  return props.view.items.map((/** @type {any} */ it) => {
    const tone = threshold(it) || (it.tone && it.tone !== 'neutral' ? it.tone : '')
    const text = it.format === 'text' || (typeof it.value === 'string' && Number.isNaN(Number(it.value)))
    const first = !seen.has(it.label)
    seen.add(it.label)
    return {
      it,
      value: fmt(it.value, it.format, it.unit),
      cls: ['v-stat-value', tone && `tone-${tone}`, !tone && it.value === 0 && 'is-zero', text && 'is-text'],
      series: graphed(it.label) && first ? history?.[it.label] : undefined
    }
  })
})
const style = computed(() => ({ '--scols': props.ctx.stats?.cols ?? props.view.items.length }))
</script>

<template>
  <div
    :class="['v-stats', { 'is-wrapped': ctx.stats?.wrapped }]"
    :style="style"
  >
    <component
      :is="c.it.href ? 'a' : 'div'"
      v-for="(c, i) in cells"
      :key="i"
      class="v-stat"
      :href="c.it.href || undefined"
      :target="c.it.href ? '_blank' : undefined"
      :rel="c.it.href ? 'noopener' : undefined"
    >
      <span
        :class="c.cls"
        :data-f="c.it.format"
      ><ValueText
        :text="c.value"
        :format="c.it.format"
        :unit="c.it.unit ?? undefined"
      /></span>
      <span
        v-if="!hide"
        class="v-stat-label"
      >{{ c.it.label }}<span
        v-if="c.it.detail"
        class="v-stat-detail"
      >{{ c.it.detail }}</span></span>
      <SparkLine
        v-if="c.series"
        :series="c.series"
        :label="c.it.label"
        :format="c.it.format ?? ''"
        :unit="c.it.unit ?? ''"
        :warn="c.it.warn ?? undefined"
        :crit="c.it.crit ?? undefined"
        :window="ctx.window"
      />
    </component>
  </div>
</template>
