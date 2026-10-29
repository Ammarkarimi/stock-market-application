import { defineConfig } from '@playwright/test';

// Launches the staged desktop app (run `npm run desktop:stage` first, or use `npm run test:desktop`).
export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: '../test-results/desktop',
});
