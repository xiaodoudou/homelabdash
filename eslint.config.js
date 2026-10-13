import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  { ignores: ['node_modules/', 'data/', '.dev-data/', 'config/', 'coverage/', 'dist/'] },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error'
    }
  },
  {
    files: ['web/**/*.js', 'web/**/*.vue', 'test/frontend/**/*.js'],
    languageOptions: { globals: { ...globals.browser } }
  }
]
