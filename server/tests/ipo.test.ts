import { beforeAll, describe, expect, it } from 'vitest';
import { all, get } from '../src/db/index.js';
import { addDays, istDate } from '../src/lib/time.js';
import { SYSTEM_ACTOR } from '../src/services/actor.js';
import { allotIpo, createIpo, listIpo, processIpoLifecycle, updateIpo } from '../src/services/ipo.service.js';
import { DEFAULT_PIN, registerWithPin } from './helpers.js';
import { setupMarket } from './setup-market.js';

beforeAll(() => setupMarket({ ipos: true }));

const today = () => istDate();

async function fundedInvestor(amount = 300_000) {
  const result = await registerWithPin();
  await result.client.post('/api/funds/deposit', { amount, method: 'UPI' });
  return result;
}

function newOpenIpo(symbol: string, overrides: Partial<Parameters<typeof createIpo>[0]> = {}) {
  return createIpo(
    {
      companyName: `${symbol} Ltd`,
      symbol,
      issueType: 'MAINBOARD',
      sector: 'Services',
      industry: 'Testing',
      priceBandLow: 9500,
      priceBandHigh: 10000,
      lotSize: 150,
      minLots: 1,
      maxLots: 13,
      issueSizeCr: 300,
      freshIssueCr: 300,
      ofsCr: 0,
      openDate: addDays(today(), -1),
      closeDate: addDays(today(), 1),
      allotmentDate: addDays(today(), 2),
      listingDate: addDays(today(), 4),
      demand: { retail: 0.8, nii: 1.2, qib: 2 },
      financials: [{ year: 'FY26', revenueCr: 500, profitCr: 40, assetsCr: 600 }],
      ...overrides,
    },
    SYSTEM_ACTOR,
  );
}

/** Moves an IPO's window into the past so it is closed and ready for allotment. */
function closeIpo(id: number) {
  updateIpo(id, { openDate: addDays(today(), -5), closeDate: addDays(today(), -1), allotmentDate: today(), listingDate: addDays(today(), 1) }, SYSTEM_ACTOR);
}

describe('IPO catalogue', () => {
  it('seeds upcoming, open and completed issues with details', async () => {
    const { client } = await registerWithPin();
    const upcoming = (await client.get('/api/ipos?status=upcoming')).body.ipos;
    const open = (await client.get('/api/ipos?status=open')).body.ipos;
    const closed = (await client.get('/api/ipos?status=closed')).body.ipos;
    expect(upcoming.map((i: { symbol: string }) => i.symbol)).toEqual(['ZENITHRE', 'AARAVFIN']);
    expect(open.map((i: { symbol: string }) => i.symbol).sort()).toEqual(['NIMBUS', 'SAFFRON']);
    const statuses = Object.fromEntries(closed.map((i: { symbol: string; status: string }) => [i.symbol, i.status]));
    expect(statuses).toMatchObject({ KAVERIAGRO: 'CLOSED', ORBITAERO: 'CLOSED', VISTAARLOG: 'LISTED', QUANTUMMED: 'LISTED' });

    const listed = closed.find((i: { symbol: string }) => i.symbol === 'VISTAARLOG');
    expect(listed.issuePrice).toBe(332);
    expect(listed.listingPrice).toBeGreaterThan(0);
    expect(listed.currentPrice).toBeGreaterThan(0);
    expect(listed.subscription.total).toBeGreaterThan(listed.subscription.retail);
    const detail = await client.get(`/api/ipos/${open[0].id}`);
    expect(detail.body.ipo.financials).toHaveLength(3);
    expect(detail.body.ipo.minInvestment).toBe(detail.body.ipo.lotSize * detail.body.ipo.priceBand.high);
    // A listed IPO is a normal tradable security with history since listing.
    const security = await client.get('/api/securities/VISTAARLOG/history?range=1M');
    expect(security.body.candles.length).toBeGreaterThan(5);
  });
});

