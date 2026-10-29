import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { freezeTime, nowMs, resetTime } from '../src/lib/clock.js';
import { currentTradingDate } from '../src/market/engine.js';
import { getQuoteBySymbol } from '../src/market/quoteStore.js';
import { claimLease } from '../src/services/settings.service.js';
import { DEFAULT_PIN, getApp, registerClient, registerWithPin } from './helpers.js';
import { setupMarket } from './setup-market.js';

beforeAll(async () => {
  await setupMarket();
});

afterEach(() => {
  resetTime();
});

describe('live polling', () => {
  it('requires a session', async () => {
    const res = await request(getApp()).get('/api/live');
    expect(res.status).toBe(401);
  });

  it('returns every price and the current cursors on the first poll', async () => {
    const { client } = await registerClient();
    const res = await client.get('/api/live');
    expect(res.status).toBe(200);
    expect(res.body.tradingDate).toBe(currentTradingDate());
    const reliance = (res.body.quotes as unknown[][]).find((tuple) => tuple[0] === 'RELIANCE');
    expect(reliance?.[1]).toBe(getQuoteBySymbol('RELIANCE')!.last / 100);
    // Registration sends a welcome notification; the first poll only reports the cursor.
    expect(res.body.notifications).toEqual([]);
    expect(res.body.latestNotificationId).toBeGreaterThan(0);
    expect(res.body.events).toEqual({});
  });

  it('delivers new notifications and changes once, after the cursors', async () => {
    const { client } = await registerWithPin();
    const first = await client.get('/api/live');
    const { latestNotificationId, eventVersion } = first.body as { latestNotificationId: number; eventVersion: number };

    expect((await client.post('/api/funds/deposit', { amount: 50_000, method: 'UPI' })).status).toBe(201);
    const order = await client.post('/api/orders', { symbol: 'INFY', side: 'BUY', orderType: 'MARKET', quantity: 1, pin: DEFAULT_PIN });
    expect(order.status).toBe(201);

    const next = await client.get(`/api/live?notificationsAfter=${latestNotificationId}&eventsAfter=${eventVersion}`);
    expect(next.body.notifications.length).toBeGreaterThan(0);
    expect(next.body.notifications.every((n: { id: number }) => n.id > latestNotificationId)).toBe(true);
    expect(next.body.latestNotificationId).toBe(next.body.notifications.at(-1).id);
    expect(Object.keys(next.body.events)).toEqual(expect.arrayContaining(['order', 'funds']));
    expect(next.body.eventVersion).toBeGreaterThan(eventVersion);

    const after = await client.get(`/api/live?notificationsAfter=${next.body.latestNotificationId}&eventsAfter=${next.body.eventVersion}`);
    expect(after.body.notifications).toEqual([]);
    expect(after.body.events).toEqual({});
  });

  it('only shows a user their own notifications and changes', async () => {
    const watcher = await registerClient();
    const cursor = (await watcher.client.get('/api/live')).body;
    const other = await registerClient();
    expect((await other.client.post('/api/funds/deposit', { amount: 10_000, method: 'UPI' })).status).toBe(201);
    const res = await watcher.client.get(`/api/live?notificationsAfter=${cursor.latestNotificationId}&eventsAfter=${cursor.eventVersion}`);
    expect(res.body.notifications).toEqual([]);
    expect(res.body.events).toEqual({});
  });
});

describe('background work leases', () => {
  it('lets one caller per interval run a job', async () => {
    freezeTime(Date.parse('2026-03-02T05:00:00Z'));
    expect(await claimLease('test-job', 10_000)).toBe(true);
    expect(await claimLease('test-job', 10_000)).toBe(false);
    freezeTime(nowMs() + 9_999);
    expect(await claimLease('test-job', 10_000)).toBe(false);
    freezeTime(nowMs() + 1);
    expect(await claimLease('test-job', 10_000)).toBe(true);
    // A clock that moved backwards does not lock the job out.
    freezeTime(nowMs() - 60_000);
    expect(await claimLease('test-job', 10_000)).toBe(true);
  });

  it('gives concurrent callers a single lease', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => claimLease('race', 60_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('daily cron', () => {
  it('is disabled without a secret and rejects a wrong one', async () => {
    const app = request(getApp());
    expect((await app.get('/api/cron/daily')).status).toBe(404);
    const settable = config as { cronSecret: string | null };
    settable.cronSecret = 's3cret-value';
    try {
      expect((await app.get('/api/cron/daily').set('Authorization', 'Bearer nope')).status).toBe(401);
    } finally {
      settable.cronSecret = null;
    }
  });
});
