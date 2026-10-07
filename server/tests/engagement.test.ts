import { beforeAll, describe, expect, it } from 'vitest';
import { setPrice } from '../src/market/engine.js';
import { getQuoteBySymbol } from '../src/market/quoteStore.js';
import { registerClient } from './helpers.js';
import { setupMarket } from './setup-market.js';

beforeAll(() => setupMarket());

describe('watchlists', () => {
  it('starts with a default watchlist and manages items', async () => {
    const { client } = await registerClient();
    const initial = await client.get('/api/watchlists');
    expect(initial.body.watchlists).toHaveLength(1);
    const id = initial.body.watchlists[0].id;

    const added = await client.post(`/api/watchlists/${id}/items`, { symbol: 'tcs' });
    expect(added.status).toBe(201);
    expect(added.body.watchlist.items[0]).toMatchObject({ symbol: 'TCS' });
    expect((await client.post(`/api/watchlists/${id}/items`, { symbol: 'TCS' })).status).toBe(409);
    expect((await client.post(`/api/watchlists/${id}/items`, { symbol: 'NOPE' })).status).toBe(404);

    const detail = await client.get('/api/securities/TCS');
    expect(detail.body.watchlists).toEqual([{ id, name: 'My Watchlist' }]);

    const removed = await client.delete(`/api/watchlists/${id}/items/TCS`);
    expect(removed.body.watchlist.items).toHaveLength(0);
  });

  it('creates, renames and deletes watchlists but keeps at least one', async () => {
    const { client } = await registerClient();
    const created = await client.post('/api/watchlists', { name: 'Banks' });
    expect(created.status).toBe(201);
    expect((await client.post('/api/watchlists', { name: 'Banks' })).status).toBe(409);
    const renamed = await client.patch(`/api/watchlists/${created.body.watchlist.id}`, { name: 'PSU Banks' });
    expect(renamed.body.watchlist.name).toBe('PSU Banks');
    expect((await client.delete(`/api/watchlists/${created.body.watchlist.id}`)).status).toBe(200);
    const [only] = (await client.get('/api/watchlists')).body.watchlists;
    expect((await client.delete(`/api/watchlists/${only.id}`)).status).toBe(409);
  });

  it('does not expose other users’ watchlists', async () => {
    const { client: owner } = await registerClient();
    const { client: other } = await registerClient();
    const [list] = (await owner.get('/api/watchlists')).body.watchlists;
    expect((await other.post(`/api/watchlists/${list.id}/items`, { symbol: 'TCS' })).status).toBe(404);
  });
});

describe('price alerts', () => {
  it('validates the target side and triggers once with a notification', async () => {
    const { client } = await registerClient();
    const titan = getQuoteBySymbol('TITAN')!;
    const below = await client.post('/api/alerts', { symbol: 'TITAN', condition: 'ABOVE', targetPrice: titan.last / 100 - 10 });
    expect(below.status).toBe(400);

    const target = Math.round(titan.last * 1.02) / 100;
    const created = await client.post('/api/alerts', { symbol: 'TITAN', condition: 'ABOVE', targetPrice: target, note: 'Breakout' });
    expect(created.status).toBe(201);
    expect(created.body.alert).toMatchObject({ status: 'ACTIVE', condition: 'ABOVE', targetPrice: target });

    setPrice(titan.securityId, Math.round(target * 100) + 500);
    const alerts = (await client.get('/api/alerts')).body.alerts;
    expect(alerts[0].status).toBe('TRIGGERED');
    expect(alerts[0].triggeredPrice).toBeGreaterThanOrEqual(target);

    const notifications = await client.get('/api/notifications?category=PRICE_ALERT');
    expect(notifications.body.items).toHaveLength(1);
    expect(notifications.body.items[0].message).toMatch(/TITAN has risen above/);

    // Re-arming requires a target on the correct side of the new price.
    const rearm = await client.patch(`/api/alerts/${created.body.alert.id}`, { status: 'ACTIVE', targetPrice: (getQuoteBySymbol('TITAN')!.last + 1000) / 100 });
    expect(rearm.body.alert.status).toBe('ACTIVE');
    const disabled = await client.patch(`/api/alerts/${created.body.alert.id}`, { status: 'DISABLED' });
    expect(disabled.body.alert.status).toBe('DISABLED');
    expect((await client.delete(`/api/alerts/${created.body.alert.id}`)).status).toBe(200);
    expect((await client.get('/api/alerts')).body.alerts).toHaveLength(0);
  });
});

describe('notifications', () => {
  it('lists, counts and marks notifications as read, honouring preferences', async () => {
    const { client } = await registerClient();
    expect((await client.get('/api/notifications/unread-count')).body.count).toBe(1); // welcome message

    await client.put('/api/profile/notification-preferences', { FUNDS: false });
    await client.post('/api/funds/deposit', { amount: 1000, method: 'UPI' });
    expect((await client.get('/api/notifications?category=FUNDS')).body.items).toHaveLength(0);

    await client.put('/api/profile/notification-preferences', { FUNDS: true });
    await client.post('/api/funds/deposit', { amount: 1000, method: 'UPI' });
    const list = await client.get('/api/notifications');
    expect(list.body.unreadCount).toBe(2);
    await client.post(`/api/notifications/${list.body.items[0].id}/read`);
    expect((await client.get('/api/notifications/unread-count')).body.count).toBe(1);
    await client.post('/api/notifications/read-all');
    expect((await client.get('/api/notifications/unread-count')).body.count).toBe(0);
  });
});
