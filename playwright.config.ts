import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. Tests live in ./e2e (separate from Karma unit specs in src/).
 * Boots the dev server automatically; reuses one if already running.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:4200',
    headless: true,
    // Set SLOWMO=700 (ms) to watch actions step-by-step with --headed.
    launchOptions: { slowMo: Number(process.env['SLOWMO'] || 0) },
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4200',
    timeout: 180_000,
    reuseExistingServer: true,
  },
});
