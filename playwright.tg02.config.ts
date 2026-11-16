import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', testMatch: 'tg02-flow.spec.ts', timeout: 120000,
  use: { baseURL: 'http://127.0.0.1:14232', viewport: { width: 1440, height: 900 }, headless: true },
  webServer: { command: 'npx --no-install vite --config vite.tg02-test.config.ts', url: 'http://127.0.0.1:14232/tests/tg02-flow-harness.html', reuseExistingServer: false } });
