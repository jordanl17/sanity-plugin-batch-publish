import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    // @sanity/ui component renders under jsdom are heavy; the default 5s tips over
    // on slower CI runners even though the assertions pass. Give them headroom.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['packages/*/src/__tests__/**'],
      reporter: ['text', 'lcov'],
    },
  },
})