describe('IPO applications', () => {
  it('blocks funds, prevents duplicates and allows cancellation while open', async () => {
    const { client } = await fundedInvestor();
    const ipo = (await client.get('/api/ipos?status=open')).body.ipos.find((i: { symbol: string }) => i.symbol === 'SAFFRON');

    expect((await client.post(`/api/ipos/${ipo.id}/apply`, { lots: 20, cutoff: true, pin: DEFAULT_PIN })).status).toBe(400);
    expect((await client.post(`/api/ipos/${ipo.id}/apply`, { lots: 1, bidPrice: 200, pin: DEFAULT_PIN })).status).toBe(400);
    expect((await client.post(`/api/ipos/${ipo.id}/apply`, { lots: 1, bidPrice: 185.5, pin: DEFAULT_PIN })).status).toBe(400);
    expect((await client.post(`/api/ipos/${ipo.id}/apply`, { lots: 2, cutoff: true, pin: '1111' })).status).toBe(403);

    const applied = await client.post(`/api/ipos/${ipo.id}/apply`, { lots: 2, cutoff: true, pin: DEFAULT_PIN });
    expect(applied.status).toBe(201);
    expect(applied.body.application).toMatchObject({ status: 'APPLIED', quantity: 156, bidPrice: 190, isCutoff: true, amount: 29_640 });
    expect((await client.get('/api/funds')).body.blockedForIpos).toBe(29_640);
    expect((await client.post(`/api/ipos/${ipo.id}/apply`, { lots: 1, cutoff: true, pin: DEFAULT_PIN })).status).toBe(409);

    const mine = await client.get('/api/ipos/applications');
    expect(mine.body.applications).toHaveLength(1);
    const cancelled = await client.post(`/api/ipos/applications/${applied.body.application.id}/cancel`);
    expect(cancelled.body.application.status).toBe('CANCELLED');
    expect((await client.get('/api/funds')).body.blockedForIpos).toBe(0);
  });

  it('rejects applications without enough available funds', async () => {
    const { client } = await fundedInvestor(5_000);
    const ipo = (await client.get('/api/ipos?status=open')).body.ipos[0];
    const res = await client.post(`/api/ipos/${ipo.id}/apply`, { lots: 1, cutoff: true, pin: DEFAULT_PIN });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('IPO allotment and listing', () => {
  it('allots in full when undersubscribed, debits funds and credits shares on listing', async () => {
    const { client, user } = await fundedInvestor();
    const ipo = newOpenIpo('ALLOTFULL');
    const applied = await client.post(`/api/ipos/${ipo.id}/apply`, { lots: 2, cutoff: true, pin: DEFAULT_PIN });
    expect(applied.status).toBe(201);
    closeIpo(ipo.id);

    const result = allotIpo(ipo.id, SYSTEM_ACTOR, () => 0.99);
    expect(result).toEqual({ applications: 1, allotted: 1 });
    const app = (await client.get('/api/ipos/applications')).body.applications[0];
    expect(app).toMatchObject({ status: 'ALLOTTED', allottedQuantity: 300, allotmentPrice: 100, amountDebited: 30_000, amountRefunded: 0 });
    const funds = (await client.get('/api/funds')).body;
    expect(funds).toMatchObject({ cashBalance: 270_000, blockedForIpos: 0 });
    expect(get<{ entry_type: string }>("SELECT entry_type FROM ledger_entries WHERE user_id = ? ORDER BY id DESC LIMIT 1", user.id)!.entry_type).toBe('IPO_ALLOTMENT');

    const listing = listIpo(ipo.id, SYSTEM_ACTOR);
    expect(listing.credited).toBe(1);
    const holdings = (await client.get('/api/portfolio')).body.holdings;
    expect(holdings).toEqual([expect.objectContaining({ symbol: 'ALLOTFULL', quantity: 300, averagePrice: 100 })]);
    const trades = (await client.get('/api/trades')).body.items;
    expect(trades[0]).toMatchObject({ source: 'IPO', side: 'BUY', quantity: 300, price: 100 });
    const quote = await client.get('/api/securities/ALLOTFULL');
    expect(quote.body.quote.prevClose).toBe(100);
    expect(quote.body.position.quantity).toBe(300);
    const status = (await client.get(`/api/ipos/${ipo.id}`)).body.ipo;
    expect(status.status).toBe('LISTED');
  });

  it('runs a lottery when oversubscribed and rejects bids below the issue price', async () => {
    const lucky = await fundedInvestor();
    const unlucky = await fundedInvestor();
    const lowBidder = await fundedInvestor();
    const ipo = newOpenIpo('LOTTERY', { demand: { retail: 10, nii: 20, qib: 40 } });
    await lucky.client.post(`/api/ipos/${ipo.id}/apply`, { lots: 3, cutoff: true, pin: DEFAULT_PIN });
    await unlucky.client.post(`/api/ipos/${ipo.id}/apply`, { lots: 1, cutoff: true, pin: DEFAULT_PIN });
    await lowBidder.client.post(`/api/ipos/${ipo.id}/apply`, { lots: 1, bidPrice: 96, pin: DEFAULT_PIN });
    closeIpo(ipo.id);
    // Retail subscribed 10x: a draw below 0.1 wins one lot.
    const draws = [0.05, 0.5];
    const result = allotIpo(ipo.id, SYSTEM_ACTOR, () => draws.shift() ?? 0.9);
    expect(result.allotted).toBe(1);
    const apps = all<{ user_id: number; status: string; allotted_quantity: number; status_reason: string | null }>(
      'SELECT user_id, status, allotted_quantity, status_reason FROM ipo_applications WHERE ipo_id = ? ORDER BY id',
      ipo.id,
    );
    expect(apps[0]).toMatchObject({ user_id: lucky.user.id, status: 'ALLOTTED', allotted_quantity: 150 });
    expect(apps[1]).toMatchObject({ user_id: unlucky.user.id, status: 'NOT_ALLOTTED' });
    expect(apps[2]).toMatchObject({ user_id: lowBidder.user.id, status: 'NOT_ALLOTTED', status_reason: 'Bid price below the final issue price' });
    expect((await lucky.client.get('/api/funds')).body.cashBalance).toBe(300_000 - 15_000);
    expect((await unlucky.client.get('/api/funds')).body.cashBalance).toBe(300_000);
  });

  it('allots and lists automatically when the scheduled dates arrive', () => {
    processIpoLifecycle();
    const orbit = get<{ allotted_at: string | null; listed_at: string | null }>("SELECT allotted_at, listed_at FROM ipos WHERE symbol = 'ORBITAERO'")!;
    expect(orbit.allotted_at).not.toBeNull();
    expect(orbit.listed_at).toBeNull();
    const kaveri = get<{ allotted_at: string | null }>("SELECT allotted_at FROM ipos WHERE symbol = 'KAVERIAGRO'")!;
    expect(kaveri.allotted_at).toBeNull();
  });
});
