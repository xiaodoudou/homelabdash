import { ref, onMounted, onBeforeUnmount } from 'vue'

/** One shared one-second clock for everything that counts in the browser; it runs only while something uses it. */
const now = ref(Date.now())
let users = 0
/** @type {ReturnType<typeof setInterval> | undefined} */
let timer

/** @returns {import('vue').Ref<number>} the current time, updated every second while the component is mounted */
export function useSecond () {
  // Idle since the last user left: the first render must not count from that old time.
  if (users === 0) now.value = Date.now()
  onMounted(() => {
    if (users++ === 0) timer = setInterval(() => { now.value = Date.now() }, 1000)
  })
  onBeforeUnmount(() => {
    if (--users === 0) clearInterval(timer)
  })
  return now
}
