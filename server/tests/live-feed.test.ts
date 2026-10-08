import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { all, get } from '../src/db/index.js';
import { freezeTime, resetTime } from '../src/lib/clock.js';
import { addDays, istDayStart } from '../src/lib/time.js';
import { currentTradingDate } from '../src/market/engine.js';
import { refreshLiveQuotes, startLiveFeed, stopLiveFeed } from '../src/market/liveFeed.js';
import { allQuotes, getQuoteBySymbol } from '../src/market/quoteStore.js';
import { isMarketOpen, marketSession } from '../src/market/session.js';
import {
  YahooFinance,
  yahooTicker,
  type YahooAnnualFigure,
  type YahooCandle,
  type YahooProfile,
  type YahooQuote,
} from '../src/market/yahoo.js';
import { SYSTEM_ACTOR } from '../src/services/actor.js';
import { setSecurityPrice } from '../src/services/admin.service.js';
import { DEFAULT_PIN, registerWithPin } from './helpers.js';
import { setupMarket } from './setup-market.js';

const MINUTE = 60_000;
const sessionTime = (date: string, hour: number, minute = 0) => istDayStart(date) + (hour * 60 + minute) * MINUTE;

/** Stands in for Yahoo Finance: every ticker trades at a price the test controls. */
class FakeYahoo extends YahooFinance {
  marketState = 'POSTPOST';
  /** Exchange time of the latest quote (ms). */
  time = 0;
  readonly prices = new Map<string, number>();
  readonly prevCloses = new Map<string, number>();
  readonly volumes = new Map<string, number>();

  constructor() {
    super(() => Promise.reject(new Error('FakeYahoo makes no network requests')));
    for (const q of allQuotes()) {
      const rupees = Math.max(1, Math.round(q.last / 5) * 5) / 100;
      this.prices.set(yahooTicker(q.symbol), rupees);
      this.prevCloses.set(yahooTicker(q.symbol), rupees);
    }
  }

  override async quotes(tickers: string[]): Promise<YahooQuote[]> {
    return tickers.map((symbol) => {
      const price = this.prices.get(symbol) ?? 100;
      return {
        symbol,
        marketState: this.marketState,
        regularMarketPrice: price,
        regularMarketPreviousClose: this.prevCloses.get(symbol) ?? price,
        regularMarketOpen: price,
        regularMarketDayHigh: price,
        regularMarketDayLow: price,
        regularMarketVolume: this.volumes.get(symbol) ?? 1000,
        regularMarketTime: Math.floor(this.time / 1000),
        exchangeDataDelayedBy: 15,
        epsTrailingTwelveMonths: 50,
        bookValue: 400,
        sharesOutstanding: 1_000_000_000,
      };
    });
  }

  /** Thirty sessions of flat daily candles up to and including the current session, or a few 5-minute bars. */
  override async chart(ticker: string, _range: string, interval: string): Promise<YahooCandle[]> {
    const price = this.prices.get(ticker) ?? 100;
    const today = currentTradingDate();
    const candle = (time: number) => ({ time: Math.floor(time / 1000), open: price, high: price * 1.01, low: price * 0.99, close: price, volume: 5000 });
    if (interval === '1d') return Array.from({ length: 31 }, (_, i) => candle(sessionTime(addDays(today, i - 30), 9, 15)));
    return Array.from({ length: 6 }, (_, i) => candle(sessionTime(today, 9, 15 + i * 5)));
  }

  override async profile(): Promise<YahooProfile> {
    return { description: 'Reported business summary.', city: 'Mumbai', beta: 0.8, returnOnEquity: 0.125, debtToEquity: 35, totalRevenue: 2e12, netIncome: 2e11 };
  }

  override async annualFinancials(): Promise<YahooAnnualFigure[]> {
    return [
      { periodEnd: '2025-03-31', revenue: 1.8e12, netIncome: 1.7e11 },
      { periodEnd: '2026-03-31', revenue: 2e12, netIncome: 2e11 },
    ];
  }
}

let yahoo: FakeYahoo;
let today: string;

beforeAll(async () => {
  setupMarket({ ipos: true });
  today = currentTradingDate();
  yahoo = new FakeYahoo();
  yahoo.time = sessionTime(today, 15, 30);
  yahoo.prices.set('RELIANCE.NS', 1178);
  yahoo.prevCloses.set('RELIANCE.NS', 1207.7);
  await startLiveFeed(yahoo);
});

afterAll(async () => {
  await stopLiveFeed();
  resetTime();
});

async function fundedInvestor(amount = 500_000) {
  const { client, user } = await registerWithPin();
  expect((await client.post('/api/funds/deposit', { amount, method: 'UPI' })).status).toBe(201);
  return { client, user };
}

const orderStatus = (id: number) => get<{ status: string }>('SELECT status FROM orders WHERE id = ?', id)!.status;

