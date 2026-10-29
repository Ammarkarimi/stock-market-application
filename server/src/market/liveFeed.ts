import { all, insertMany, run, transaction } from '../db/index.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { istDate } from '../lib/time.js';
import { invalidateSecurityCache } from '../services/market.service.js';
import { expireDayOrdersPlacedBefore } from '../services/order.service.js';
import { claimLease, getState, setState } from '../services/settings.service.js';
import { FUNDS, INDICES, STOCKS } from './catalog.js';
import {
  alignTradingDate,
  applyExternalQuotes,
  currentTradingDate,
  reloadMarket,
  resetCurrentBars,
  setExternallyPriced,
  type ExternalQuote,
} from './engine.js';
import { getQuote } from './quoteStore.js';
import { BAR_MS, tickSizeFor } from './seedMarket.js';
import {
  loadMarketSession,
  marketSession,
  saveMarketSession,
  setMarketSource,
  updateMarketSession,
  type MarketPhase,
} from './session.js';
import { BENCHMARK_TICKER, YahooFinance, yahooTicker, type YahooCandle, type YahooQuote } from './yahoo.js';

/** Fetch five years of history when the stored history is older than this; otherwise just the last month. */
const FULL_HISTORY_AFTER_DAYS = 20;
const CONCURRENCY = 6;
const FUNDAMENTALS_FROM_QUOTES_MS = 60 * 60_000;
/** How often the stored history is replaced with the exchange's. */
const HISTORY_SYNC_MS = 20 * 60 * 60_000;

interface LiveSecurity {
  id: number;
  symbol: string;
  type: string;
  ticker: string;
}

let client = new YahooFinance();
let securities: LiveSecurity[] | null = null;
let enabled = false;

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
async function loadLiveSecurities(): Promise<LiveSecurity[]> {
  const catalogue = new Set([...STOCKS, ...FUNDS, ...INDICES].map((s) => s.symbol));
  return (await all<{ id: number; symbol: string; security_type: string }>('SELECT id, symbol, security_type FROM securities ORDER BY id'))
    .filter((row) => catalogue.has(row.symbol))
    .map((row) => ({ id: row.id, symbol: row.symbol, type: row.security_type, ticker: yahooTicker(row.symbol) }));
}

/** Applies one batch of quotes from the feed; returns the exchange's current phase. */
async function applyLiveQuotes(securities: LiveSecurity[], quotes: YahooQuote[]): Promise<MarketPhase> {
  const byTicker = new Map(quotes.map((q) => [q.symbol, q]));
  const benchmark = byTicker.get(BENCHMARK_TICKER);
  if (!benchmark?.regularMarketTime) throw new Error('the NIFTY 50 quote is missing from the response');

  const phase = phaseOf(benchmark.marketState);
  const asOf = benchmark.regularMarketTime * 1000;
  const sessionDate = istDate(asOf);
  await alignTradingDate(sessionDate);
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
  await applyExternalQuotes(updates);

  // Outside the session, DAY orders placed before the close have expired; later ones wait for the next session.
  if (phase !== 'OPEN') await expireDayOrdersPlacedBefore(new Date(asOf).toISOString());

  if (await claimLease('fundamentalsFromQuotes', FUNDAMENTALS_FROM_QUOTES_MS)) await updateFundamentalsFromQuotes(securities, byTicker);
  return phase;
}

