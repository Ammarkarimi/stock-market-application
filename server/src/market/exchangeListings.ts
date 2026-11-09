import { get, run, transaction } from '../db/index.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { AppError, unprocessable } from '../lib/errors.js';
import { istDate } from '../lib/time.js';
import type { Actor } from '../services/actor.js';
import { audit } from '../services/audit.service.js';
import { invalidateSecurityCache } from '../services/market.service.js';
import { currentTradingDate } from './engine.js';
import { liveClient, liveFeedEnabled, storeDailyHistory, storeIntraday } from './liveFeed.js';
import { allQuotes, getQuoteBySymbol, type SecurityType } from './quoteStore.js';
import { tickSizeFor } from './seedMarket.js';
import type { YahooQuote } from './yahoo.js';

/**
 * NSE stocks and ETFs beyond the reference catalogue, listed on demand: search finds them through the live
 * feed's provider, and opening one adds it with its real price, five years of daily history and live prices from
 * then on, for everyone.
 */

export interface ExchangeMatch {
  symbol: string;
  name: string;
  type: SecurityType;
  sector: string | null;
  industry: string | null;
}

const NSE = 'NSI';
const SUFFIX = '.NS';
const SEARCH_CACHE_MS = 10 * 60_000;
const SEARCH_CACHE_SIZE = 500;
/** New listings each person may add per hour. */
export const LISTINGS_PER_HOUR = 20;
/** Upper bound on securities listed this way, which keeps the database within its plan. */
export const MAX_EXCHANGE_LISTINGS = 1000;

const searchCache = new Map<string, { at: number; matches: ExchangeMatch[] }>();
const recentListings = new Map<number, number[]>();
const inFlight = new Map<string, Promise<boolean>>();

const paise = (rupees: number) => Math.round(rupees * 100);

function securityType(quoteType: string | undefined): SecurityType | null {
  if (quoteType === 'EQUITY') return 'STOCK';
  if (quoteType === 'ETF') return 'ETF';
  return null;
}

/** Our symbol for an NSE ticker (INOXWIND.NS → INOXWIND), or null for anything else. */
function nseSymbol(ticker: string | undefined): string | null {
  return ticker?.endsWith(SUFFIX) ? ticker.slice(0, -SUFFIX.length).toUpperCase() : null;
}

function isListed(symbol: string): boolean {
  const ticker = `${symbol}${SUFFIX}`.toUpperCase();
  return (
    getQuoteBySymbol(symbol) !== undefined || allQuotes().some((q) => q.liveTicker?.toUpperCase() === ticker)
  );
}

/** NSE stocks and ETFs matching a name or symbol that StockKaro does not list yet; empty without a live feed. */
export async function searchExchange(term: string, limit = 5): Promise<ExchangeMatch[]> {
  const key = term.trim().toLowerCase();
  if (!liveFeedEnabled() || key.length < 2) return [];
  let cached = searchCache.get(key);
  if (!cached || nowMs() - cached.at > SEARCH_CACHE_MS) {
    try {
      const results = await liveClient().search(key);
      const matches: ExchangeMatch[] = [];
      for (const r of results) {
        const symbol = nseSymbol(r.symbol);
        const type = securityType(r.quoteType);
        if (!symbol || !type || r.exchange !== NSE) continue;
        matches.push({
          symbol,
          name: r.longname ?? r.shortname ?? symbol,
          type,
          sector: r.sector ?? null,
          industry: r.industry ?? null,
        });
      }
      cached = { at: nowMs(), matches };
    } catch (err) {
      console.warn(`Exchange search failed: ${(err as Error).message}`);
      return [];
    }
    if (searchCache.size >= SEARCH_CACHE_SIZE) searchCache.delete(searchCache.keys().next().value!);
    searchCache.set(key, cached);
  }
  return cached.matches.filter((m) => !isListed(m.symbol)).slice(0, limit);
}

function takeListingAllowance(userId: number): void {
  const hourAgo = nowMs() - 3_600_000;
  const recent = (recentListings.get(userId) ?? []).filter((at) => at > hourAgo);
  if (recent.length >= LISTINGS_PER_HOUR) {
    throw new AppError(
      429,
      'RATE_LIMITED',
      'You have added many new stocks in the last hour. Please try again later.',
    );
  }
  recent.push(nowMs());
  recentListings.set(userId, recent);
}

/** Annualised volatility of daily closes, bounded to a sensible range for the simulator's bookkeeping. */
function annualVolatility(closes: number[]): number {
  const returns: number[] = [];
  for (let i = Math.max(1, closes.length - 252); i < closes.length; i++) {
    if (closes[i - 1]! > 0 && closes[i]! > 0) returns.push(Math.log(closes[i]! / closes[i - 1]!));
  }
  if (returns.length < 20) return 0.35;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.min(1.5, Math.max(0.1, Math.round(Math.sqrt(variance * 252) * 100) / 100));
}

/**
 * Lists an NSE stock or ETF that StockKaro does not have yet, if the exchange has it. Returns false when it is
 * not on the NSE. Several requests for the same symbol share one listing.
 */
