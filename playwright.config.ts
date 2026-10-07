import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4300);
const baseURL = `http://localhost:${port}`;

/**
 * End-to-end tests drive the production build (run `npm run build` first; `npm run test:e2e` does it for you)
 * against a fresh in-memory database seeded with the demo data.
 * Set PLAYWRIGHT_CHROMIUM_PATH to use an already-installed Chromium instead of `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: 'e2e',
  // Specs share one server, so run them one at a time; each test creates the users it changes.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: {
    command: 'node server/dist/index.js',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_PATH: ':memory:',
      SEED_DEMO_DATA: 'true',
      COOKIE_SECURE: 'false',
      RATE_LIMIT: 'false',
    },
  },
});
