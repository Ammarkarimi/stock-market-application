import { AppError, notFound } from '../lib/errors.js';
import { YahooError, YahooFinance, type FetchLike } from '../market/yahoo.js';
import type { Bar, PriceSeries, SymbolMatch } from './types.js';

/** Source of real daily price history and symbol search for the chart analyzer. */
export interface MarketDataProvider {
  readonly name: string;
  search(query: string): Promise<SymbolMatch[]>;
  history(symbol: string): Promise<PriceSeries>;
}

const unavailable = () => new AppError(503, 'DATA_SOURCE_UNAVAILABLE', 'Market data is temporarily unavailable. Please try again in a minute.');

const SEARCHABLE_TYPES = new Set(['EQUITY', 'ETF', 'INDEX']);

/** Runs a Yahoo request, turning an unknown symbol into a 404 and anything else that fails into a 503. */
async function upstream<T>(request: () => Promise<T>, symbol?: string): Promise<T> {
  try {
    return await request();
  } catch (err) {
    if (symbol && err instanceof YahooError && err.status === 404) throw notFound(`No price data found for ${symbol}`);
    throw unavailable();
  }
}

/** Yahoo Finance chart and search endpoints, through the same client as the live market feed. */
export function createYahooProvider(fetchImpl?: FetchLike, now: () => number = Date.now): MarketDataProvider {
  const yahoo = new YahooFinance(fetchImpl);
  return {
    name: 'Yahoo Finance',

    async search(query) {
      const quotes = await upstream(() => yahoo.search(query));
      const matches = quotes
        .filter((q) => q.symbol && q.quoteType && SEARCHABLE_TYPES.has(q.quoteType))
        .map((q) => ({
          symbol: q.symbol!,
          name: q.longname ?? q.shortname ?? q.symbol!,
          exchange: q.exchDisp ?? q.exchange ?? '',
          type: q.quoteType!,
        }));
      return preferIndianListings(matches);
    },

    async history(symbol) {
      const { meta, candles } = await upstream(() => yahoo.history(symbol, '2y', '1d'), symbol);
      if (!meta) throw notFound(`No price data found for ${symbol}`);
      const offset = meta.gmtoffset ?? 0;
      const localDate = (seconds: number) => new Date((seconds + offset) * 1000).toISOString().slice(0, 10);
      const bars: Bar[] = [];
      for (const c of candles) {
        if (c.close <= 0) continue;
        const date = localDate(c.time);
        const bar = { date, open: c.open, high: Math.max(c.high, c.open, c.close), low: Math.min(c.low, c.open, c.close), close: c.close, volume: c.volume };
        // Keep one bar per day: a live session can repeat the last date.
        if (bars.at(-1)?.date === date) bars[bars.length - 1] = bar;
        else bars.push(bar);
      }
      return {
        symbol: meta.symbol,
        name: meta.longName ?? meta.shortName ?? meta.symbol,
        exchange: meta.fullExchangeName ?? meta.exchangeName ?? '',
        currency: meta.currency ?? 'USD',
        instrumentType: meta.instrumentType ?? 'EQUITY',
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
        sessionInProgress: sessionInProgress(meta.currentTradingPeriod?.regular, bars.at(-1)?.date, localDate, now()),
        bars,
      };
    },
  };
}

/**
 * Whether the last bar belongs to a regular session that is trading right now. Yahoo reports the current session,
 * or the next one outside trading hours, so a bar from an earlier date is always complete.
 */
function sessionInProgress(regular: { start: number; end: number } | undefined, lastDate: string | undefined, localDate: (seconds: number) => string, nowMs: number): boolean {
  if (!regular || !lastDate) return false;
  const nowSeconds = nowMs / 1000;
  return nowSeconds >= regular.start && nowSeconds < regular.end && localDate(regular.start) === lastDate;
}

export const yahooProvider = createYahooProvider();

/**
 * StockKaro is an Indian-market app: when the best matches include an NSE or BSE listing (for example
 * INFY.NS next to the NYSE-listed INFY), list NSE first, then BSE, keeping the provider's order otherwise.
 */
export function preferIndianListings(matches: SymbolMatch[]): SymbolMatch[] {
  const rank = (m: SymbolMatch) => (m.symbol.endsWith('.NS') ? 0 : m.symbol.endsWith('.BO') ? 1 : 2);
  const top = matches.slice(0, 5).map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m);
  return [...top, ...matches.slice(5)];
}

let provider: MarketDataProvider = yahooProvider;

/** Replaces the data source (used by tests). Clears the cache. */
export function setMarketDataProvider(next: MarketDataProvider): void {
  provider = next;
  cache.clear();
}

export function dataSourceName(): string {
  return provider.name;
}

// ---- Cache: repeated look-ups within a few minutes reuse one upstream request ----

const HISTORY_TTL_MS = 10 * 60_000;
const SEARCH_TTL_MS = 60 * 60_000;
const MAX_ENTRIES = 300;
const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { expires: Date.now() + ttl, value });
  // Failures are not cached, so the next request retries.
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}

export function searchSymbols(query: string): Promise<SymbolMatch[]> {
  return cached(`search:${query.toLowerCase()}`, SEARCH_TTL_MS, () => provider.search(query));
}

export function priceHistory(symbol: string): Promise<PriceSeries> {
  return cached(`history:${symbol.toUpperCase()}`, HISTORY_TTL_MS, () => provider.history(symbol));
}
