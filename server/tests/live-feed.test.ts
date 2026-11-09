import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { all, get } from '../src/db/index.js';
import { freezeTime, resetTime } from '../src/lib/clock.js';
import { addDays, istDayStart } from '../src/lib/time.js';
import { currentTradingDate } from '../src/market/engine.js';
import { LISTINGS_PER_HOUR, listFromExchange } from '../src/market/exchangeListings.js';
import { enableLiveFeed, refreshLiveQuotes } from '../src/market/liveFeed.js';
import { allQuotes, getQuoteBySymbol } from '../src/market/quoteStore.js';
import { runDueWork, runLongJobs } from '../src/market/runtime.js';
import { isMarketOpen, marketSession } from '../src/market/session.js';
import {
  YahooFinance,
  yahooTicker,
  type YahooAnnualFigure,
  type YahooCandle,
  type YahooProfile,
  type YahooQuote,
  type YahooSearchResult,
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
  /** Companies on the NSE that StockKaro does not list, by ticker. */
  readonly nseOnly = new Map<string, { name: string; sector: string; industry: string }>();

  constructor() {
    super(() => Promise.reject(new Error('FakeYahoo makes no network requests')));
    for (const q of allQuotes()) {
      const rupees = Math.max(1, Math.round(q.last / 5) * 5) / 100;
      this.prices.set(yahooTicker(q.symbol), rupees);
      this.prevCloses.set(yahooTicker(q.symbol), rupees);
    }
  }

  override async quotes(tickers: string[]): Promise<YahooQuote[]> {
    // Like Yahoo, unknown tickers are simply missing from the response.
    return tickers.filter((symbol) => this.prices.has(symbol)).map((symbol) => {
      const price = this.prices.get(symbol)!;
      return {
        symbol,
        longName: this.nseOnly.get(symbol)?.name,
        quoteType: symbol.startsWith('^') ? 'INDEX' : 'EQUITY',
        exchange: 'NSI',
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

  override async history(ticker: string, range: string, interval: string) {
    return { meta: { symbol: ticker, firstTradeDate: Math.floor(Date.parse('2015-04-09T03:45:00Z') / 1000) }, candles: await this.chart(ticker, range, interval) };
  }

  /** Each NSE-only company matching the query, followed by its BSE listing. */
  override async search(query: string): Promise<YahooSearchResult[]> {
    const q = query.toLowerCase();
    return [...this.nseOnly]
      .filter(([ticker, c]) => ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .flatMap(([ticker, c]) => [
        { symbol: ticker, longname: c.name, exchange: 'NSI', quoteType: 'EQUITY', sector: c.sector, industry: c.industry },
        { symbol: ticker.replace('.NS', '.BO'), longname: c.name, exchange: 'BSE', quoteType: 'EQUITY', sector: c.sector, industry: c.industry },
      ]);
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
  await setupMarket({ ipos: true });
  today = currentTradingDate();
  yahoo = new FakeYahoo();
  yahoo.time = sessionTime(today, 15, 30);
  yahoo.prices.set('RELIANCE.NS', 1178);
  yahoo.prevCloses.set('RELIANCE.NS', 1207.7);
  await enableLiveFeed(yahoo);
  // What the first visitor's request starts in the background: quotes first, then history and company data.
  await runDueWork();
  await runLongJobs();
});

afterAll(() => {
  resetTime();
});

async function fundedInvestor(amount = 500_000) {
  const { client, user } = await registerWithPin();
  expect((await client.post('/api/funds/deposit', { amount, method: 'UPI' })).status).toBe(201);
  return { client, user };
}

const orderStatus = async (id: number) => (await get<{ status: string }>('SELECT status FROM orders WHERE id = ?', id))!.status;

describe('live market data', () => {
  it('prices catalogue securities from the feed and replaces simulated history', async () => {
    expect(marketSession()).toMatchObject({ source: 'yahoo', phase: 'CLOSED', delayMinutes: 15 });
    const reliance = getQuoteBySymbol('RELIANCE')!;
    expect(reliance).toMatchObject({ last: 117_800, prevClose: 120_770, tradingDate: today });

    const history = await all<{ date: string; close: number }>('SELECT date, close FROM price_history WHERE security_id = ? ORDER BY date', reliance.securityId);
    expect(history).toHaveLength(30);
    expect(history.every((row) => row.close === 117_800 && row.date < today)).toBe(true);

    const { client } = await registerWithPin();
    const status = await client.get('/api/market/status');
    expect(status.body).toMatchObject({ status: 'CLOSED', simulated: false, source: 'Yahoo Finance', delayMinutes: 15 });
    const detail = await client.get('/api/securities/RELIANCE');
    expect(detail.body).toMatchObject({ priceSource: 'live', quote: { lastPrice: 1178, prevClose: 1207.7 }, metrics: { eps: 50, pe: 23.56 } });

    // Companies listed through the IPO simulation are not on the exchange and keep simulated prices.
    const simulated = await get<{ symbol: string }>("SELECT symbol FROM securities WHERE symbol = 'ORBITAERO' OR listing_date >= ? LIMIT 1", addDays(today, -400));
    if (simulated) expect((await client.get(`/api/securities/${simulated.symbol}`)).body.priceSource).toBe('simulated');

    await expect(setSecurityPrice('RELIANCE', 1500, SYSTEM_ACTOR)).rejects.toThrow(/live market feed/);
  });

  it('loads reported financials', async () => {
    const reliance = getQuoteBySymbol('RELIANCE')!;
    expect(await get('SELECT 1 FROM financials WHERE security_id = ?', reliance.securityId)).toBeTruthy();
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
    expect(await orderStatus(amo.body.order.id)).toBe('EXECUTED');
    const infyId = getQuoteBySymbol('INFY')!.securityId;
    expect(await get('SELECT 1 FROM price_history WHERE security_id = ? AND date = ?', infyId, today)).toBeTruthy();
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
    expect(await orderStatus(resting.body.order.id)).toBe('EXPIRED');
    expect(await orderStatus(amo.body.order.id)).toBe('OPEN');
  });
});

describe('NSE stocks beyond the catalogue', () => {
  beforeAll(() => {
    yahoo.nseOnly.set('INOXWIND.NS', { name: 'Inox Wind Limited', sector: 'Industrials', industry: 'Specialty Industrial Machinery' });
    yahoo.prices.set('INOXWIND.NS', 150.4);
    yahoo.prevCloses.set('INOXWIND.NS', 148);
  });

  it('finds NSE stocks StockKaro does not list yet, without their BSE listings', async () => {
    const { client } = await registerWithPin();
    const res = await client.get('/api/securities/search?q=inox&exchange=true');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.exchange).toEqual([
      { symbol: 'INOXWIND', name: 'Inox Wind Limited', type: 'STOCK', sector: 'Industrials', industry: 'Specialty Industrial Machinery' },
    ]);
    // Without the flag, search stays within the listed securities.
    expect((await client.get('/api/securities/search?q=inox')).body.exchange).toEqual([]);
  });

  it('lists a stock with real history and live prices when someone opens it', async () => {
    const { client, user } = await registerWithPin();
    const detail = await client.get('/api/securities/INOXWIND');
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      priceSource: 'live',
      quote: { symbol: 'INOXWIND', name: 'Inox Wind Limited', lastPrice: 150.4, prevClose: 148 },
    });
    const security = (await get<{ id: number; sector: string; industry: string; live_ticker: string; listing_date: string }>(
      "SELECT id, sector, industry, live_ticker, listing_date FROM securities WHERE symbol = 'INOXWIND'",
    ))!;
    expect(security).toMatchObject({ sector: 'Industrials', industry: 'Specialty Industrial Machinery', live_ticker: 'INOXWIND.NS', listing_date: '2015-04-09' });
    const history = await all('SELECT 1 FROM price_history WHERE security_id = ?', security.id);
    expect(history).toHaveLength(30);
    expect(await get("SELECT 1 FROM audit_logs WHERE action = 'SECURITY_LISTED_FROM_EXCHANGE' AND actor_id = ?", user.id)).toBeTruthy();

    // Now it is an ordinary listed security: search lists it, and the feed keeps its price current.
    const search = await client.get('/api/securities/search?q=inox&exchange=true');
    expect(search.body.items.map((i: { symbol: string }) => i.symbol)).toEqual(['INOXWIND']);
    expect(search.body.exchange).toEqual([]);
    yahoo.prices.set('INOXWIND.NS', 161.25);
    await refreshLiveQuotes();
    expect(getQuoteBySymbol('INOXWIND')!.last).toBe(16_125);
  });

  it('answers 404 for names that are not on the NSE', async () => {
    const { client } = await registerWithPin();
    expect((await client.get('/api/securities/NOTALISTEDCO')).status).toBe(404);
    expect(await get("SELECT 1 FROM securities WHERE symbol = 'NOTALISTEDCO'")).toBeUndefined();
  });

  it('limits how many new stocks one person can add in an hour', async () => {
    const { user } = await registerWithPin();
    const actor = { userId: user.id, role: 'USER' as const };
    for (let i = 0; i <= LISTINGS_PER_HOUR; i++) {
      yahoo.nseOnly.set(`NSECO${i}.NS`, { name: `NSE Company ${i}`, sector: 'Industrials', industry: 'Machinery' });
      yahoo.prices.set(`NSECO${i}.NS`, 100 + i);
    }
    for (let i = 0; i < LISTINGS_PER_HOUR; i++) expect(await listFromExchange(`NSECO${i}`, actor)).toBe(true);
    await expect(listFromExchange(`NSECO${LISTINGS_PER_HOUR}`, actor)).rejects.toMatchObject({ status: 429 });
  });
});
