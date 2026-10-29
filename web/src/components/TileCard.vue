<script setup>
import { computed } from 'vue'
import { tiles, pending, refresh, runAction, actionKey } from '../store.js'
import { useViewContext } from './context.js'
import AppIcon from './AppIcon.vue'
import TileError from './TileError.vue'
import ViewRenderer from './views/ViewRenderer.vue'
import WidgetHost from './views/WidgetHost.vue'
import ActionButton from './ActionButton.vue'

const props = defineProps({
  tile: { type: Object, required: true },
  groupTitle: { type: String, default: undefined }
})

const st = computed(() => tiles.get(props.tile.id))
const ctx = useViewContext(() => props.tile, () => props.groupTitle)
const failed = computed(() => !!st.value?.error && !st.value.view)
const empty = computed(() => !!st.value?.view && st.value.view.type === 'list' && !st.value.view.items.length)
// `width: 30%` and `span: 2` reach the layout as variables; theme.css turns them into the card's share and least width.
const style = computed(() => ({ ...(props.tile.width ? { '--pct': props.tile.width } : {}), ...(props.tile.span > 1 ? { '--span': props.tile.span } : {}) }))
const spanClass = computed(() => props.tile.span === 'full' ? 'span-full' : props.tile.span > 1 ? `span-${props.tile.span}` : '')
const cls = computed(() => ['tile', spanClass.value, props.tile.kind === 'link' && 'tile-link', failed.value && 'is-error', empty.value && 'is-empty'])
</script>

<template>
  <div
    v-if="tile.bare"
    :class="['tile', 'bare', spanClass]"
    :data-tile="tile.id"
    :style="tile.width ? { '--pct': tile.width } : undefined"
  >
    <div
      v-if="st?.loading || !st"
      class="skeleton"
    />
    <TileError
      v-else-if="failed"
      :error="st.error"
    />
    <div
      v-else
      :class="{ stale: st.stale }"
    >
      <ViewRenderer
        :view="st.view"
        :ctx="ctx"
      />
    </div>
  </div>
  <article
    v-else
    :class="cls"
    :data-tile="tile.id"
    :data-plugin="tile.plugin ?? ''"
    :style="style"
  >
    <header
      v-if="tile.title || tile.icon || failed || st?.stale"
      class="tile-head"
    >
      <AppIcon :icon="tile.icon" />
      <a
        v-if="tile.href"
        class="tile-title"
        :href="tile.href"
        :target="tile.target"
        rel="noopener"
      >{{ tile.title ?? '' }}</a>
      <span
        v-else
        class="tile-title"
      >{{ tile.title ?? '' }}</span>
      <button
        v-if="tile.kind === 'data'"
        class="tile-refresh"
        title="Refresh"
        @click="refresh(tile.id)"
      >
        &#x21bb;
      </button>
      <span
        v-if="failed"
        class="badge tone-error"
        :title="st?.error ?? ''"
      >error</span>
      <span
        v-else-if="st?.stale"
        class="badge tone-warning"
        :title="st.error ?? ''"
      >stale</span>
      <span
        v-else-if="tile.hasStatus && st?.status"
        :class="['dot', `dot-${st.status.state}`]"
        :title="st.status.label ?? st.status.state"
      />
    </header>
    <div class="tile-body">
      <template v-if="tile.kind === 'link'">
        <div
          v-if="tile.description"
          class="tile-desc"
        >
          {{ tile.description }}
        </div>
      </template>
      <div
        v-else-if="st?.loading || !st"
        class="skeleton"
      />
      <TileError
        v-else-if="failed"
        :error="st.error"
      />
      <WidgetHost
        v-else-if="tile.widget && st.view?.type === 'custom'"
        :view="st.view"
        :plugin="tile.plugin"
      />
      <div
        v-else
        :class="{ stale: st.stale }"
      >
        <ViewRenderer
          :view="st.view"
          :ctx="ctx"
        />
      </div>
    </div>
    <footer
      v-if="st?.view?.actions?.length"
      class="tile-actions"
    >
      <ActionButton
        v-for="a in st.view.actions"
        :key="a.action"
        :action="a"
        :disabled="pending.has(actionKey(tile.id, a.action, a.input))"
        @run="runAction(tile.id, a.action, a.input)"
      />
    </footer>
  </article>
</template>
