import { defineConfig } from '@playwright/test';
export default defineConfig({
  expect: { timeout: 10000 },
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'npm run dev:demo', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
    { command: 'npm run build && node scripts/serve-production.mjs', url: 'http://127.0.0.1:4174', reuseExistingServer: !process.env.CI },
  ],
});
