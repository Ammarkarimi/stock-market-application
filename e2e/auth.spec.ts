import { expect, test } from '@playwright/test';
import { DEMO_INVESTOR, register, signIn, signOut } from './helpers';

test.describe('Accounts and sessions', () => {
  test('US-01/02/03: registers, signs out and signs back in', async ({ page }) => {
    const user = await register(page);
    await signOut(page);

    await signIn(page, user);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Asha');
  });

  test('US-02/05: rejects a wrong password with a generic message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(DEMO_INVESTOR.email);
    await page.getByLabel('Password', { exact: true }).fill('not-the-password1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
    await expect(page).toHaveURL(/\/login/);
  });

  test('US-05: protected pages need a session and return to the requested page after sign-in', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page).toHaveURL(/\/login/);
    await signIn(page, DEMO_INVESTOR);
    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  });

  test('US-06: lists the current session and signs it out', async ({ page }) => {
    await signIn(page, DEMO_INVESTOR);
    await page.goto('/profile?tab=security');
    const current = page.getByText('This device');
    await expect(current).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
