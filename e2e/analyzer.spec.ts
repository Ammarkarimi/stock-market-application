import { expect, test } from '@playwright/test';
import { DEMO_INVESTOR, signIn } from './helpers';

// The analyzer reads real prices from Yahoo Finance, so these tests need internet access.
test.describe('Chart analyzer', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO_INVESTOR);
    const probe = await page.request.get('/api/analysis/search?q=reliance');
    test.skip(!probe.ok(), `Yahoo Finance is unreachable (HTTP ${probe.status()}), so the analyzer cannot be tested`);
  });

  test('US-36/37/38/39: analyzes a stock typed by name and explains the verdict', async ({ page }) => {
    await page.goto('/analyze');
    await page.getByRole('combobox', { name: 'Stock name or symbol' }).fill('Reliance');
    await expect(page.getByRole('option').first()).toContainText('RELIANCE.NS');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/analyze\/RELIANCE\.NS$/);
    await expect(page.getByTestId('verdict')).toHaveText(/^(Buy|Wait|Avoid)$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Reliance Industries Limited' })).toBeVisible();
    await expect(page.getByText('Stop-loss')).toBeVisible();
    await expect(page.getByRole('meter', { name: 'Signal score' })).toBeVisible();
    for (const heading of ['Patterns found', 'Why this verdict', 'Indicators', 'Support and resistance']) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
    await expect(page.getByText('RSI (14)')).toBeVisible();
    await expect(page.getByText(/not investment advice/)).toBeVisible();
  });

  test('US-36: says so when nothing matches the name', async ({ page }) => {
    await page.goto('/analyze');
    await page.getByRole('combobox', { name: 'Stock name or symbol' }).fill('qqzzxx no such company');
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByRole('alert')).toContainText('No listed stock');
    await expect(page).toHaveURL(/\/analyze$/);
  });

  test('US-36: opens the analysis from a stock page', async ({ page }) => {
    await page.goto('/stocks/TCS');
    await page.getByRole('link', { name: 'Analyze chart' }).click();
    await expect(page).toHaveURL(/\/analyze\/TCS\.NS$/);
    await expect(page.getByTestId('verdict')).toHaveText(/^(Buy|Wait|Avoid)$/, { timeout: 30_000 });
  });
});
