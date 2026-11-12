import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against a RUNNING stack (see docs/TESTING.md, "End-to-end tests").
 *   E2E_BASE_URL   the web address (default http://localhost:3005)
 *   E2E_API_URL    the API address (default http://localhost:5050/api)
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD   an administrator, only for the member-journey spec (skipped when missing)
 *   E2E_BROWSER_CHANNEL   e.g. "chrome" to use an installed Chrome instead of downloading Chromium
 * Nothing here changes data except the member-journey spec, which registers one throw-away member.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'e2e/.results',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3005',
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 } } },
  ],
});
