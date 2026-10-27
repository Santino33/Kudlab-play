import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/integration', timeout: 210000, workers: 1, expect: { timeout: 10000 },
  use: { actionTimeout: 15000, navigationTimeout: 15000, browserName: 'chromium', launchOptions: { executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] }, viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  reporter: [['list']], outputDir: 'test-results/kudlab-integration' });
