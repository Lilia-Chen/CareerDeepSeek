import { defineConfig } from '@moeru/eslint-config'

export default defineConfig({
  masknet: false,
  preferArrow: false,
  perfectionist: false,
  sonarjs: false,
  sortPackageJsonScripts: false,
  typescript: true,
  unocss: false,
  vue: false,
}, {
  ignores: [
    'coverage/**',
    'dist/**',
    'node_modules/**',
  ],
}, {
  rules: {
    'antfu/import-dedupe': 'error',
    'depend/ban-dependencies': 'warn',
    'import/order': 'off',
    'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    'style/padding-line-between-statements': 'error',
  },
})
