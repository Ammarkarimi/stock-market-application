import { expect, test } from '@playwright/test';
import { DEMO_ADMIN, DEMO_INVESTOR, register, signIn } from './helpers';

test.describe('Administration', () => {
  test('US-29/34: an admin suspends an investor, who is signed out and cannot sign back in', async ({ browser }) => {
    const investorContext = await browser.newContext();
    const investorPage = await investorContext.newPage();
    const investor = await register(investorPage);

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, DEMO_ADMIN);
    await admin.goto('/admin/users');
    await admin.getByLabel('Search users').fill(investor.email);
    await admin.getByRole('link', { name: investor.fullName }).click();
    await expect(admin.getByRole('heading', { level: 1 })).toContainText(investor.fullName);

    await admin.getByRole('button', { name: 'Suspend' }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByLabel('Reason').fill('Account flagged during an end-to-end test');
    await dialog.getByRole('button', { name: 'Suspend account' }).click();
    await expect(admin.getByRole('button', { name: 'Reactivate' })).toBeVisible();

    // The investor's session was revoked, and signing in again is refused.
    await investorPage.goto('/portfolio');
    await expect(investorPage).toHaveURL(/\/login/);
    await investorPage.getByLabel('Email').fill(investor.email);
    await investorPage.getByLabel('Password', { exact: true }).fill(investor.password);
    await investorPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(investorPage.getByRole('alert')).toContainText('suspended');

    // The suspension is in the audit trail, and the hash chain still verifies.
    await admin.goto('/admin/audit');
    await expect(admin.getByRole('row').filter({ hasText: 'Account suspended' }).filter({ hasText: investor.fullName }).first()).toBeVisible();
    await admin.getByRole('button', { name: 'Verify integrity' }).click();
    await expect(admin.getByText('Audit trail intact')).toBeVisible();

    await investorContext.close();
    await adminContext.close();
  });

  test('US-29: investors cannot reach the admin panel or its API', async ({ page }) => {
    await signIn(page, DEMO_INVESTOR);
    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/admin/);
    const response = await page.request.get('/api/admin/overview');
    expect(response.status()).toBe(403);
  });
});
