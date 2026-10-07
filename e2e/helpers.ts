import { expect, type Page } from '@playwright/test';

/** Accounts created by the demo seed (see server/src/seed/demo.ts). */
export const DEMO_INVESTOR = { email: 'demo@example.com', password: 'Demo@12345', pin: '2468' };
export const DEMO_ADMIN = { email: 'admin@example.com', password: 'Admin@12345', pin: '1357' };

export interface Investor {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  pin: string;
}

let sequence = 0;

/** Unique sign-up details, so tests that change account state never share a user. */
export function newInvestorDetails(): Investor {
  sequence += 1;
  return {
    fullName: 'Asha Kulkarni',
    email: `e2e.${Date.now().toString(36)}.${sequence}@example.com`,
    phone: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
    password: 'Invest2468!',
    pin: '5821',
  };
}

export async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

export async function register(page: Page, user: Investor = newInvestorDetails()): Promise<Investor> {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(user.fullName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Mobile number').fill(user.phone);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByLabel('Confirm password').fill(user.password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(user.fullName.split(' ')[0]!);
  return user;
}

export async function setTransactionPin(page: Page, user: Investor) {
  await page.goto('/profile?tab=security');
  await page.getByLabel('Account password').fill(user.password);
  await page.getByLabel('PIN', { exact: true }).fill(user.pin);
  await page.getByLabel('Confirm PIN').fill(user.pin);
  await page.getByRole('button', { name: 'Set PIN' }).click();
  await expect(toast(page, 'Transaction PIN set')).toBeVisible();
}

export async function addMoney(page: Page, amount: number) {
  await page.goto('/funds');
  await page.getByRole('spinbutton', { name: 'Amount' }).first().fill(String(amount));
  await page.getByRole('button', { name: /^Add ₹/ }).click();
  await expect(toast(page, `${inr(amount)} added`)).toBeVisible();
}

/** A newly registered investor with a transaction PIN and money to trade with. */
export async function fundedInvestor(page: Page, amount = 200_000): Promise<Investor> {
  const user = await register(page);
  await setTransactionPin(page, user);
  await addMoney(page, amount);
  return user;
}

export async function enterPin(page: Page, pin: string) {
  await page.getByLabel('Transaction PIN').fill(pin);
}

/** Indian-format rupees as the app renders them, e.g. 150000 -> "₹1,50,000.00". */
export function inr(amount: number, decimals = 2): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** The toast containing the text. Deliberately strict: a duplicate toast (e.g. a notification echoing the
 * confirmation the page already showed) makes the assertion fail. */
export function toast(page: Page, text: string | RegExp) {
  return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** Live quote and price band for a symbol, read with the page's session. */
export async function quote(page: Page, symbol: string) {
  const response = await page.request.get(`/api/securities/${symbol}`);
  expect(response.ok()).toBeTruthy();
  const detail = (await response.json()) as {
    quote: { lastPrice: number };
    security: { tickSize: number };
    metrics: { lowerCircuit: number; upperCircuit: number };
  };
  return { last: detail.quote.lastPrice, tick: detail.security.tickSize, lower: detail.metrics.lowerCircuit, upper: detail.metrics.upperCircuit };
}

/** Rounds to the instrument's tick size and formats for a price input. */
export function toTick(price: number, tick: number): string {
  return (Math.round(price / tick) * tick).toFixed(2);
}
