// What a .vue import is, for the typecheck of the JavaScript modules that import components.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Stylesheets are imported for their side effect; Vite bundles them.
declare module '*.css'

// `?url` imports give the URL Vite serves the file at.
declare module '*?url' {
  const url: string
  export default url
}
