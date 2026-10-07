import { beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/db/index.js';
import { getQuoteBySymbol } from '../src/market/quoteStore.js';
import { DEFAULT_PASSWORD, DEFAULT_PIN, registerClient, registerWithPin, TestClient } from './helpers.js';
import { setupMarket } from './setup-market.js';

let admin: TestClient;
let adminId: number;

beforeAll(async () => {
  setupMarket({ ipos: true });
  const { user, email } = await registerClient({ fullName: 'Admin User' });
  run("UPDATE users SET role = 'ADMIN' WHERE id = ?", user.id);
  adminId = user.id;
  admin = new TestClient();
  const res = await admin.post('/api/auth/login', { email, password: DEFAULT_PASSWORD });
  admin.csrfToken = res.body.csrfToken;
});

describe('admin access control', () => {
  it('rejects non-admin users', async () => {
    const { client } = await registerClient();
    expect((await client.get('/api/admin/overview')).status).toBe(403);
    expect((await new TestClient().get('/api/admin/overview')).status).toBe(401);
  });

  it('returns platform overview metrics', async () => {
    const res = await admin.get('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.users.total).toBeGreaterThanOrEqual(1);
    expect(res.body.daily).toHaveLength(14);
    expect(res.body.ipos.open).toBe(2);
  });
});

describe('user management', () => {
  it('suspends a user, revoking sessions and blocking login, then reactivates', async () => {
    const { client, user, email } = await registerWithPin();
    await client.post('/api/funds/deposit', { amount: 50_000, method: 'UPI' });
    const hdfc = getQuoteBySymbol('HDFCBANK')!;
    await client.post('/api/orders', { symbol: 'HDFCBANK', side: 'BUY', orderType: 'LIMIT', quantity: 10, limitPrice: Math.round((hdfc.last * 0.9) / 5) * 5 / 100, pin: DEFAULT_PIN });

    const list = await admin.get(`/api/admin/users?q=${encodeURIComponent(email)}`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].cashBalance).toBe(50_000);

    expect((await admin.post(`/api/admin/users/${user.id}/status`, { status: 'SUSPENDED', reason: 'no' })).status).toBe(400);
    const suspended = await admin.post(`/api/admin/users/${user.id}/status`, { status: 'SUSPENDED', reason: 'Suspicious activity' });
    expect(suspended.body.user.status).toBe('SUSPENDED');
    expect((await client.get('/api/auth/me')).status).toBe(401);
    expect((await new TestClient().post('/api/auth/login', { email, password: DEFAULT_PASSWORD })).status).toBe(403);

    const detail = await admin.get(`/api/admin/users/${user.id}`);
    expect(detail.body.orders[0].status).toBe('CANCELLED');
    expect(detail.body.funds.blockedForOrders).toBe(0);
    expect(detail.body.activity.map((a: { action: string }) => a.action)).toContain('USER_SUSPENDED');

    await admin.post(`/api/admin/users/${user.id}/status`, { status: 'ACTIVE', reason: 'Verified by phone' });
    expect((await new TestClient().post('/api/auth/login', { email, password: DEFAULT_PASSWORD })).status).toBe(200);
  });

  it('prevents admins from suspending or demoting themselves', async () => {
    expect((await admin.post(`/api/admin/users/${adminId}/status`, { status: 'SUSPENDED', reason: 'Testing self' })).status).toBe(400);
    expect((await admin.post(`/api/admin/users/${adminId}/role`, { role: 'USER' })).status).toBe(400);
  });

  it('credits and debits funds with a reason and unlocks accounts', async () => {
    const { user, email } = await registerClient();
    const credit = await admin.post(`/api/admin/users/${user.id}/funds-adjustment`, { direction: 'CREDIT', amount: 1500, reason: 'Goodwill credit' });
    expect(credit.status).toBe(201);
    expect(credit.body.entry).toMatchObject({ type: 'ADJUSTMENT', amount: 1500, balanceAfter: 1500 });
    expect((await admin.post(`/api/admin/users/${user.id}/funds-adjustment`, { direction: 'DEBIT', amount: 5000, reason: 'Recovery' })).status).toBe(422);

    const anon = new TestClient();
    for (let i = 0; i < 5; i++) await anon.post('/api/auth/login', { email, password: 'Wrong1234' });
    expect((await anon.post('/api/auth/login', { email, password: DEFAULT_PASSWORD })).status).toBe(423);
    await admin.post(`/api/admin/users/${user.id}/unlock`);
    expect((await anon.post('/api/auth/login', { email, password: DEFAULT_PASSWORD })).status).toBe(200);
  });
});

describe('securities management', () => {
  it('creates, edits, halts and reprices securities', async () => {
    const created = await admin.post('/api/admin/securities', {
      symbol: 'NEWCO',
      name: 'New Company Ltd',
      type: 'STOCK',
      sector: 'Services',
      industry: 'Consulting',
      price: 245.5,
      eps: 12.5,
    });
    expect(created.status).toBe(201);
    expect(created.body.security).toMatchObject({ symbol: 'NEWCO', lastPrice: 245.5 });
    expect((await admin.post('/api/admin/securities', { symbol: 'NEWCO', name: 'Dup', type: 'STOCK', price: 10 })).status).toBe(409);

    const edited = await admin.patch('/api/admin/securities/NEWCO', { description: 'Updated description', beta: 0.9 });
    expect(edited.status).toBe(200);

    const { client } = await registerWithPin();
    await client.post('/api/funds/deposit', { amount: 10_000, method: 'UPI' });
    const halted = await admin.post('/api/admin/securities/NEWCO/trading-status', { status: 'HALTED', reason: 'Pending announcement' });
    expect(halted.body.security.tradingStatus).toBe('HALTED');
    const rejected = await client.post('/api/orders', { symbol: 'NEWCO', side: 'BUY', orderType: 'MARKET', quantity: 1, pin: DEFAULT_PIN });
    expect(rejected.body.order).toMatchObject({ status: 'REJECTED', statusReason: 'Trading in NEWCO is halted' });
    await admin.post('/api/admin/securities/NEWCO/trading-status', { status: 'ACTIVE', reason: 'Announcement made' });

    const repriced = await admin.post('/api/admin/securities/NEWCO/price', { price: 250 });
    expect(repriced.body.security.lastPrice).toBe(250);
    const detail = await client.get('/api/securities/NEWCO');
    expect(detail.body.security.description).toBe('Updated description');
    expect(detail.body.metrics.pe).toBe(20);
  });
});

describe('IPO management', () => {
  it('creates an IPO, overrides subscription and withdraws it with refunds', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await admin.post('/api/admin/ipos', {
      companyName: 'Admin Test Ltd',
      symbol: 'ADMTEST',
      priceBandLow: 95,
      priceBandHigh: 100,
      lotSize: 150,
      maxLots: 13,
      issueSizeCr: 100,
      openDate: today,
      closeDate: today,
      allotmentDate: today,
      listingDate: today,
    });
    expect(created.status).toBe(201);
    expect(created.body.ipo).toMatchObject({ status: 'OPEN', priceBand: { low: 95, high: 100 } });
    const bad = await admin.post('/api/admin/ipos', { ...created.body.ipo, symbol: 'BADDATES', companyName: 'Bad', priceBandLow: 95, priceBandHigh: 100, lotSize: 1, maxLots: 1, issueSizeCr: 1, openDate: today, closeDate: '2020-01-01', allotmentDate: today, listingDate: today });
    expect(bad.status).toBe(400);

    const id = created.body.ipo.id;
    const sub = await admin.post(`/api/admin/ipos/${id}/subscription`, { retail: 3.5, nii: 2, qib: 10 });
    expect(sub.body.ipo.subscription.retail).toBe(3.5);

    const { client } = await registerWithPin();
    await client.post('/api/funds/deposit', { amount: 50_000, method: 'UPI' });
    await client.post(`/api/ipos/${id}/apply`, { lots: 1, cutoff: true, pin: DEFAULT_PIN });
    expect((await client.get('/api/funds')).body.blockedForIpos).toBe(15_000);

    const apps = await admin.get(`/api/admin/ipos/${id}`);
    expect(apps.body.applications).toHaveLength(1);
    expect((await admin.post(`/api/admin/ipos/${id}/allot`)).status).toBe(409);

    const withdrawn = await admin.post(`/api/admin/ipos/${id}/withdraw`, { reason: 'Market conditions' });
    expect(withdrawn.body.ipo.status).toBe('WITHDRAWN');
    expect((await client.get('/api/funds')).body.blockedForIpos).toBe(0);
    expect((await client.get('/api/ipos/applications')).body.applications[0].status).toBe('CANCELLED');
  });
});

