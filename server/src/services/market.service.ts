import { config } from '../config.js';
import { all, get } from '../db/index.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { notFound } from '../lib/errors.js';
import { changePercent, toRupees, toRupeesOrNull } from '../lib/money.js';
import { createRng, hashString } from '../lib/rng.js';
import { addDays, istDate, istDayStart } from '../lib/time.js';
import { pageOf, type Page } from '../lib/validation.js';
import { currentTradingDate, isExternallyPriced, isSimulationRunning } from '../market/engine.js';
import {
  allQuotes,
  circuitLimits,
  getQuote,
  getQuoteBySymbol,
  toQuoteDto,
  type LiveQuote,
  type QuoteDto,
  type SecurityType,
} from '../market/quoteStore.js';
import { marketSession } from '../market/session.js';

export const SECURITY_TYPES: SecurityType[] = ['STOCK', 'ETF', 'REIT', 'INVIT', 'INDEX'];

interface SecurityRow {
  id: number;
  symbol: string;
  name: string;
  security_type: SecurityType;
  exchange: string;
  sector: string | null;
  industry: string | null;
  description: string | null;
  founded_year: number | null;
  headquarters: string | null;
  face_value: number | null;
  shares_outstanding: number | null;
  eps: number | null;
  book_value: number | null;
  dividend_per_share: number | null;
  roe: number | null;
  debt_to_equity: number | null;
  beta: number | null;
  revenue_cr: number | null;
  net_profit_cr: number | null;
  expense_ratio: number | null;
  tick_size: number;
  circuit_pct: number;
  underlying_symbol: string | null;
  is_tradable: number;
  trading_status: 'ACTIVE' | 'HALTED';
  listing_date: string | null;
}

let sharesCache: Map<number, number> | null = null;

function sharesOutstanding(securityId: number): number | null {
  if (!sharesCache) {
    sharesCache = new Map(
      all<{ id: number; shares_outstanding: number | null }>('SELECT id, shares_outstanding FROM securities').map((r) => [
        r.id,
        r.shares_outstanding ?? 0,
      ]),
    );
  }
  return sharesCache.get(securityId) || null;
}

/** Call after securities are added or edited. */
export function invalidateSecurityCache(): void {
  sharesCache = null;
}

/** Market capitalisation in ₹ crore at the live price. */
function marketCapCr(q: LiveQuote): number | null {
  const shares = sharesOutstanding(q.securityId);
  return shares ? Math.round(((shares * q.last) / 100 / 1e7) * 100) / 100 : null;
}

export interface SecurityListItem extends QuoteDto {
  industry: string | null;
  marketCapCr: number | null;
}

function toListItem(q: LiveQuote): SecurityListItem {
  return { ...toQuoteDto(q), industry: q.industry, marketCapCr: marketCapCr(q) };
}

function searchScore(q: LiveQuote, term: string): number {
  const symbol = q.symbol.toUpperCase();
  const name = q.name.toUpperCase();
  if (symbol === term) return 100;
  if (symbol.startsWith(term)) return 80;
  if (name.startsWith(term)) return 60;
  if (name.split(/[\s&.-]+/).some((word) => word.startsWith(term))) return 50;
  if (symbol.includes(term)) return 40;
  if (name.includes(term)) return 30;
  return 0;
}

