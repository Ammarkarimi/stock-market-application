import { expect, test } from '@playwright/test';
import { enterPin, fundedInvestor, toast } from './helpers';

test.describe('IPOs', () => {
  test('US-22/23/24: applies for an open IPO at the cut-off price, then cancels the application', async ({ page }) => {
    const user = await fundedInvestor(page, 250_000);
    await page.goto('/ipo');
    await page.getByRole('link', { name: 'Apply now' }).first().click();
    await expect(page).toHaveURL(/\/ipo\/\d+$/);

    await page.getByLabel(/Bid at cut-off price/).check();
    await page.getByRole('button', { name: 'Review application' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Amount blocked')).toBeVisible();
    await enterPin(page, user.pin);
    await dialog.getByRole('button', { name: 'Confirm & apply' }).click();
    await expect(toast(page, 'Application submitted')).toBeVisible();
    await expect(page.getByText('Application no.')).toBeVisible();

    await page.goto('/ipo?tab=applications');
    await expect(page.getByRole('row').filter({ hasText: 'Pending allotment' })).toHaveCount(1);

    await page.goBack();
    await page.getByRole('button', { name: 'Cancel application' }).click();
    await expect(toast(page, 'Application cancelled')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review application' })).toBeVisible();
  });
});
