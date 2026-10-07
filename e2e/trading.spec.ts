import { expect, test } from '@playwright/test';
import { enterPin, fundedInvestor, quote, toast, toTick } from './helpers';

test.describe('Trading', () => {
  test('US-11/12/13/17/21: finds a stock, buys at market, sells part and tracks the holding', async ({ page }) => {
    const user = await fundedInvestor(page);

    await page.getByRole('combobox', { name: 'Search stocks, ETFs and indices' }).fill('infosys');
    await page.getByRole('option', { name: /INFY/ }).click();
    await expect(page).toHaveURL(/\/stocks\/INFY$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Infosys Ltd');

    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    const ticket = page.getByRole('dialog');
    await ticket.getByLabel('Quantity', { exact: true }).fill('3');
    await ticket.getByRole('button', { name: 'Review order' }).click();
    await expect(ticket.getByText('Total payable')).toBeVisible();
    await enterPin(page, user.pin);
    await ticket.getByRole('button', { name: 'Confirm buy' }).click();
    await expect(ticket.getByText(/^Bought 3 INFY at ₹/)).toBeVisible();
    await ticket.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: 'Sell', exact: true }).click();
    await ticket.getByLabel('Quantity', { exact: true }).fill('1');
    await ticket.getByRole('button', { name: 'Review order' }).click();
    await enterPin(page, user.pin);
    await ticket.getByRole('button', { name: 'Confirm sell' }).click();
    await expect(ticket.getByText(/^Sold 1 INFY at ₹/)).toBeVisible();
    await ticket.getByRole('button', { name: 'Done' }).click();

    await page.goto('/portfolio');
    const holding = page.getByRole('row').filter({ hasText: 'INFY' });
    await expect(holding.getByRole('cell').nth(1)).toHaveText('2');

    await page.goto('/orders?tab=trades');
    await expect(page.getByRole('row').filter({ hasText: 'INFY' })).toHaveCount(2);

    await page.goto('/notifications');
    await expect(page.getByText(/Bought 3 INFY/).first()).toBeVisible();
  });

  test('US-14/15/16: places a limit order, modifies it and cancels it', async ({ page }) => {
    const user = await fundedInvestor(page);
    await page.goto('/stocks/TCS');
    const { last, tick, lower } = await quote(page, 'TCS');
    // Below the market (so it rests) but inside the day's price band.
    const limit = toTick(Math.max(lower + tick, last * 0.95), tick);

    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    const ticket = page.getByRole('dialog');
    await ticket.getByRole('radio', { name: 'Limit' }).click();
    await ticket.getByLabel('Quantity', { exact: true }).fill('4');
    await ticket.getByLabel('Limit price').fill(limit);
    await ticket.getByRole('button', { name: 'Review order' }).click();
    await expect(ticket.getByText(/will be blocked until the order executes or is cancelled/)).toBeVisible();
    await enterPin(page, user.pin);
    await ticket.getByRole('button', { name: 'Confirm buy' }).click();
    await expect(ticket.getByText('Order placed')).toBeVisible();
    await ticket.getByRole('button', { name: 'View orders' }).click();

    await expect(page).toHaveURL(/\/orders$/);
    const open = page.getByRole('row').filter({ hasText: 'TCS' });
    await expect(open.getByRole('cell').nth(1)).toHaveText('4');

    await open.getByRole('button', { name: 'Modify' }).click();
    const modify = page.getByRole('dialog');
    await modify.getByLabel('Quantity', { exact: true }).fill('2');
    await enterPin(page, user.pin);
    await modify.getByRole('button', { name: 'Modify order' }).click();
    await expect(toast(page, 'Order modified')).toBeVisible();
    await expect(open.getByRole('cell').nth(1)).toHaveText('2');

    await open.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click();
    await expect(toast(page, 'Order cancelled')).toBeVisible();
    await expect(page.getByText('No open orders')).toBeVisible();

    await page.getByRole('tab', { name: 'Order history' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'TCS' })).toContainText('Cancelled');
  });

  test('US-07: a wrong transaction PIN blocks the order', async ({ page }) => {
    await fundedInvestor(page);
    await page.goto('/stocks/ITC');
    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    const ticket = page.getByRole('dialog');
    await ticket.getByRole('button', { name: 'Review order' }).click();
    await enterPin(page, '9090');
    await ticket.getByRole('button', { name: 'Confirm buy' }).click();
    await expect(ticket.getByText(/Incorrect PIN/i)).toBeVisible();
    await expect(ticket.getByText('Order executed')).toHaveCount(0);
  });
});
