import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The page: web/ is the source, dist/ what the server serves. In development (dev/dev.js) Vite serves web/ itself and
// passes everything the page asks of the server to it.
export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: { outDir: '../dist', emptyOutDir: true }
})
