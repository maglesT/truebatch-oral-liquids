import { defineConfig, devices } from '@playwright/test';
import { E2E_PACKING_PORT, E2E_PORT } from './e2e/config.js';

// Browser journeys. The web servers build the UI and start the real app (TrueBatch Tablets, and TrueBatch Tablets
// Packing) on their own schemas of the test database; the specs share them, so they run one at a time.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    // Forms take times in the browser's zone; the plant is in India.
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [{
    command: 'npx vite build && npx tsx e2e/server.ts',
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
  }, {
    // TrueBatch Tablets Packing (e2e/packing.spec.ts).
    command: 'npx vite build --config packing/vite.config.ts && npx tsx e2e/packing-server.ts',
    url: `http://127.0.0.1:${E2E_PACKING_PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
  }],
});