describe('orders, transactions, audit and settings', () => {
  it('lets admins view and cancel any open order', async () => {
    const { client, user } = await registerWithPin();
    await client.post('/api/funds/deposit', { amount: 50_000, method: 'UPI' });
    const itc = getQuoteBySymbol('ITC')!;
    const placed = await client.post('/api/orders', { symbol: 'ITC', side: 'BUY', orderType: 'LIMIT', quantity: 10, limitPrice: Math.round((itc.last * 0.9) / itc.tickSize) * itc.tickSize / 100, pin: DEFAULT_PIN });
    const orders = await admin.get(`/api/admin/orders?userId=${user.id}&status=OPEN`);
    expect(orders.body.items).toHaveLength(1);
    const cancelled = await admin.post(`/api/admin/orders/${placed.body.order.id}/cancel`, { reason: 'Risk review' });
    expect(cancelled.body.order.statusReason).toBe('Cancelled by administrator: Risk review');
    const ledger = await admin.get(`/api/admin/ledger?userId=${user.id}`);
    expect(ledger.body.items[0]).toMatchObject({ type: 'DEPOSIT', amount: 50_000, userId: user.id });
    const fundTxns = await admin.get(`/api/admin/fund-transactions?userId=${user.id}`);
    expect(fundTxns.body.total).toBe(1);
  });

  it('filters the audit trail and verifies its integrity', async () => {
    const logs = await admin.get('/api/admin/audit-logs?action=ORDER_CANCELLED');
    expect(logs.body.items.length).toBeGreaterThan(0);
    expect(logs.body.items.every((l: { action: string }) => l.action === 'ORDER_CANCELLED')).toBe(true);
    expect((await admin.get('/api/admin/audit-logs/actions')).body.actions).toContain('USER_REGISTERED');
    expect((await admin.get('/api/admin/audit-logs/verify')).body).toMatchObject({ valid: true, brokenAtId: null });
  });

  it('updates settings with validation and broadcasts announcements', async () => {
    expect((await admin.put('/api/admin/settings/charges', { brokerageMax: -1 })).status).toBe(400);
    expect((await admin.put('/api/admin/settings/unknown', {})).status).toBe(400);
    const updated = await admin.put('/api/admin/settings/charges', { brokeragePct: 0, brokerageMax: 0 });
    expect(updated.body.value.brokeragePct).toBe(0);
    const { client } = await registerWithPin();
    await client.post('/api/funds/deposit', { amount: 10_000, method: 'UPI' });
    const preview = await client.post('/api/orders/preview', { symbol: 'ITC', side: 'BUY', orderType: 'MARKET', quantity: 1 });
    expect(preview.body.charges.brokerage).toBe(0);
    await admin.put('/api/admin/settings/charges', { brokeragePct: 0.1, brokerageMax: 20 });

    const sent = await admin.post('/api/admin/announcements', { title: 'Maintenance', message: 'Brief maintenance tonight at 11 PM.' });
    expect(sent.body.delivered).toBeGreaterThan(1);
    const notes = await client.get('/api/notifications?category=SYSTEM');
    expect(notes.body.items[0].title).toBe('Maintenance');
    expect((await admin.post('/api/admin/announcements', { title: 'Bad link', message: 'Click here', link: 'https://evil.example' })).status).toBe(400);
  });
});
