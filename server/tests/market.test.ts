import { beforeAll, describe, expect, it } from 'vitest';
import { all, get } from '../src/db/index.js';
import { currentTradingDate, initMarket, rollover, setPrice, tick } from '../src/market/engine.js';
import { allQuotes, circuitLimits, getQuoteBySymbol } from '../src/market/quoteStore.js';
import { seedMarket } from '../src/market/seedMarket.js';
import { addDays } from '../src/lib/time.js';
import { registerClient, type TestClient } from './helpers.js';

let client: TestClient;

beforeAll(async () => {
  seedMarket({ years: 1 });
  initMarket();
  ({ client } = await registerClient());
});

describe('market data API', () => {
  it('requires authentication', async () => {
    const { TestClient: Anonymous } = await import('./helpers.js');
    expect((await new Anonymous().get('/api/market/overview')).status).toBe(401);
  });

  it('returns a market overview with indices, breadth, movers and sectors', async () => {
    const res = await client.get('/api/market/overview');
    expect(res.status).toBe(200);
    const symbols = res.body.indices.map((i: { symbol: string }) => i.symbol);
    expect(symbols).toEqual(expect.arrayContaining(['NIFTY50', 'SENSEX', 'NIFTYBANK']));
    expect(res.body.indices[0].sparkline.length).toBeGreaterThan(0);
    const { advances, declines, unchanged, total } = res.body.breadth;
    expect(advances + declines + unchanged).toBe(total);
    for (let i = 1; i < res.body.gainers.length; i++) {
      expect(res.body.gainers[i - 1].changePercent).toBeGreaterThanOrEqual(res.body.gainers[i].changePercent);
    }
    expect(res.body.sectors.length).toBeGreaterThan(5);
  });

  it('searches by symbol and name', async () => {
    const bySymbol = await client.get('/api/securities/search?q=rel');
    expect(bySymbol.body.items[0].symbol).toBe('RELIANCE');
    const byName = await client.get('/api/securities/search?q=bank&type=ETF');
    expect(byName.body.items.map((i: { symbol: string }) => i.symbol)).toContain('BANKBEES');
    const filtered = await client.get('/api/securities?type=REIT');
    expect(filtered.body.total).toBe(4);
  });

  it('returns security details with derived metrics', async () => {
    const res = await client.get('/api/securities/RELIANCE');
    expect(res.status).toBe(200);
    expect(res.body.security.name).toBe('Reliance Industries Ltd');
    expect(res.body.metrics.pe).toBeGreaterThan(10);
    expect(res.body.metrics.marketCapCr).toBeGreaterThan(1_000_000);
    expect(res.body.metrics.week52High).toBeGreaterThanOrEqual(res.body.metrics.week52Low);
    expect(res.body.financials).toHaveLength(5);
    expect(res.body.memberOf.map((m: { symbol: string }) => m.symbol)).toContain('NIFTY50');
    const special = await client.get(`/api/securities/${encodeURIComponent('M&M')}`);
    expect(special.status).toBe(200);
    expect((await client.get('/api/securities/NOPE')).status).toBe(404);
  });

  it('returns chart history for each range', async () => {
    for (const range of ['1D', '1W', '1M', '1Y']) {
      const res = await client.get(`/api/securities/TCS/history?range=${range}`);
      expect(res.status).toBe(200);
      expect(res.body.candles.length).toBeGreaterThan(0);
      const last = res.body.candles[res.body.candles.length - 1];
      expect(last.high).toBeGreaterThanOrEqual(last.low);
    }
    const constituents = await client.get('/api/securities/NIFTYBANK/constituents');
    expect(constituents.body.items).toHaveLength(6);
  });
});

describe('price simulation', () => {
  it('moves prices within circuit limits and keeps indices consistent', () => {
    const before = getQuoteBySymbol('NIFTY50')!.last;
    for (let i = 0; i < 50; i++) tick();
    for (const q of allQuotes()) {
      if (q.type === 'INDEX') continue;
      const { lower, upper } = circuitLimits(q);
      expect(q.last).toBeGreaterThanOrEqual(lower);
      expect(q.last).toBeLessThanOrEqual(upper);
      expect(q.last % q.tickSize).toBe(0);
    }
    expect(getQuoteBySymbol('NIFTY50')!.last).not.toBe(before);
  });

  it('lets index-tracking ETFs follow their index', () => {
    const bankBefore = getQuoteBySymbol('NIFTYBANK')!.last;
    const ratio = getQuoteBySymbol('BANKBEES')!.last / bankBefore;
    const hdfc = getQuoteBySymbol('HDFCBANK')!;
    setPrice(hdfc.securityId, Math.round(hdfc.last * 1.05));
    expect(getQuoteBySymbol('NIFTYBANK')!.last).toBeGreaterThan(bankBefore);
    expect(Math.abs(getQuoteBySymbol('BANKBEES')!.last / getQuoteBySymbol('NIFTYBANK')!.last - ratio) / ratio).toBeLessThan(0.01);
  });

  it('rolls the trading day over into daily history', () => {
    const date = currentTradingDate();
    const tcs = getQuoteBySymbol('TCS')!;
    const lastPrice = tcs.last;
    rollover(addDays(date, 1));
    const row = get<{ close: number }>('SELECT close FROM price_history WHERE security_id = ? AND date = ?', tcs.securityId, date);
    expect(row?.close).toBe(lastPrice);
    expect(getQuoteBySymbol('TCS')!.prevClose).toBe(lastPrice);
    expect(getQuoteBySymbol('TCS')!.volume).toBe(0);
    expect(currentTradingDate()).toBe(addDays(date, 1));
    expect(all('SELECT * FROM quotes WHERE trading_date != ?', addDays(date, 1))).toHaveLength(0);
  });
});
