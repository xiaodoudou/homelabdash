// What a .vue import is, for the typecheck of the JavaScript modules that import components.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
