import { AppError, notFound } from '../lib/errors.js';
import type { Bar, PriceSeries, SymbolMatch } from './types.js';

/** Source of real daily price history and symbol search for the chart analyzer. */
export interface MarketDataProvider {
  readonly name: string;
  search(query: string): Promise<SymbolMatch[]>;
  history(symbol: string): Promise<PriceSeries>;
}

const unavailable = () => new AppError(503, 'DATA_SOURCE_UNAVAILABLE', 'Market data is temporarily unavailable. Please try again in a minute.');

const SEARCHABLE_TYPES = new Set(['EQUITY', 'ETF', 'INDEX']);
const TIMEOUT_MS = 10_000;

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; StockSphere/1.0)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw unavailable();
  }
  const text = await response.text();
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    throw unavailable();
  }
}

interface YahooChart {
  chart?: {
    result?: {
      meta: {
        symbol: string;
        currency?: string;
        fullExchangeName?: string;
        exchangeName?: string;
        instrumentType?: string;
        longName?: string;
        shortName?: string;
        gmtoffset?: number;
        fiftyTwoWeekHigh?: number;
        fiftyTwoWeekLow?: number;
      };
      timestamp?: number[];
      indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
    }[] | null;
    error?: { code?: string; description?: string } | null;
  };
}

interface YahooSearch {
  quotes?: { symbol?: string; shortname?: string; longname?: string; exchDisp?: string; exchange?: string; quoteType?: string }[];
}

/** Yahoo Finance's public chart and search endpoints (no API key). */
export const yahooProvider: MarketDataProvider = {
  name: 'Yahoo Finance',

  async search(query) {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0`;
    const { status, body } = await getJson(url);
    if (status !== 200) throw unavailable();
    const matches = ((body as YahooSearch).quotes ?? [])
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
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&includePrePost=false&events=div%2Csplits`;
    const { status, body } = await getJson(url);
    const chart = (body as YahooChart | null)?.chart;
    const result = chart?.result?.[0];
    if (status === 404 || (chart?.error && !result)) throw notFound(`No price data found for ${symbol}`);
    if (status !== 200 || !result) throw unavailable();

    const meta = result.meta;
    const quote = result.indicators.quote[0];
    const offset = meta.gmtoffset ?? 0;
    const bars: Bar[] = [];
    (result.timestamp ?? []).forEach((time, i) => {
      const [open, high, low, close] = [quote?.open[i], quote?.high[i], quote?.low[i], quote?.close[i]];
      // Holidays and halted sessions come back as nulls.
      if (open == null || high == null || low == null || close == null || close <= 0) return;
      const date = new Date((time + offset) * 1000).toISOString().slice(0, 10);
      const bar = { date, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close, volume: quote?.volume[i] ?? 0 };
      // Keep one bar per day: a live session can repeat the last date.
      if (bars.at(-1)?.date === date) bars[bars.length - 1] = bar;
      else bars.push(bar);
    });
    return {
      symbol: meta.symbol,
      name: meta.longName ?? meta.shortName ?? meta.symbol,
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? '',
      currency: meta.currency ?? 'USD',
      instrumentType: meta.instrumentType ?? 'EQUITY',
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
      bars,
    };
  },
};

/**
 * StockSphere is an Indian-market app: when the best matches include an NSE or BSE listing (for example
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
