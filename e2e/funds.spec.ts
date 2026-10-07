import { expect, test } from '@playwright/test';
import { enterPin, fundedInvestor, inr, toast } from './helpers';

test.describe('Funds and statements', () => {
  test('US-25/26/27/28: adds money, links a bank account, withdraws and sees both in the statement', async ({ page }) => {
    const user = await fundedInvestor(page, 150_000);
    await expect(page.getByText(inr(150_000)).first()).toBeVisible();

    await page.goto('/profile?tab=bank');
    await page.getByLabel('Account holder name').fill(user.fullName);
    await page.getByLabel('Bank name').fill('HDFC Bank');
    await page.getByLabel('Account number', { exact: true }).fill('50100123456789');
    await page.getByLabel('Confirm account number').fill('50100123456789');
    await page.getByLabel('IFSC').fill('HDFC0001234');
    await page.getByRole('button', { name: 'Save bank account' }).click();
    await expect(toast(page, 'Bank account saved')).toBeVisible();

    await page.goto('/funds');
    await page.getByRole('spinbutton', { name: 'Amount' }).nth(1).fill('2500');
    await page.getByRole('button', { name: /^Withdraw ₹/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('HDFC Bank')).toBeVisible();
    await enterPin(page, user.pin);
    await dialog.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await expect(toast(page, 'Withdrawal processed')).toBeVisible();
    await expect(page.getByText(inr(147_500)).first()).toBeVisible();

    await page.goto('/statements');
    await expect(page.getByRole('row').filter({ hasText: /Withdrawal/i }).first()).toContainText('2,500.00');
    await expect(page.getByRole('row').filter({ hasText: /Deposit/i }).first()).toContainText('1,50,000.00');
  });
});