describe('live market data', () => {
  it('prices catalogue securities from the feed and replaces simulated history', async () => {
    expect(marketSession()).toMatchObject({ source: 'yahoo', phase: 'CLOSED', delayMinutes: 15 });
    const reliance = getQuoteBySymbol('RELIANCE')!;
    expect(reliance).toMatchObject({ last: 117_800, prevClose: 120_770, tradingDate: today });

    const history = all<{ date: string; close: number }>('SELECT date, close FROM price_history WHERE security_id = ? ORDER BY date', reliance.securityId);
    expect(history).toHaveLength(30);
    expect(history.every((row) => row.close === 117_800 && row.date < today)).toBe(true);

    const { client } = await registerWithPin();
    const status = await client.get('/api/market/status');
    expect(status.body).toMatchObject({ status: 'CLOSED', simulated: false, source: 'Yahoo Finance', delayMinutes: 15 });
    const detail = await client.get('/api/securities/RELIANCE');
    expect(detail.body).toMatchObject({ priceSource: 'live', quote: { lastPrice: 1178, prevClose: 1207.7 }, metrics: { eps: 50, pe: 23.56 } });

    // Companies listed through the IPO simulation are not on the exchange and keep simulated prices.
    const simulated = get<{ symbol: string }>("SELECT symbol FROM securities WHERE symbol = 'ORBITAERO' OR listing_date >= ? LIMIT 1", addDays(today, -400));
    if (simulated) expect((await client.get(`/api/securities/${simulated.symbol}`)).body.priceSource).toBe('simulated');

    expect(() => setSecurityPrice('RELIANCE', 1500, SYSTEM_ACTOR)).toThrow(/live market feed/);
  });

  it('loads reported financials in the background', async () => {
    const reliance = getQuoteBySymbol('RELIANCE')!;
    await vi.waitFor(() => expect(get('SELECT 1 FROM financials WHERE security_id = ?', reliance.securityId)).toBeTruthy(), { timeout: 10_000 });
    const { client } = await registerWithPin();
    const detail = await client.get('/api/securities/RELIANCE');
    expect(detail.body.financialsSource).toBe('reported');
    expect(detail.body.financials).toEqual([
      { year: 'FY25', revenueCr: 180_000, netProfitCr: 17_000, netMarginPct: 9.4 },
      { year: 'FY26', revenueCr: 200_000, netProfitCr: 20_000, netMarginPct: 10 },
    ]);
    expect(detail.body.metrics).toMatchObject({ roe: 12.5, debtToEquity: 0.35, revenueCr: 200_000 });
  });

  it('refuses market and IOC orders while the market is closed and holds limit orders for the next session', async () => {
    freezeTime(sessionTime(today, 18));
    const { client } = await fundedInvestor();
    const infy = getQuoteBySymbol('INFY')!.last / 100;

    const market = await client.post('/api/orders', { symbol: 'INFY', side: 'BUY', orderType: 'MARKET', quantity: 1, pin: DEFAULT_PIN });
    expect(market.status).toBe(422);
    expect(market.body.error.code).toBe('MARKET_CLOSED');
    const ioc = await client.post('/api/orders', { symbol: 'INFY', side: 'BUY', orderType: 'LIMIT', limitPrice: infy, validity: 'IOC', quantity: 1, pin: DEFAULT_PIN });
    expect(ioc.status).toBe(422);

    const preview = await client.post('/api/orders/preview', { symbol: 'INFY', side: 'BUY', orderType: 'MARKET', quantity: 1 });
    expect(preview.body).toMatchObject({ canPlace: false, marketable: false });

    // Priced above the last trade, so it would fill at once in an open market; after hours it waits.
    const amo = await client.post('/api/orders', { symbol: 'INFY', side: 'BUY', orderType: 'LIMIT', limitPrice: Math.round(infy * 1.02 * 20) / 20, validity: 'DAY', quantity: 2, pin: DEFAULT_PIN });
    expect(amo.status).toBe(201);
    expect(amo.body.order.status).toBe('OPEN');

    // The next session opens: the after-market order executes and the previous day joins the history.
    const nextDay = addDays(today, 1);
    yahoo.marketState = 'REGULAR';
    yahoo.time = sessionTime(nextDay, 9, 20);
    yahoo.volumes.set('INFY.NS', 5000);
    freezeTime(yahoo.time + 15 * MINUTE);
    expect(await refreshLiveQuotes()).toBe('OPEN');
    expect(isMarketOpen()).toBe(true);
    expect(currentTradingDate()).toBe(nextDay);
    expect(orderStatus(amo.body.order.id)).toBe('EXECUTED');
    const infyId = getQuoteBySymbol('INFY')!.securityId;
    expect(get('SELECT 1 FROM price_history WHERE security_id = ? AND date = ?', infyId, today)).toBeTruthy();
  });

  it('expires DAY orders placed during the session when it closes, but keeps after-market orders', async () => {
    const nextDay = currentTradingDate();
    freezeTime(sessionTime(nextDay, 11));
    const daytime = await fundedInvestor();
    const tcs = getQuoteBySymbol('TCS')!.last / 100;
    const resting = await daytime.client.post('/api/orders', { symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', limitPrice: Math.round(tcs * 0.9 * 20) / 20, validity: 'DAY', quantity: 1, pin: DEFAULT_PIN });
    expect(resting.body.order.status).toBe('OPEN');

    yahoo.marketState = 'POSTPOST';
    yahoo.time = sessionTime(nextDay, 15, 30);
    freezeTime(sessionTime(nextDay, 16));
    const evening = await fundedInvestor();
    const amo = await evening.client.post('/api/orders', { symbol: 'TCS', side: 'BUY', orderType: 'LIMIT', limitPrice: Math.round(tcs * 0.9 * 20) / 20, validity: 'DAY', quantity: 1, pin: DEFAULT_PIN });
    expect(amo.status).toBe(201);

    expect(await refreshLiveQuotes()).toBe('CLOSED');
    expect(orderStatus(resting.body.order.id)).toBe('EXPIRED');
    expect(orderStatus(amo.body.order.id)).toBe('OPEN');
  });
});
