import { config } from '../config.js';
import { all, run, transaction } from '../db/index.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { istDate } from '../lib/time.js';
import { invalidateSecurityCache } from '../services/market.service.js';
import { expireDayOrdersPlacedBefore } from '../services/order.service.js';
import { getState, setState } from '../services/settings.service.js';
import { FUNDS, INDICES, STOCKS } from './catalog.js';
import {
  alignTradingDate,
  applyExternalQuotes,
  currentTradingDate,
  resetCurrentBars,
  setExternallyPriced,
  type ExternalQuote,
} from './engine.js';
import { getQuote } from './quoteStore.js';
import { BAR_MS, tickSizeFor } from './seedMarket.js';
import { marketSession, updateMarketSession, type MarketPhase } from './session.js';
import { BENCHMARK_TICKER, YahooFinance, yahooTicker, type YahooCandle, type YahooQuote } from './yahoo.js';

/** Poll interval while the exchange is closed: just often enough to notice the next session. */
const CLOSED_POLL_MS = 2 * 60_000;
const FUNDAMENTALS_FROM_QUOTES_MS = 60 * 60_000;
/** Fetch five years of history when the stored history is older than this; otherwise just the last month. */
const FULL_HISTORY_AFTER_DAYS = 20;
const CONCURRENCY = 6;

interface LiveSecurity {
  id: number;
  symbol: string;
  type: string;
  ticker: string;
}

let client = new YahooFinance();
let securities: LiveSecurity[] = [];
let timer: NodeJS.Timeout | null = null;
let running = false;
let fundamentalsFromQuotesAt = 0;
let fundamentalsInFlight: Promise<void> | null = null;

const paise = (rupees: number) => Math.round(rupees * 100);

function phaseOf(marketState: string | undefined): MarketPhase {
  if (marketState === 'REGULAR') return 'OPEN';
  if (marketState === 'PRE') return 'PRE_OPEN';
  return 'CLOSED';
}