/** Per-share figures and liquidity that come with every quote. */
async function updateFundamentalsFromQuotes(securities: LiveSecurity[], byTicker: Map<string, YahooQuote>): Promise<void> {
  await transaction(async () => {
    for (const security of securities) {
      const q = byTicker.get(security.ticker);
      if (!q?.regularMarketPrice || security.type === 'INDEX') continue;
      const tickSize = tickSizeFor(q.regularMarketPrice);
      const quote = getQuote(security.id);
      if (quote) quote.tickSize = tickSize;
      const perShare = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? paise(v) : null);
      await run(
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
  await invalidateSecurityCache();
}

function candleRow(securityId: number, key: string | number, c: YahooCandle): unknown[] {
  const open = paise(c.open);
  const close = paise(c.close);
  return [securityId, key, open, Math.max(open, close, paise(c.high)), Math.min(open, close, paise(c.low)), close, c.volume];
}

async function storeDailyHistory(security: LiveSecurity, candles: YahooCandle[], full: boolean): Promise<void> {
  const tradingDate = currentTradingDate();
  const rows = new Map<string, YahooCandle>();
  for (const c of candles) {
    const date = istDate(c.time * 1000);
    // The trading day itself lives in the quote.
    if (date < tradingDate) rows.set(date, c);
  }
  const first = [...rows.keys()].sort()[0];
  await transaction(async () => {
    if (full) await run('DELETE FROM price_history WHERE security_id = ?', security.id);
    else if (first) await run('DELETE FROM price_history WHERE security_id = ? AND date >= ?', security.id, first);
    await run('DELETE FROM price_history WHERE security_id = ? AND date >= ?', security.id, tradingDate);
    await insertMany(
      'price_history',
      ['security_id', 'date', 'open', 'high', 'low', 'close', 'volume'],
      [...rows].map(([date, c]) => candleRow(security.id, date, c)),
    );
  });
}

async function storeIntraday(security: LiveSecurity, candles: YahooCandle[]): Promise<void> {
  if (candles.length === 0) return;
  const bars = new Map<number, YahooCandle>();
  for (const c of candles) bars.set(Math.floor((c.time * 1000) / BAR_MS) * BAR_MS, c);
  const first = Math.min(...bars.keys());
  await transaction(async () => {
    await run('DELETE FROM intraday_prices WHERE security_id = ? AND ts >= ?', security.id, first);
    await insertMany(
      'intraday_prices',
      ['security_id', 'ts', 'open', 'high', 'low', 'close', 'volume'],
      [...bars].map(([ts, c]) => candleRow(security.id, ts, c)),
    );
  });
}

/** True when the stored history needs replacing with the exchange's (at most about once a day). */
export async function liveHistoryDue(): Promise<boolean> {
  const lastSync = await getState('liveHistorySyncedAt');
  return !lastSync || nowMs() - Date.parse(lastSync) > HISTORY_SYNC_MS;
}

/** Replaces stored daily and five-minute history with the exchange's. */
export async function syncLiveHistory(): Promise<void> {
  const securities = await liveSecurities();
  const lastSync = await getState('liveHistorySyncedAt');
  const full = !lastSync || nowMs() - Date.parse(lastSync) > FULL_HISTORY_AFTER_DAYS * 86_400_000;
  const started = nowMs();
  const failures = await eachLimited(securities, CONCURRENCY, async (security) => {
    const daily = await client.chart(security.ticker, full ? '5y' : '1mo', '1d');
    if (daily.length === 0) throw new Error(`no price history for ${security.symbol}`);
    await storeDailyHistory(security, daily, full);
    await storeIntraday(security, await client.chart(security.ticker, '5d', '5m'));
  });
  resetCurrentBars();
  if (failures < securities.length / 2) await setState('liveHistorySyncedAt', nowIso());
  console.log(`Live market data: ${full ? 'five years' : 'one month'} of history for ${securities.length - failures} securities in ${Math.round((nowMs() - started) / 1000)}s`);
}

/** Company profile, ratios and annual results; refreshed once a day. */
export async function syncLiveFundamentals(): Promise<void> {
  const today = istDate();
  if ((await getState('liveFundamentalsSyncedOn')) === today) return;
  const stocks = (await liveSecurities()).filter((s) => s.type === 'STOCK');
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const crore = (v: number | null) => (v === null ? null : Math.round(v / 1e7));
  const failures = await eachLimited(stocks, 3, async (security) => {
    const [profile, annual] = await Promise.all([client.profile(security.ticker), client.annualFinancials(security.ticker)]);
    await transaction(async () => {
      if (profile) {
        await run(
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
        await run(
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
  await invalidateSecurityCache();
  if (failures < stocks.length / 2) await setState('liveFundamentalsSyncedOn', today);
  console.log(`Live market data: fundamentals for ${stocks.length - failures} of ${stocks.length} companies`);
}

/** The catalogue securities priced by the feed, loaded once per server instance. */
async function liveSecurities(): Promise<LiveSecurity[]> {
  securities ??= await loadLiveSecurities();
  return securities;
}

/**
 * Prices the catalogue's exchange-listed securities from the feed instead of the simulator. Nothing is fetched
 * here: quotes arrive with refreshLiveQuotes(), which the market runtime calls while people use the site.
 */
export async function enableLiveFeed(provider: YahooFinance = new YahooFinance()): Promise<void> {
  client = provider;
  securities = null;
  setExternallyPriced((await liveSecurities()).map((s) => s.id));
  setMarketSource('yahoo');
  enabled = true;
}

export function liveFeedEnabled(): boolean {
  return enabled;
}

/**
 * Fetches the latest quotes and applies them: the trading date follows the exchange's session, and order
 * matching and alerts react to the new prices. The network request runs outside any transaction.
 * Returns the exchange's current phase; a failed refresh is recorded on the market session and rethrown.
 */
export async function refreshLiveQuotes(): Promise<MarketPhase> {
  const securities = await liveSecurities();
  let quotes: YahooQuote[];
  try {
    quotes = await client.quotes(securities.map((s) => s.ticker));
  } catch (err) {
    await recordFailure(err as Error);
    throw err;
  }
  try {
    return await transaction(async () => {
      // Another server instance may have moved the market since this one last looked.
      await reloadMarket();
      await loadMarketSession();
      const phase = await applyLiveQuotes(securities, quotes);
      await saveMarketSession();
      return phase;
    });
  } catch (err) {
    await recordFailure(err as Error);
    throw err;
  }
}

async function recordFailure(err: Error): Promise<void> {
  if (marketSession().lastError !== err.message) console.warn(`Live market data: quote refresh failed: ${err.message}`);
  updateMarketSession({ lastError: err.message });
  await saveMarketSession().catch(() => {});
}
