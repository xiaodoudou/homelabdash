<script setup>
import { computed, nextTick, ref } from 'vue'
import { fmt, threshold, duration } from '../../format.js'

/**
 * History of one stat as a line under its value: 1.5px line, faint area, end dot, crosshair with value and age on hover
 * or tap. The x axis ends now; while history is short it starts at the first point (at least a minute), so a fresh
 * graph is not squeezed against the right edge. Scales are fixed so noise never looks like a peak: percent 0-100,
 * temperature 20 to crit, others 0 to 1.15x max.
 */
const props = defineProps({
  series: { type: Object, required: true },
  label: { type: String, default: '' },
  format: { type: String, default: '' },
  unit: { type: String, default: '' },
  warn: { type: Number, default: undefined },
  crit: { type: Number, default: undefined },
  window: { type: Number, default: 3_600_000 }
})

const H = 22

const shape = computed(() => {
  const s = props.series
  if (!s || s.t.length < 2) return null
  const now = Date.now()
  const t0 = Math.max(now - props.window, Math.min(s.t[0], now - 60_000))
  const span = now - t0
  const max = Math.max(...s.v)
  /** @type {[number, number]} */
  const [lo, hi] = props.format === 'percent'
    ? [0, Math.max(100, ...s.v)]
    : props.format === 'temperature' ? [20, Math.max(props.crit ?? 90, ...s.v)] : [Math.min(0, ...s.v), max > 0 ? max * 1.15 : 1]
  const y = (/** @type {number} */ v) => H - 1.5 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * (H - 4)
  let d = ''
  s.t.forEach((/** @type {number} */ t, /** @type {number} */ i) => { d += `${i ? 'L' : 'M'}${Math.max(0, t - t0)} ${y(s.v[i]).toFixed(2)}` })
  const last = s.v[s.v.length - 1]
  d += `L${span} ${y(last).toFixed(2)}`
  return {
    t0,
    span,
    y,
    line: d,
    area: `${d}L${span} ${H}L${Math.max(0, s.t[0] - t0)} ${H}Z`,
    base: `M0 ${H - 1.5}H${span}`,
    flat: s.v.every((/** @type {number} */ v) => v === 0),
    tone: threshold({ value: last, warn: props.warn, crit: props.crit }),
    end: `${((H - y(last)) / H) * 100}%`,
    aria: `${props.label}, last ${duration(span / 1000)}, from ${fmt(Math.min(...s.v), props.format, props.unit)} to ${fmt(max, props.format, props.unit)}`
  }
})

/** @type {import('vue').Ref<HTMLElement | null>} */
const el = ref(null)
/** @type {import('vue').Ref<HTMLElement | null>} */
const tipEl = ref(null)
/** @type {import('vue').Ref<{ px: number, bottom: string, value: string, age: string, left: string } | null>} */
const hover = ref(null)

/** @param {PointerEvent} e */
async function point (e) {
  const s = props.series
  const sh = shape.value
  if (!sh || !el.value) return
  const r = el.value.getBoundingClientRect()
  const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  const t = sh.t0 + fx * sh.span
  let i = 0
  while (i < s.t.length - 1 && Math.abs(s.t[i + 1] - t) <= Math.abs(s.t[i] - t)) i++
  const px = (Math.max(0, s.t[i] - sh.t0) / sh.span) * r.width
  const secs = (Date.now() - s.t[i]) / 1000
  hover.value = {
    px,
    bottom: `${((H - sh.y(s.v[i])) / H) * 100}%`,
    value: fmt(s.v[i], props.format, props.unit),
    age: secs < 60 ? 'now' : `${duration(secs)} ago`,
    left: `${px}px`
  }
  // Keep the tip inside the tile, once it is drawn and has a width.
  await nextTick()
  if (!hover.value || !tipEl.value) return
  const tile = el.value.closest('.tile')?.getBoundingClientRect() ?? r
  const w = tipEl.value.offsetWidth
  hover.value.left = `${Math.min(tile.right - 8 - r.left - w / 2, Math.max(tile.left + 8 - r.left + w / 2, px))}px`
}
</script>

<template>
  <div
    ref="el"
    :class="['v-spark', { 'is-flat': shape?.flat, 'tone-warning': shape?.tone === 'warning', 'tone-error': shape?.tone === 'error', 'is-hover': hover }]"
    :style="{ visibility: shape ? undefined : 'hidden' }"
    role="img"
    :aria-label="shape?.aria"
    @pointermove="point"
    @pointerdown="point"
    @pointerleave="hover = null"
  >
    <svg
      v-if="shape"
      :viewBox="`0 0 ${shape.span} ${H}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        class="sb"
        :d="shape.base"
      />
      <path
        v-if="!shape.flat"
        class="sa"
        :d="shape.area"
      />
      <path
        class="sl"
        :d="shape.line"
      />
    </svg>
    <i
      class="v-spark-x"
      :style="{ left: hover ? `${hover.px}px` : undefined }"
    />
    <i
      class="v-spark-dot"
      :style="{ left: hover ? `${hover.px}px` : undefined, bottom: hover?.bottom }"
    />
    <i
      class="v-spark-end"
      :style="{ bottom: shape?.end }"
    />
    <span
      ref="tipEl"
      class="v-spark-tip"
      :style="{ left: hover?.left }"
    >
      <b>{{ hover?.value }}</b><span>{{ hover?.age }}</span>
    </span>
  </div>
</template>
