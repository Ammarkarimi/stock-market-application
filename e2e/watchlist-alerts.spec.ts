import { expect, test } from '@playwright/test';
import { quote, register, toast, toTick } from './helpers';

test.describe('Watchlists and price alerts', () => {
  test('US-19/20: watches a stock and sets a price alert on it', async ({ page }) => {
    await register(page);
    await page.goto('/stocks/HDFCBANK');

    await page.getByRole('button', { name: /^Watch\b/ }).click();
    await page.getByRole('menuitem', { name: 'My Watchlist' }).click();
    await expect(toast(page, 'Added to My Watchlist')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Watching/ })).toBeVisible();

    const { last, tick } = await quote(page, 'HDFCBANK');
    await page.getByRole('button', { name: 'Alert', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Above' }).click();
    await dialog.getByLabel('Target price').fill(toTick(last * 1.1, tick));
    await dialog.getByRole('button', { name: 'Create alert' }).click();
    await expect(toast(page, 'Price alert created')).toBeVisible();

    await page.goto('/watchlist');
    await expect(page.getByRole('row').filter({ hasText: 'HDFCBANK' })).toBeVisible();

    await page.goto('/alerts');
    await expect(page.getByRole('row').filter({ hasText: 'HDFCBANK' })).toContainText('Rises above');
  });
});