async function eachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<number> {
  let next = 0;
  let failures = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await task(item);
      } catch (err) {
        failures++;
        console.warn(`Live market data: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return failures;
}

/**
 * Real exchange-listed securities from the reference catalogue. Securities added later (admin listings and
 * the fictional companies listed through the IPO simulation) keep simulated prices.
 */
function loadLiveSecurities(): LiveSecurity[] {
  const catalogue = new Set([...STOCKS, ...FUNDS, ...INDICES].map((s) => s.symbol));
  return all<{ id: number; symbol: string; security_type: string }>('SELECT id, symbol, security_type FROM securities ORDER BY id')
    .filter((row) => catalogue.has(row.symbol))
    .map((row) => ({ id: row.id, symbol: row.symbol, type: row.security_type, ticker: yahooTicker(row.symbol) }));
}

/** Fetches every quote in one batch and applies it; returns the exchange's current phase. */
async function refreshQuotes(): Promise<MarketPhase> {
  const quotes = await client.quotes(securities.map((s) => s.ticker));
  const byTicker = new Map(quotes.map((q) => [q.symbol, q]));
  const benchmark = byTicker.get(BENCHMARK_TICKER);
  if (!benchmark?.regularMarketTime) throw new Error('the NIFTY 50 quote is missing from the response');

  const phase = phaseOf(benchmark.marketState);
  const asOf = benchmark.regularMarketTime * 1000;
  const sessionDate = istDate(asOf);
  alignTradingDate(sessionDate);
  updateMarketSession({
    phase,
    asOf,
    delayMinutes: benchmark.exchangeDataDelayedBy ?? 15,
    lastError: null,
    lastSessionEnd: phase === 'OPEN' ? marketSession().lastSessionEnd : asOf,
  });

  const updates: ExternalQuote[] = [];
  for (const security of securities) {
    const q = byTicker.get(security.ticker);
    if (!q?.regularMarketPrice || !q.regularMarketTime) continue;
    // A quote from an earlier session belongs to a suspended security; keep its last known state.
    if (istDate(q.regularMarketTime * 1000) < sessionDate) continue;
    const last = paise(q.regularMarketPrice);
    updates.push({
      securityId: security.id,
      last,
      prevClose: paise(q.regularMarketPreviousClose ?? q.regularMarketPrice),
      open: paise(q.regularMarketOpen ?? q.regularMarketPrice),
      high: paise(q.regularMarketDayHigh ?? q.regularMarketPrice),
      low: paise(q.regularMarketDayLow ?? q.regularMarketPrice),
      volume: q.regularMarketVolume ?? 0,
      time: q.regularMarketTime * 1000,
    });
  }
  applyExternalQuotes(updates);

  // Outside the session, DAY orders placed before the close have expired; later ones wait for the next session.
  if (phase !== 'OPEN') expireDayOrdersPlacedBefore(new Date(asOf).toISOString());

  if (nowMs() - fundamentalsFromQuotesAt > FUNDAMENTALS_FROM_QUOTES_MS) {
    updateFundamentalsFromQuotes(byTicker);
    fundamentalsFromQuotesAt = nowMs();
  }
  return phase;
}

/** Per-share figures and liquidity that come with every quote. */
function updateFundamentalsFromQuotes(byTicker: Map<string, YahooQuote>): void {
  transaction(() => {
    for (const security of securities) {
      const q = byTicker.get(security.ticker);
      if (!q?.regularMarketPrice || security.type === 'INDEX') continue;
      const tickSize = tickSizeFor(q.regularMarketPrice);
      const quote = getQuote(security.id);
      if (quote) quote.tickSize = tickSize;
      const perShare = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? paise(v) : null);
      run(
        `UPDATE securities SET tick_size = ?, avg_volume = COALESCE(?, avg_volume),
           eps = COALESCE(?, eps), book_value = COALESCE(?, book_value),
           shares_outstanding = COALESCE(?, shares_outstanding), dividend_per_share = COALESCE(?, dividend_per_share),
           updated_at = ?
         WHERE id = ?`,
        tickSize,
        q.averageDailyVolume3Month ?? null,
        security.type === 'STOCK' ? perShare(q.epsTrailingTwelveMonths) : null,
        security.type === 'STOCK' ? perShare(q.bookValue) : null,
        security.type === 'STOCK' ? (q.sharesOutstanding ?? null) : null,
        // The trailing rate is 0 for some payers right after the record date; fall back to the indicated annual rate.
        perShare(q.trailingAnnualDividendRate || q.dividendRate),
        nowIso(),
        security.id,
      );
    }
  });
  invalidateSecurityCache();
}

function storeDailyHistory(security: LiveSecurity, candles: YahooCandle[], full: boolean): void {
  const tradingDate = currentTradingDate();
  const rows = candles.map((c) => ({ ...c, date: istDate(c.time * 1000) })).filter((c) => c.date < tradingDate);
  transaction(() => {
    if (full) run('DELETE FROM price_history WHERE security_id = ?', security.id);
    else if (rows.length > 0) run('DELETE FROM price_history WHERE security_id = ? AND date >= ?', security.id, rows[0]!.date);
    // The trading day itself lives in the quote.
    run('DELETE FROM price_history WHERE security_id = ? AND date >= ?', security.id, tradingDate);
    for (const c of rows) {
      const open = paise(c.open);
      const close = paise(c.close);
      run(
        `INSERT INTO price_history (security_id, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(security_id, date) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low,
           close = excluded.close, volume = excluded.volume`,
        security.id,
        c.date,
        open,
        Math.max(open, close, paise(c.high)),
        Math.min(open, close, paise(c.low)),
        close,
        c.volume,
      );
    }
  });
}

function storeIntraday(security: LiveSecurity, candles: YahooCandle[]): void {
  if (candles.length === 0) return;
  const bars = new Map<number, YahooCandle>();
  for (const c of candles) bars.set(Math.floor((c.time * 1000) / BAR_MS) * BAR_MS, c);
  const first = Math.min(...bars.keys());
  transaction(() => {
    run('DELETE FROM intraday_prices WHERE security_id = ? AND ts >= ?', security.id, first);
    for (const [ts, c] of bars) {
      const open = paise(c.open);
      const close = paise(c.close);
      run(
        'INSERT INTO intraday_prices (security_id, ts, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)',
        security.id,
        ts,
        open,
        Math.max(open, close, paise(c.high)),
        Math.min(open, close, paise(c.low)),
        close,
        c.volume,
      );
    }
  });
}

/** Replaces stored daily and five-minute history with the exchange's. */
async function syncHistory(): Promise<void> {
  const lastSync = getState('liveHistorySyncedAt');
  const full = !lastSync || nowMs() - Date.parse(lastSync) > FULL_HISTORY_AFTER_DAYS * 86_400_000;
  const started = nowMs();
  const failures = await eachLimited(securities, CONCURRENCY, async (security) => {
    const daily = await client.chart(security.ticker, full ? '5y' : '1mo', '1d');
    if (daily.length === 0) throw new Error(`no price history for ${security.symbol}`);
    storeDailyHistory(security, daily, full);
    storeIntraday(security, await client.chart(security.ticker, '5d', '5m'));
  });
  resetCurrentBars();
  if (failures < securities.length / 2) setState('liveHistorySyncedAt', nowIso());
  console.log(`Live market data: ${full ? 'five years' : 'one month'} of history for ${securities.length - failures} securities in ${Math.round((nowMs() - started) / 1000)}s`);
}

/** Company profile, ratios and annual results; refreshed once a day in the background. */
async function syncFundamentals(): Promise<void> {
  const today = istDate();
  if (getState('liveFundamentalsSyncedOn') === today) return;
  const stocks = securities.filter((s) => s.type === 'STOCK');
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const crore = (v: number | null) => (v === null ? null : Math.round(v / 1e7));
  const failures = await eachLimited(stocks, 3, async (security) => {
    const [profile, annual] = await Promise.all([client.profile(security.ticker), client.annualFinancials(security.ticker)]);
    transaction(() => {
      if (profile) {
        run(
          `UPDATE securities SET description = COALESCE(?, description), headquarters = COALESCE(?, headquarters),
             beta = COALESCE(?, beta), roe = COALESCE(?, roe), debt_to_equity = COALESCE(?, debt_to_equity),
             revenue_cr = COALESCE(?, revenue_cr), net_profit_cr = COALESCE(?, net_profit_cr), updated_at = ?
           WHERE id = ?`,
          profile.description?.slice(0, 2000) ?? null,
          profile.city,
          profile.beta === null ? null : round2(profile.beta),
          profile.returnOnEquity === null ? null : round2(profile.returnOnEquity * 100),
          profile.debtToEquity === null ? null : round2(profile.debtToEquity / 100),
          crore(profile.totalRevenue),
          crore(profile.netIncome),
          nowIso(),
          security.id,
        );
      }
      for (const year of annual) {
        if (year.revenue === null && year.netIncome === null) continue;
        run(
          `INSERT INTO financials (security_id, period_end, revenue_cr, net_profit_cr, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(security_id, period_end) DO UPDATE SET revenue_cr = excluded.revenue_cr,
             net_profit_cr = excluded.net_profit_cr, updated_at = excluded.updated_at`,
          security.id,
          year.periodEnd,
          crore(year.revenue),
          crore(year.netIncome),
          nowIso(),
        );
      }
    });
  });
  invalidateSecurityCache();
  if (failures < stocks.length / 2) setState('liveFundamentalsSyncedOn', today);
  console.log(`Live market data: fundamentals for ${stocks.length - failures} of ${stocks.length} companies`);
}

function refreshFundamentalsInBackground(): void {
  if (fundamentalsInFlight) return;
  fundamentalsInFlight = syncFundamentals()
    .catch((err) => console.warn(`Live market data: fundamentals refresh failed: ${(err as Error).message}`))
    .finally(() => {
      fundamentalsInFlight = null;
    });
}

async function poll(): Promise<void> {
  timer = null;
  if (!running) return;
  try {
    await refreshQuotes();
  } catch (err) {
    const message = (err as Error).message;
    if (marketSession().lastError !== message) console.warn(`Live market data: quote refresh failed: ${message}`);
    updateMarketSession({ lastError: message });
  }
  refreshFundamentalsInBackground();
  if (running) timer = setTimeout(() => void poll(), marketSession().phase === 'OPEN' ? config.livePollMs : CLOSED_POLL_MS);
}

/**
 * Switches the market to live prices: loads the latest quotes and real price history, then keeps quotes
 * current. Throws if the provider cannot be reached, so the caller can fall back to the simulator.
 */
export async function startLiveFeed(provider: YahooFinance = new YahooFinance()): Promise<void> {
  client = provider;
  securities = loadLiveSecurities();
  setExternallyPriced(securities.map((s) => s.id));
  updateMarketSession({ source: 'yahoo', phase: 'CLOSED', delayMinutes: 15, lastError: null });
  fundamentalsFromQuotesAt = 0;
  try {
    await refreshQuotes();
  } catch (err) {
    setExternallyPriced([]);
    updateMarketSession({ source: 'simulated', phase: 'OPEN', delayMinutes: 0 });
    throw err;
  }
  await syncHistory();
  running = true;
  timer = setTimeout(() => void poll(), marketSession().phase === 'OPEN' ? config.livePollMs : CLOSED_POLL_MS);
  refreshFundamentalsInBackground();
}

export async function stopLiveFeed(): Promise<void> {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  await fundamentalsInFlight;
}

/** Runs one quote refresh immediately (tests and admin tooling). */
export async function refreshLiveQuotes(): Promise<MarketPhase> {
  return refreshQuotes();
}
