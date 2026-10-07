import { beforeAll, describe, expect, it } from 'vitest';
import { all, get } from '../src/db/index.js';
import { verifyAuditChain } from '../src/services/audit.service.js';
import { DEMO_ACCOUNTS, seedDemoData } from '../src/seed/demo.js';
import { TestClient } from './helpers.js';
import { setupMarket } from './setup-market.js';

beforeAll(async () => {
  setupMarket({ ipos: true });
  await seedDemoData();
});

describe('demo data', () => {
  it('creates a consistent demo investor that can sign in', async () => {
    const client = new TestClient();
    const login = await client.post('/api/auth/login', { email: DEMO_ACCOUNTS.investor.email, password: DEMO_ACCOUNTS.investor.password });
    expect(login.status).toBe(200);
    const portfolio = (await client.get('/api/portfolio')).body;
    expect(portfolio.summary.holdingsCount).toBeGreaterThan(10);
    const orders = (await client.get('/api/orders?pageSize=100')).body.items;
    expect(orders.filter((o: { status: string }) => o.status === 'REJECTED')).toHaveLength(0);
    expect(orders.filter((o: { status: string }) => o.status === 'OPEN')).toHaveLength(2);
    const applications = (await client.get('/api/ipos/applications')).body.applications.map((a: { status: string }) => a.status).sort();
    expect(applications).toEqual(['ALLOTTED', 'ALLOTTED', 'APPLIED', 'NOT_ALLOTTED']);
    expect((await client.get('/api/watchlists')).body.watchlists).toHaveLength(3);
  });

  it('seeds only orders that were accepted', () => {
    const rejected = all<{ user_id: number; status_reason: string }>("SELECT user_id, status_reason FROM orders WHERE status = 'REJECTED'");
    expect(rejected).toEqual([]);
  });

  it('keeps every ledger balance consistent with the account balance', () => {
    for (const { user_id, cash_balance } of all<{ user_id: number; cash_balance: number }>('SELECT * FROM accounts')) {
      const last = get<{ balance_after: number }>('SELECT balance_after FROM ledger_entries WHERE user_id = ? ORDER BY id DESC LIMIT 1', user_id);
      const total = get<{ total: number | null }>('SELECT SUM(amount) AS total FROM ledger_entries WHERE user_id = ?', user_id)!.total ?? 0;
      expect(last?.balance_after ?? 0).toBe(cash_balance);
      expect(total).toBe(cash_balance);
    }
  });

  it('records history in chronological order', () => {
    for (const table of ['ledger_entries', 'audit_logs', 'notifications', 'orders']) {
      const rows = all<{ created_at: string }>(`SELECT created_at FROM ${table} ORDER BY id`);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]!.created_at >= rows[i - 1]!.created_at, `${table} row ${i} goes back in time`).toBe(true);
      }
    }
  });

  it('leaves a valid audit chain and a working admin account', async () => {
    expect(verifyAuditChain().valid).toBe(true);
    const admin = new TestClient();
    await admin.post('/api/auth/login', { email: DEMO_ACCOUNTS.admin.email, password: DEMO_ACCOUNTS.admin.password });
    expect((await admin.get('/api/admin/overview')).body.users.suspended).toBe(1);
  });
});
