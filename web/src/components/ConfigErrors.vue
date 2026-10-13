<script setup>
defineProps({ errors: { type: Array, required: true } })
</script>

<template>
  <details
    class="config-errors"
    open
  >
    <summary>Config has {{ errors.length }} error{{ errors.length > 1 ? 's' : '' }}; the rest of the dashboard keeps running</summary>
    <ul>
      <li
        v-for="(e, i) in errors"
        :key="i"
      >
        <code>{{ e.file ?? '' }}{{ e.line ? `:${e.line}` : '' }}</code>
        {{ ' ' }}<template v-if="e.path">
          <b>{{ e.path }}</b>:
        </template>{{ e.message }}
      </li>
    </ul>
  </details>
</template>
