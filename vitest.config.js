import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['test/frontend/**/*.test.js'],
    setupFiles: ['test/frontend/setup.js'],
    restoreMocks: true
  }
})