export async function listFromExchange(symbol: string, actor: Actor): Promise<boolean> {
  if (!liveFeedEnabled()) return false;
  symbol = symbol.toUpperCase();
  if (isListed(symbol)) return true;
  let pending = inFlight.get(symbol);
  if (!pending) {
    pending = addListing(symbol, actor).finally(() => inFlight.delete(symbol));
    inFlight.set(symbol, pending);
  }
  return pending;
}

async function addListing(symbol: string, actor: Actor): Promise<boolean> {
  const ticker = `${symbol}${SUFFIX}`;
  const client = liveClient();
  const [quote] = await client.quotes([ticker]);
  const type = securityType(quote?.quoteType);
  if (!quote?.regularMarketPrice || !type || quote.exchange !== NSE) return false;

  if (actor.userId !== null) takeListingAllowance(actor.userId);
  const listed =
    (await get<{ n: number }>('SELECT COUNT(*) AS n FROM securities WHERE live_ticker IS NOT NULL'))?.n ?? 0;
  if (listed >= MAX_EXCHANGE_LISTINGS)
    throw unprocessable('LISTING_LIMIT', 'StockKaro cannot add more stocks right now.');

  const [history, intraday, search] = await Promise.all([
    client.history(ticker, '5y', '1d'),
    client.chart(ticker, '5d', '5m').catch(() => []),
    client.search(ticker).catch(() => []),
  ]);
  const profile = search.find((r) => r.symbol?.toUpperCase() === ticker.toUpperCase());

  const added = await transaction(async () => {
    // Under the write lock: another request (on any server instance) may have listed it a moment ago.
    if (await get('SELECT 1 FROM securities WHERE symbol = ? OR live_ticker = ?', symbol, ticker))
      return null;
    if (await get('SELECT 1 FROM ipos WHERE symbol = ? AND listed_at IS NULL', symbol)) return null;
    const id = await insertListing(symbol, ticker, type, quote, {
      sector: profile?.sector ?? null,
      industry: profile?.industry ?? null,
      volatility: annualVolatility(history.candles.map((c) => c.close)),
      firstTradeDate: history.meta?.firstTradeDate,
    });
    const security = { id, symbol, type, ticker };
    await storeDailyHistory(security, history.candles, true);
    await storeIntraday(security, intraday);
    await audit({
      actor,
      action: 'SECURITY_LISTED_FROM_EXCHANGE',
      subjectUserId: null,
      entityType: 'SECURITY',
      entityId: id,
      details: { symbol, ticker, name: quote.longName ?? quote.shortName ?? symbol },
    });
    return id;
  });
  await invalidateSecurityCache();
  if (added !== null) console.log(`Listed ${symbol} from the NSE`);
  return true;
}

async function insertListing(
  symbol: string,
  ticker: string,
  type: SecurityType,
  q: YahooQuote,
  extra: {
    sector: string | null;
    industry: string | null;
    volatility: number;
    firstTradeDate: number | undefined;
  },
): Promise<number> {
  const now = nowIso();
  const perShare = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? paise(v) : null);
  const stock = type === 'STOCK';
  const id = Number(
    (
      await run(
        `INSERT INTO securities (symbol, name, security_type, exchange, sector, industry, shares_outstanding, eps,
           book_value, dividend_per_share, tick_size, circuit_pct, volatility, avg_volume, listing_date, live_ticker,
           created_at, updated_at)
         VALUES (?, ?, ?, 'NSE', ?, ?, ?, ?, ?, ?, ?, 20, ?, ?, ?, ?, ?, ?)`,
        symbol,
        q.longName ?? q.shortName ?? symbol,
        type,
        extra.sector,
        extra.industry,
        stock ? (q.sharesOutstanding ?? null) : null,
        stock ? perShare(q.epsTrailingTwelveMonths) : null,
        stock ? perShare(q.bookValue) : null,
        perShare(q.trailingAnnualDividendRate || q.dividendRate),
        tickSizeFor(q.regularMarketPrice!),
        extra.volatility,
        q.averageDailyVolume3Month ?? q.regularMarketVolume ?? 0,
        extra.firstTradeDate ? istDate(extra.firstTradeDate * 1000) : null,
        ticker,
        now,
        now,
      )
    ).lastInsertRowid,
  );

  // The quote belongs to the current session only if the exchange has traded today; otherwise it is the last close.
  const tradingDate = currentTradingDate();
  const last = paise(q.regularMarketPrice!);
  const today = q.regularMarketTime !== undefined && istDate(q.regularMarketTime * 1000) >= tradingDate;
  const volume = today ? (q.regularMarketVolume ?? 0) : 0;
  const open = today ? (perShare(q.regularMarketOpen) ?? last) : last;
  await run(
    `INSERT INTO quotes (security_id, last_price, prev_close, open, high, low, volume, turnover, trading_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    last,
    today ? (perShare(q.regularMarketPreviousClose) ?? last) : last,
    open,
    today ? Math.max(last, perShare(q.regularMarketDayHigh) ?? last) : last,
    today ? Math.min(last, perShare(q.regularMarketDayLow) ?? last) : last,
    volume,
    Math.round(volume * ((open + last) / 2)),
    tradingDate,
    q.regularMarketTime ? new Date(q.regularMarketTime * 1000).toISOString() : now,
  );
  return id;
}
