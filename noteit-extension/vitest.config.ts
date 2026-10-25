// Vitest projects (architecture.md "Testing & CI Architecture"):
// - unit:    *.test.ts next to the source (src/, scripts/, tests/corpus/, tests/perf/, tests/spike/), Node environment, fake-indexeddb loaded globally.
// - browser: *.browser.test.ts next to the source and tests/sidebar/*.browser.test.tsx (side panel shell),
//            real Chromium via Playwright (DOM, Range, Selection).
// - integration: tests/integration/*.int.test.ts against the local Supabase stack
//   (`npm run db:start && npm run db:reset` first). Run serially: tests share one database.
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/corpus/**/*.test.ts', 'tests/perf/**/*.test.ts', 'tests/spike/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          environment: 'node',
          setupFiles: ['fake-indexeddb/auto'],
        },
      },
      {
        // Pre-bundled up front: a mid-run dependency optimization reloads the page and fails the
        // side panel shell test import.
        optimizeDeps: { include: ['react', 'react/jsx-dev-runtime', 'react-dom/client', 'dexie'] },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts', 'tests/sidebar/**/*.browser.test.tsx'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.int.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
})
