// Playwright projects (architecture.md "Testing & CI Architecture"):
// - e2e:    tests/e2e/**/*.e2e.ts (except two-device) against the built extension (dist/) loaded via --load-extension.
// - two-device: tests/e2e/two-device.e2e.ts, the SC-1 suite, repeated 3 times (run by test:e2e).
// - corpus: tests/corpus/**/*.corpus.ts anchoring corpus (tests/corpus/runner.ts; writes tests/corpus/corpus-report.json).
// - perf:   tests/perf/**/*.perf.ts performance cases (tests/perf/perf.ts; writes tests/perf/perf-report.json).
// - spike:  tests/spike/**/*.spike.ts renderer spike S1-S7 (Story 4.6), run per VITE_RENDERER build by
//           scripts/run-spike.ts; writes tests/spike/spike-report.json.
// Every project needs `npm run build` first; the extension fixture fails fast when dist/ is missing.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One persistent Chromium profile per test; keep runs serial to avoid flaky extension startup.
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'e2e', testDir: 'tests/e2e', testMatch: '**/*.e2e.ts', testIgnore: '**/two-device.e2e.ts' },
    // SC-1 two-device suite (Story 2.22): every scenario runs 3 times and retries are off, so a flaky
    // pass cannot hide behind a retry. Two browsers per test, hence the longer timeout.
    {
      name: 'two-device',
      testDir: 'tests/e2e',
      testMatch: '**/two-device.e2e.ts',
      repeatEach: 3,
      retries: 0,
      timeout: 180_000,
    },
    { name: 'corpus', testDir: 'tests/corpus', testMatch: '**/*.corpus.ts' },
    { name: 'perf', testDir: 'tests/perf', testMatch: '**/*.perf.ts' },
    { name: 'spike', testDir: 'tests/spike', testMatch: '**/*.spike.ts' },
  ],
})
