import { all, run } from '../db/index.js';
import { changePercent, toRupees } from '../lib/money.js';

export type SecurityType = 'STOCK' | 'ETF' | 'REIT' | 'INVIT' | 'INDEX';

/** Live market state for one security, kept in memory and persisted to the quotes table. */
export interface LiveQuote {
  securityId: number;
  symbol: string;
  name: string;
  type: SecurityType;
  exchange: string;
  sector: string | null;
  industry: string | null;
  isTradable: boolean;
  tradingStatus: 'ACTIVE' | 'HALTED';
  tickSize: number;
  circuitPct: number;
  volatility: number;
  avgVolume: number;
  beta: number;
  underlyingSymbol: string | null;
  last: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  tradingDate: string;
  updatedAt: number;
}

export interface QuoteDto {
  symbol: string;
  name: string;
  type: SecurityType;
  exchange: string;
  sector: string | null;
  lastPrice: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePercent: number;
  volume: number;
  turnover: number;
  tradingStatus: 'ACTIVE' | 'HALTED';
  isTradable: boolean;
  updatedAt: string;
}

interface QuoteJoinRow {
  security_id: number;
  symbol: string;
  name: string;
  security_type: SecurityType;
  exchange: string;
  sector: string | null;
  industry: string | null;
  is_tradable: number;
  trading_status: 'ACTIVE' | 'HALTED';
  tick_size: number;
  circuit_pct: number;
  volatility: number;
  avg_volume: number;
  beta: number | null;
  underlying_symbol: string | null;
  last_price: number;
  prev_close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  trading_date: string;
  updated_at: string;
}

const byId = new Map<number, LiveQuote>();
const bySymbol = new Map<string, LiveQuote>();

const SELECT_QUOTES = `
  SELECT q.*, s.symbol, s.name, s.security_type, s.exchange, s.sector, s.industry, s.is_tradable, s.trading_status,
         s.tick_size, s.circuit_pct, s.volatility, s.avg_volume, s.beta, s.underlying_symbol
    FROM quotes q JOIN securities s ON s.id = q.security_id`;

function fromRow(row: QuoteJoinRow): LiveQuote {
  return {
    securityId: row.security_id,
    symbol: row.symbol,
    name: row.name,
    type: row.security_type,
    exchange: row.exchange,
    sector: row.sector,
    industry: row.industry,
    isTradable: row.is_tradable === 1,
    tradingStatus: row.trading_status,
    tickSize: row.tick_size,
    circuitPct: row.circuit_pct,
    volatility: row.volatility,
    avgVolume: row.avg_volume,
    beta: row.beta ?? 1,
    underlyingSymbol: row.underlying_symbol,
    last: row.last_price,
    prevClose: row.prev_close,
    open: row.open,
    high: row.high,
    low: row.low,
    volume: row.volume,
    turnover: row.turnover,
    tradingDate: row.trading_date,
    updatedAt: Date.parse(row.updated_at),
  };
}

function index(quote: LiveQuote): void {
  byId.set(quote.securityId, quote);
  bySymbol.set(quote.symbol.toUpperCase(), quote);
}

export function loadQuotes(): void {
  byId.clear();
  bySymbol.clear();
  for (const row of all<QuoteJoinRow>(SELECT_QUOTES)) index(fromRow(row));
}

/** Refreshes one security after reference data changed (admin edit, new listing). */
export function reloadQuote(securityId: number): LiveQuote | undefined {
  const existing = byId.get(securityId);
  if (existing) bySymbol.delete(existing.symbol.toUpperCase());
  const row = all<QuoteJoinRow>(`${SELECT_QUOTES} WHERE q.security_id = ?`, securityId)[0];
  if (!row) {
    byId.delete(securityId);
    return undefined;
  }
  const quote = fromRow(row);
  // Keep live intraday values that may not be persisted yet.
  if (existing) Object.assign(quote, { last: existing.last, high: existing.high, low: existing.low, volume: existing.volume, turnover: existing.turnover, open: existing.open, prevClose: existing.prevClose });
  index(quote);
  return quote;
}

export function getQuote(securityId: number): LiveQuote | undefined {
  return byId.get(securityId);
}

export function getQuoteBySymbol(symbol: string): LiveQuote | undefined {
  return bySymbol.get(symbol.toUpperCase());
}

export function allQuotes(): LiveQuote[] {
  return [...byId.values()];
}

export function persistQuotes(quotes: LiveQuote[]): void {
  for (const q of quotes) {
    run(
      `UPDATE quotes SET last_price = ?, prev_close = ?, open = ?, high = ?, low = ?, volume = ?, turnover = ?,
         trading_date = ?, updated_at = ? WHERE security_id = ?`,
      q.last,
      q.prevClose,
      q.open,
      q.high,
      q.low,
      q.volume,
      q.turnover,
      q.tradingDate,
      new Date(q.updatedAt).toISOString(),
      q.securityId,
    );
  }
}

/** Daily price band: orders and prices must stay within ±circuit% of the previous close. */
export function circuitLimits(quote: LiveQuote): { lower: number; upper: number } {
  const band = quote.circuitPct / 100;
  const tick = quote.tickSize;
  return {
    lower: Math.max(tick, Math.ceil((quote.prevClose * (1 - band)) / tick) * tick),
    upper: Math.floor((quote.prevClose * (1 + band)) / tick) * tick,
  };
}

export function toQuoteDto(q: LiveQuote): QuoteDto {
  return {
    symbol: q.symbol,
    name: q.name,
    type: q.type,
    exchange: q.exchange,
    sector: q.sector,
    lastPrice: toRupees(q.last),
    prevClose: toRupees(q.prevClose),
    open: toRupees(q.open),
    high: toRupees(q.high),
    low: toRupees(q.low),
    change: toRupees(q.last - q.prevClose),
    changePercent: changePercent(q.last, q.prevClose),
    volume: q.volume,
    turnover: toRupees(q.turnover),
    tradingStatus: q.tradingStatus,
    isTradable: q.isTradable,
    updatedAt: new Date(q.updatedAt).toISOString(),
  };
}

/** Compact tick payload for the live stream: [symbol, last, change, changePercent, high, low, volume]. */
export type TickTuple = [string, number, number, number, number, number, number];

export function toTickTuple(q: LiveQuote): TickTuple {
  return [
    q.symbol,
    toRupees(q.last),
    toRupees(q.last - q.prevClose),
    changePercent(q.last, q.prevClose),
    toRupees(q.high),
    toRupees(q.low),
    q.volume,
  ];
}
