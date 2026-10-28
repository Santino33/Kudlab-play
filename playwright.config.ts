import { defineConfig } from '@playwright/test';
import { demoOrigin, demoPort, productionOrigin, productionPort } from './tests/e2e/origins';
export default defineConfig({
  expect: { timeout: 10000 },
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: demoOrigin, viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: `npm run dev:demo -- --port ${demoPort}`, url: demoOrigin, reuseExistingServer: !process.env.CI },
    { command: `npm run build && PORT=${productionPort} node scripts/serve-production.mjs`, url: productionOrigin, reuseExistingServer: !process.env.CI },
  ],
});
