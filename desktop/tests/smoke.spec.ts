import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const desktopDir = path.resolve(__dirname, '..');
const appDir = path.join(desktopDir, 'build', 'app');
const electronPath = createRequire(path.join(desktopDir, 'package.json'))('electron') as unknown as string;
// Chromium refuses to start its sandbox as root (as in containers and some CI runners).
const extraArgs = process.getuid?.() === 0 ? ['--no-sandbox'] : [];

const owner = { fullName: 'Meera Iyer', email: 'meera@example.com', phone: '9123456789', password: 'Desktop2468!' };

function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronPath,
    args: [appDir, ...extraArgs],
    // Simulated prices keep the test fast and independent of the internet.
    env: { ...process.env, STOCKKARO_USER_DATA: userData, MARKET_DATA: 'simulated' },
  });
}

/** The window once it has left the start-up screen for the app's own server. */
async function appWindow(app: ElectronApplication): Promise<{ page: Page; origin: string }> {
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 90_000 });
  return { page, origin: new URL(page.url()).origin };
}

test('US-40/41: runs privately, makes the first account the owner and keeps data between launches', async () => {
  const userData = test.info().outputPath('user-data');
  fs.mkdirSync(userData, { recursive: true });

  const first = await launch(userData);
  const { page, origin } = await appWindow(first);
  expect(await page.title()).toContain('StockKaro');
  await expect(page).toHaveURL(/\/login$/);

  await page.goto(`${origin}/register`);
  await page.getByLabel('Full name').fill(owner.fullName);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Mobile number').fill(owner.phone);
  await page.getByLabel('Password', { exact: true }).fill(owner.password);
  await page.getByLabel('Confirm password').fill(owner.password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Meera');

  // The first account owns the installation.
  await page.goto(`${origin}/admin`);
  await expect(page.getByRole('heading', { name: 'Admin overview' })).toBeVisible();

  // A second copy hands over to the running one and exits.
  const second = spawnSync(electronPath, [appDir, ...extraArgs], { env: { ...process.env, STOCKKARO_USER_DATA: userData }, timeout: 30_000 });
  expect(second.status).toBe(0);

  await first.close();
  expect(fs.existsSync(path.join(userData, 'stockkaro.db'))).toBe(true);
  expect(fs.readFileSync(path.join(userData, 'logs', 'server.log'), 'utf8')).toMatch(/listening on http:\/\/127\.0\.0\.1:\d+[\s\S]*Shutting down[\s\S]*exited with code 0/);

  // Data survives a restart.
  const again = await launch(userData);
  const reopened = await appWindow(again);
  if (/\/login$/.test(reopened.page.url())) {
    await reopened.page.getByLabel('Email').fill(owner.email);
    await reopened.page.getByLabel('Password', { exact: true }).fill(owner.password);
    await reopened.page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(reopened.page.getByRole('heading', { level: 1 })).toContainText('Meera');
  await again.close();
});