/** Type-ahead search over symbols and names, best matches first. */
export function searchSecurities(term: string, options: { type?: SecurityType; limit?: number } = {}): SecurityListItem[] {
  const needle = term.trim().toUpperCase();
  if (!needle) return [];
  return allQuotes()
    .filter((q) => !options.type || q.type === options.type)
    .map((q) => ({ q, score: searchScore(q, needle) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.q.symbol.localeCompare(b.q.symbol))
    .slice(0, options.limit ?? 10)
    .map((r) => toListItem(r.q));
}

export type SecuritySort = 'symbol' | 'name' | 'price' | 'changePercent' | 'volume' | 'marketCap';

export interface SecurityListQuery {
  q?: string;
  type?: SecurityType;
  sector?: string;
  sort?: SecuritySort;
  order?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export function listSecurities(query: SecurityListQuery): Page<SecurityListItem> {
  const needle = query.q?.trim().toUpperCase();
  let items = allQuotes()
    .filter((q) => !query.type || q.type === query.type)
    .filter((q) => !query.sector || q.sector === query.sector)
    .filter((q) => !needle || searchScore(q, needle) > 0)
    .map(toListItem);
  const sort = query.sort ?? (needle ? undefined : 'symbol');
  if (sort) {
    const direction = query.order === 'desc' ? -1 : 1;
    const value = (item: SecurityListItem): number | string => {
      switch (sort) {
        case 'name':
          return item.name;
        case 'price':
          return item.lastPrice;
        case 'changePercent':
          return item.changePercent;
        case 'volume':
          return item.volume;
        case 'marketCap':
          return item.marketCapCr ?? 0;
        default:
          return item.symbol;
      }
    };
    items = items.sort((a, b) => {
      const left = value(a);
      const right = value(b);
      return (typeof left === 'string' ? left.localeCompare(right as string) : left - (right as number)) * direction;
    });
  } else if (needle) {
    items = items.sort((a, b) => searchScore(getQuoteBySymbol(b.symbol)!, needle) - searchScore(getQuoteBySymbol(a.symbol)!, needle));
  }
  const start = (query.page - 1) * query.pageSize;
  return pageOf(items.slice(start, start + query.pageSize), items.length, query.page, query.pageSize);
}

export function listSectors(): string[] {
  return [...new Set(allQuotes().filter((q) => q.type === 'STOCK' && q.sector).map((q) => q.sector!))].sort();
}

export function requireQuote(symbol: string): LiveQuote {
  const quote = getQuoteBySymbol(symbol);
  if (!quote) throw notFound(`Security ${symbol.toUpperCase()} not found`);
  return quote;
}

function closeOnOrBefore(securityId: number, date: string): number | null {
  return (
    get<{ close: number }>(
      'SELECT close FROM price_history WHERE security_id = ? AND date <= ? ORDER BY date DESC LIMIT 1',
      securityId,
      date,
    )?.close ?? null
  );
}

const PERFORMANCE_PERIODS: [string, number][] = [
  ['1W', 7],
  ['1M', 30],
  ['3M', 91],
  ['6M', 182],
  ['1Y', 365],
  ['3Y', 1095],
  ['5Y', 1826],
];

function fiscalYearLabel(offset: number): string {
  const today = istDate();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const fy = (month >= 4 ? year + 1 : year) - 1 - offset;
  return `FY${String(fy).slice(-2)}`;
}

/** Five fiscal years of illustrative revenue and profit derived from the trailing figures. */
function syntheticFinancials(row: SecurityRow) {
  if (row.security_type !== 'STOCK' || !row.revenue_cr || !row.net_profit_cr) return [];
  const rng = createRng(hashString(`fin:${row.symbol}`));
  const revenueGrowth = 0.06 + rng() * 0.12;
  const profitGrowth = revenueGrowth + (rng() - 0.4) * 0.08;
  const rows = [];
  for (let k = 4; k >= 0; k--) {
    const noise = 1 + (rng() - 0.5) * 0.06;
    const revenue = (row.revenue_cr / (1 + revenueGrowth) ** k) * noise;
    const profit = (row.net_profit_cr / (1 + profitGrowth) ** k) * (1 + (rng() - 0.5) * 0.12);
    rows.push({
      year: fiscalYearLabel(k),
      revenueCr: Math.round(revenue),
      netProfitCr: Math.round(profit),
      netMarginPct: Math.round((profit / revenue) * 1000) / 10,
    });
  }
  return rows;
}

/** The last five fiscal years as reported to the exchange (fetched from a live data provider). */
function reportedFinancials(securityId: number) {
  const rows = all<{ period_end: string; revenue_cr: number | null; net_profit_cr: number | null }>(
    `SELECT period_end, revenue_cr, net_profit_cr FROM financials
      WHERE security_id = ? AND revenue_cr IS NOT NULL AND net_profit_cr IS NOT NULL ORDER BY period_end DESC LIMIT 5`,
    securityId,
  ).reverse();
  return rows.map((r) => ({
    // Indian companies name a fiscal year after the year in which it ends (FY26 ends in March 2026).
    year: `FY${r.period_end.slice(2, 4)}`,
    revenueCr: Math.round(r.revenue_cr!),
    netProfitCr: Math.round(r.net_profit_cr!),
    netMarginPct: r.revenue_cr ? Math.round((r.net_profit_cr! / r.revenue_cr) * 1000) / 10 : 0,
  }));
}

export interface SecurityDetail {
  /** Whether prices come from the exchange (via the live feed) or from the simulator. */
  priceSource: 'live' | 'simulated';
  /** Reported annual results, or illustrative figures derived from the reference data. */
  financialsSource: 'reported' | 'illustrative' | null;
  quote: QuoteDto;
  security: {
    symbol: string;
    name: string;
    type: SecurityType;
    exchange: string;
    sector: string | null;
    industry: string | null;
    description: string | null;
    foundedYear: number | null;
    headquarters: string | null;
    listingDate: string | null;
    faceValue: number | null;
    tickSize: number;
    circuitPct: number;
    underlyingSymbol: string | null;
    expenseRatio: number | null;
    isTradable: boolean;
    tradingStatus: 'ACTIVE' | 'HALTED';
  };
  metrics: {
    marketCapCr: number | null;
    pe: number | null;
    pb: number | null;
    eps: number | null;
    bookValue: number | null;
    dividendPerShare: number | null;
    dividendYield: number | null;
    roe: number | null;
    debtToEquity: number | null;
    beta: number | null;
    revenueCr: number | null;
    netProfitCr: number | null;
    week52High: number;
    week52Low: number;
    avgVolume20d: number | null;
    upperCircuit: number;
    lowerCircuit: number;
  };
  performance: Record<string, number | null>;
  financials: { year: string; revenueCr: number; netProfitCr: number; netMarginPct: number }[];
  memberOf: { symbol: string; name: string; weight: number }[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function getSecurityDetail(symbol: string): SecurityDetail {
  const quote = requireQuote(symbol);
  const row = get<SecurityRow>('SELECT * FROM securities WHERE id = ?', quote.securityId)!;
  const today = istDate();
  const yearAgo = addDays(today, -365);
  const range = get<{ high: number | null; low: number | null }>(
    'SELECT MAX(high) AS high, MIN(low) AS low FROM price_history WHERE security_id = ? AND date >= ?',
    quote.securityId,
    yearAgo,
  );
  const avgVolume = get<{ v: number | null }>(
    `SELECT AVG(volume) AS v FROM (SELECT volume FROM price_history WHERE security_id = ? ORDER BY date DESC LIMIT 20)`,
    quote.securityId,
  )?.v;
  const performance: Record<string, number | null> = {};
  for (const [label, days] of PERFORMANCE_PERIODS) {
    const base = closeOnOrBefore(quote.securityId, addDays(today, -days));
    performance[label] = base ? changePercent(quote.last, base) : null;
  }
  const { lower, upper } = circuitLimits(quote);
  const price = quote.last;
  const memberOf = all<{ symbol: string; name: string; weight: number }>(
    `SELECT s.symbol, s.name, ic.weight FROM index_constituents ic JOIN securities s ON s.id = ic.index_id
      WHERE ic.security_id = ? ORDER BY s.name`,
    quote.securityId,
  ).map((m) => ({ ...m, weight: round2(m.weight * 100) }));

  const reported = reportedFinancials(quote.securityId);
  const financials = reported.length > 0 ? reported : syntheticFinancials(row);
  return {
    priceSource: isExternallyPriced(quote.securityId) ? 'live' : 'simulated',
    financialsSource: financials.length === 0 ? null : reported.length > 0 ? 'reported' : 'illustrative',
    quote: toQuoteDto(quote),
    security: {
      symbol: row.symbol,
      name: row.name,
      type: row.security_type,
      exchange: row.exchange,
      sector: row.sector,
      industry: row.industry,
      description: row.description,
      foundedYear: row.founded_year,
      headquarters: row.headquarters,
      listingDate: row.listing_date,
      faceValue: toRupeesOrNull(row.face_value),
      tickSize: toRupees(row.tick_size),
      circuitPct: row.circuit_pct,
      underlyingSymbol: row.underlying_symbol,
      expenseRatio: row.expense_ratio,
      isTradable: row.is_tradable === 1,
      tradingStatus: row.trading_status,
    },
    metrics: {
      marketCapCr: marketCapCr(quote),
      pe: row.eps && row.eps > 0 ? round2(price / row.eps) : null,
      pb: row.book_value && row.book_value > 0 ? round2(price / row.book_value) : null,
      eps: toRupeesOrNull(row.eps),
      bookValue: toRupeesOrNull(row.book_value),
      dividendPerShare: toRupeesOrNull(row.dividend_per_share),
      dividendYield: row.dividend_per_share ? round2((row.dividend_per_share / price) * 100) : null,
      roe: row.roe,
      debtToEquity: row.debt_to_equity,
      beta: row.beta,
      revenueCr: row.revenue_cr,
      netProfitCr: row.net_profit_cr,
      week52High: toRupees(Math.max(range?.high ?? 0, quote.high)),
      week52Low: toRupees(Math.min(range?.low ?? Number.MAX_SAFE_INTEGER, quote.low)),
      avgVolume20d: avgVolume ? Math.round(avgVolume) : null,
      upperCircuit: toRupees(upper),
      lowerCircuit: toRupees(lower),
    },
    performance,
    financials,
    memberOf,
  };
}

export interface Candle {
  time: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const HISTORY_RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y', '3Y', '5Y'] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

interface CandleRow {
  ts?: number;
  date?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function toCandle(row: CandleRow, time: number | string): Candle {
  return {
    time,
    open: toRupees(row.open),
    high: toRupees(row.high),
    low: toRupees(row.low),
    close: toRupees(row.close),
    volume: row.volume,
  };
}

function aggregate<T extends CandleRow>(rows: T[], keyOf: (row: T) => number | string): Candle[] {
  const groups = new Map<number | string, CandleRow>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (!group) groups.set(key, { ...row });
    else {
      group.high = Math.max(group.high, row.high);
      group.low = Math.min(group.low, row.low);
      group.close = row.close;
      group.volume += row.volume;
    }
  }
  return [...groups.entries()].map(([key, row]) => toCandle(row, key));
}

/** Monday of the week containing the given date. */
function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

/**
 * Price history for charts. Intraday ranges return epoch-second times; daily and weekly ranges return
 * YYYY-MM-DD dates. Daily ranges end with today's live candle.
 */
export function getPriceHistory(symbol: string, range: HistoryRange): { symbol: string; range: HistoryRange; interval: string; candles: Candle[] } {
  const quote = requireQuote(symbol);
  const id = quote.securityId;
  const tradingDate = currentTradingDate();

  if (range === '1D' || range === '1W') {
    const from = range === '1D' ? istDayStart(tradingDate) : nowMs() - 7 * 86_400_000;
    const rows = all<CandleRow & { ts: number }>(
      'SELECT ts, open, high, low, close, volume FROM intraday_prices WHERE security_id = ? AND ts >= ? ORDER BY ts',
      id,
      from,
    );
    if (range === '1D') {
      return { symbol: quote.symbol, range, interval: '5m', candles: rows.map((r) => toCandle(r, Math.floor(r.ts / 1000))) };
    }
    const bucket = 30 * 60_000;
    return {
      symbol: quote.symbol,
      range,
      interval: '30m',
      candles: aggregate(rows, (r) => Math.floor(Math.floor(r.ts / bucket) * bucket) / 1000),
    };
  }

  const days = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, '3Y': 1096, '5Y': 1827 }[range];
  const rows = all<CandleRow & { date: string }>(
    `SELECT date, open, high, low, close, volume FROM price_history
      WHERE security_id = ? AND date >= ? AND date < ? ORDER BY date`,
    id,
    addDays(tradingDate, -days),
    tradingDate,
  );
  rows.push({ date: tradingDate, open: quote.open, high: quote.high, low: quote.low, close: quote.last, volume: quote.volume });
  if (range === '5Y') {
    return { symbol: quote.symbol, range, interval: '1w', candles: aggregate(rows, (r) => weekStart(r.date)) };
  }
  return { symbol: quote.symbol, range, interval: '1d', candles: rows.map((r) => toCandle(r, r.date)) };
}

export type MoverKind = 'gainers' | 'losers' | 'active' | 'value';

export function getMovers(kind: MoverKind, limit = 10): SecurityListItem[] {
  const stocks = allQuotes().filter((q) => q.type === 'STOCK' && q.tradingStatus === 'ACTIVE');
  const pct = (q: LiveQuote) => changePercent(q.last, q.prevClose);
  const sorted = {
    gainers: () => stocks.filter((q) => q.last > q.prevClose).sort((a, b) => pct(b) - pct(a)),
    losers: () => stocks.filter((q) => q.last < q.prevClose).sort((a, b) => pct(a) - pct(b)),
    active: () => [...stocks].sort((a, b) => b.volume - a.volume),
    value: () => [...stocks].sort((a, b) => b.turnover - a.turnover),
  }[kind]();
  return sorted.slice(0, limit).map(toListItem);
}

export interface SectorPerformance {
  sector: string;
  changePercent: number;
  advances: number;
  declines: number;
  count: number;
  marketCapCr: number;
  topGainer: string | null;
  topLoser: string | null;
}

/** Market-cap weighted change of each sector. */
export function getSectorPerformance(): SectorPerformance[] {
  const groups = new Map<string, LiveQuote[]>();
  for (const q of allQuotes()) {
    if (q.type !== 'STOCK' || !q.sector) continue;
    groups.set(q.sector, [...(groups.get(q.sector) ?? []), q]);
  }
  return [...groups.entries()]
    .map(([sector, quotes]) => {
      let weighted = 0;
      let totalCap = 0;
      for (const q of quotes) {
        const cap = marketCapCr(q) ?? 0;
        weighted += cap * changePercent(q.last, q.prevClose);
        totalCap += cap;
      }
      const byChange = [...quotes].sort((a, b) => changePercent(b.last, b.prevClose) - changePercent(a.last, a.prevClose));
      return {
        sector,
        changePercent: totalCap ? round2(weighted / totalCap) : 0,
        advances: quotes.filter((q) => q.last > q.prevClose).length,
        declines: quotes.filter((q) => q.last < q.prevClose).length,
        count: quotes.length,
        marketCapCr: Math.round(totalCap),
        topGainer: byChange[0]?.symbol ?? null,
        topLoser: byChange[byChange.length - 1]?.symbol ?? null,
      };
    })
    .sort((a, b) => b.changePercent - a.changePercent);
}

export function getMarketBreadth() {
  const quotes = allQuotes().filter((q) => q.type !== 'INDEX');
  return {
    advances: quotes.filter((q) => q.last > q.prevClose).length,
    declines: quotes.filter((q) => q.last < q.prevClose).length,
    unchanged: quotes.filter((q) => q.last === q.prevClose).length,
    total: quotes.length,
  };
}

export interface IndexSummary extends QuoteDto {
  sparkline: number[];
  constituents: number;
}

export function getIndices(): IndexSummary[] {
  const from = istDayStart(currentTradingDate());
  const indices = allQuotes()
    .filter((q) => q.type === 'INDEX')
    .sort((a, b) => a.securityId - b.securityId);
  return indices.map((q) => {
    const closes = all<{ close: number }>(
      'SELECT close FROM intraday_prices WHERE security_id = ? AND ts >= ? ORDER BY ts',
      q.securityId,
      from,
    ).map((r) => toRupees(r.close));
    const step = Math.max(1, Math.ceil(closes.length / 60));
    const sparkline = closes.filter((_, i) => i % step === 0);
    sparkline.push(toRupees(q.last));
    const constituents = get<{ n: number }>('SELECT COUNT(*) AS n FROM index_constituents WHERE index_id = ?', q.securityId)!.n;
    return { ...toQuoteDto(q), sparkline, constituents };
  });
}

export function getIndexConstituents(symbol: string) {
  const index = requireQuote(symbol);
  if (index.type !== 'INDEX') throw notFound(`${index.symbol} is not an index`);
  const rows = all<{ security_id: number; weight: number }>(
    'SELECT security_id, weight FROM index_constituents WHERE index_id = ? ORDER BY weight DESC',
    index.securityId,
  );
  return rows
    .map((row) => {
      const q = getQuote(row.security_id)!;
      const pct = changePercent(q.last, q.prevClose);
      return {
        ...toListItem(q),
        weight: round2(row.weight * 100),
        // Approximate contribution to the index move, in percentage points.
        contribution: round2(row.weight * pct),
      };
    })
    .sort((a, b) => b.weight - a.weight);
}

function sessionDescription(): string {
  const session = marketSession();
  if (session.source === 'simulated') return 'Simulated market, open 24×7';
  const delay = session.delayMinutes > 0 ? `, ${session.delayMinutes} min delayed` : '';
  if (session.phase === 'OPEN') return `Market open · NSE prices${delay}`;
  if (session.phase === 'PRE_OPEN') return 'Pre-open session · trading starts at 9:15 am IST';
  return 'Market closed · NSE trades 9:15 am – 3:30 pm IST on weekdays';
}

export function getMarketStatus() {
  const session = marketSession();
  const simulated = session.source === 'simulated';
  return {
    status: session.phase === 'OPEN' || simulated ? ('OPEN' as const) : ('CLOSED' as const),
    phase: simulated ? ('OPEN' as const) : session.phase,
    session: sessionDescription(),
    simulated,
    source: simulated ? 'Simulated' : 'Yahoo Finance',
    delayMinutes: session.delayMinutes,
    asOf: session.asOf ? new Date(session.asOf).toISOString() : null,
    feedError: session.lastError,
    live: simulated ? isSimulationRunning() : session.lastError === null,
    tradingDate: currentTradingDate(),
    tickIntervalMs: simulated ? config.tickIntervalMs : config.livePollMs,
    serverTime: nowIso(),
  };
}

export function getMarketOverview() {
  return {
    status: getMarketStatus(),
    indices: getIndices(),
    breadth: getMarketBreadth(),
    gainers: getMovers('gainers', 5),
    losers: getMovers('losers', 5),
    active: getMovers('active', 5),
    sectors: getSectorPerformance(),
  };
}
