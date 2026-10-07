import { get, run, transaction } from '../db/index.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { createRng, gaussian, hashString } from '../lib/rng.js';
import { addDays, isWeekend, istDate, istDayStart } from '../lib/time.js';
import { FUNDS, INDICES, STOCKS, type FundSeed, type StockSeed } from './catalog.js';

export const BAR_MS = 5 * 60_000;
export const BARS_PER_DAY = (24 * 60 * 60_000) / BAR_MS;

/** Tick size in paise: ₹0.01 below ₹250, ₹0.05 otherwise. */
export function tickSizeFor(priceRupees: number): number {
  return priceRupees < 250 ? 1 : 5;
}

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Bar extends Candle {
  ts: number;
}

interface Series {
  symbol: string;
  /** Daily candles aligned with the shared date axis; null before the listing date. Last entry is today. */
  daily: (Candle | null)[];
  /** Five-minute bars for the most recent days, keyed by date. */
  intraday: Map<string, Bar[]>;
}

interface PrimarySpec {
  symbol: string;
  price: number;
  volatility: number;
  beta: number;
  avgVolume: number;
  listingDate?: string;
}

interface SeedOptions {
  seed?: number;
  years?: number;
  intradayDays?: number;
}

const TRADING_DAYS_PER_YEAR = 252;
const MARKET_DAILY_VOL = 0.0085;
const MARKET_DAILY_DRIFT = 0.00028;

function buildDateAxis(today: string, years: number): string[] {
  const dates: string[] = [];
  let date = addDays(today, -Math.round(years * 365.25));
  while (date < today) {
    if (!isWeekend(date)) dates.push(date);
    date = addDays(date, 1);
  }
  dates.push(today);
  return dates;
}

/** Log-space Brownian bridge from `from` to `to` in `steps` steps. */
function bridge(rng: () => number, from: number, to: number, steps: number, stepVol: number): number[] {
  const walk = [0];
  for (let i = 1; i <= steps; i++) walk.push(walk[i - 1]! + gaussian(rng) * stepVol);
  const end = walk[steps]!;
  const logFrom = Math.log(from);
  const logTo = Math.log(to);
  return walk.map((w, i) => Math.exp(logFrom + (logTo - logFrom) * (i / steps) + w - (end * i) / steps));
}

function generateBars(
  rng: () => number,
  dayStart: number,
  open: number,
  close: number,
  dailyVol: number,
  barCount: number,
  dayVolume: number,
): Bar[] {
  const stepVol = (dailyVol * 0.9) / Math.sqrt(BARS_PER_DAY);
  const path = bridge(rng, open, close, barCount, stepVol);
  const bars: Bar[] = [];
  for (let i = 0; i < barCount; i++) {
    const barOpen = path[i]!;
    const barClose = path[i + 1]!;
    const wiggle = () => Math.exp(Math.abs(gaussian(rng)) * stepVol * 0.6);
    bars.push({
      ts: dayStart + i * BAR_MS,
      open: barOpen,
      close: barClose,
      high: Math.max(barOpen, barClose) * wiggle(),
      low: Math.min(barOpen, barClose) / wiggle(),
      volume: Math.max(0, Math.round((dayVolume / barCount) * Math.exp(gaussian(rng) * 0.5 - 0.125))),
    });
  }
  return bars;
}

function summarizeBars(bars: Bar[]): Candle {
  return {
    open: bars[0]!.open,
    close: bars[bars.length - 1]!.close,
    high: Math.max(...bars.map((b) => b.high)),
    low: Math.min(...bars.map((b) => b.low)),
    volume: bars.reduce((sum, b) => sum + b.volume, 0),
  };
}

/** Simulates a security that moves with the market factor plus its own idiosyncratic noise. */
function generatePrimarySeries(
  spec: PrimarySpec,
  dates: string[],
  marketReturns: number[],
  intradayDates: Set<string>,
  todayBars: number,
  seed: number,
): Series {
  const rng = createRng(hashString(spec.symbol) ^ seed);
  const n = dates.length;
  const dailyVol = spec.volatility / Math.sqrt(TRADING_DAYS_PER_YEAR);
  const idioVol = Math.sqrt(Math.max(dailyVol ** 2 - spec.beta ** 2 * MARKET_DAILY_VOL ** 2, (0.3 * dailyVol) ** 2));
  const drift = spec.volatility < 0.01 ? 0 : gaussian(rng) * 0.0003 + 0.00005;

  const returns = dates.map((_, t) => spec.beta * marketReturns[t]! + gaussian(rng) * idioVol + drift);
  const closes = new Array<number>(n);
  closes[n - 1] = spec.price;
  for (let t = n - 1; t > 0; t--) closes[t - 1] = closes[t]! / Math.exp(returns[t]!);

  const daily: (Candle | null)[] = [];
  const intraday = new Map<string, Bar[]>();
  for (let t = 0; t < n; t++) {
    const date = dates[t]!;
    if (spec.listingDate && date < spec.listingDate) {
      daily.push(null);
      continue;
    }
    const close = closes[t]!;
    const prevClose = t > 0 ? closes[t - 1]! : close / Math.exp(returns[t]!);
    const open = prevClose * Math.exp(gaussian(rng) * dailyVol * 0.3);
    const volume = Math.round(
      spec.avgVolume * Math.exp(gaussian(rng) * 0.3 - 0.045) * (0.7 + (0.3 * Math.abs(returns[t]!)) / dailyVol),
    );
    if (intradayDates.has(date)) {
      const isToday = t === n - 1;
      const barCount = isToday ? todayBars : BARS_PER_DAY;
      const dayVolume = isToday ? Math.round((volume * barCount) / BARS_PER_DAY) : volume;
      const bars = generateBars(rng, istDayStart(date), open, close, dailyVol, barCount, dayVolume);
      intraday.set(date, bars);
      daily.push(summarizeBars(bars));
    } else {
      const spread = () => Math.exp(Math.abs(gaussian(rng)) * dailyVol * 0.5);
      daily.push({
        open,
        close,
        high: Math.max(open, close) * spread(),
        low: Math.min(open, close) / spread(),
        volume,
      });
    }
  }
  return { symbol: spec.symbol, daily, intraday };
}

interface IndexComponent {
  series: Series;
  weight: number;
  basePrice: number;
}

/** Cap-weighted index: value = base × Σ wᵢ · Pᵢ(t) / Pᵢ(now). */
function generateIndexSeries(symbol: string, value: number, components: IndexComponent[], dates: string[]): Series {
  const combine = (pick: (c: IndexComponent) => number | null): number | null => {
    let total = 0;
    for (const component of components) {
      const price = pick(component);
      if (price === null) return null;
      total += (component.weight * price) / component.basePrice;
    }
    return value * total;
  };

  const daily: (Candle | null)[] = dates.map((_, t) => {
    const close = combine((c) => c.series.daily[t]?.close ?? null);
    const open = combine((c) => c.series.daily[t]?.open ?? null);
    const high = combine((c) => c.series.daily[t]?.high ?? null);
    const low = combine((c) => c.series.daily[t]?.low ?? null);
    if (close === null || open === null || high === null || low === null) return null;
    return { open, close, high: Math.max(high, open, close), low: Math.min(low, open, close), volume: 0 };
  });

  const intraday = new Map<string, Bar[]>();
  const first = components[0]!.series;
  for (const [date, firstBars] of first.intraday) {
    const bars: Bar[] = firstBars.map((bar, i) => {
      const at = (key: keyof Candle) => combine((c) => c.series.intraday.get(date)?.[i]?.[key] ?? null)!;
      const open = at('open');
      const close = at('close');
      return { ts: bar.ts, open, close, high: Math.max(at('high'), open, close), low: Math.min(at('low'), open, close), volume: 0 };
    });
    intraday.set(date, bars);
    const t = dates.indexOf(date);
    if (t >= 0) daily[t] = summarizeBars(bars);
  }
  return { symbol, daily, intraday };
}

/** ETF whose price follows an index with a small tracking error. */
function generateTrackingSeries(fund: FundSeed, index: Series, dates: string[], seed: number): Series {
  const rng = createRng(hashString(fund.symbol) ^ seed);
  const last = dates.length - 1;
  const ratio = fund.price / index.daily[last]!.close;
  const noise = () => 1 + gaussian(rng) * 0.0004;
  const scale = (c: Candle, volume: number): Candle => {
    const open = c.open * ratio * noise();
    const close = c.close * ratio * noise();
    return { open, close, high: Math.max(open, close, c.high * ratio), low: Math.min(open, close, c.low * ratio), volume };
  };
  const dailyVolume = () => Math.round(fund.avgVolume * Math.exp(gaussian(rng) * 0.3 - 0.045));
  const daily = index.daily.map((c) => (c ? scale(c, dailyVolume()) : null));
  daily[last]!.close = fund.price;

  const intraday = new Map<string, Bar[]>();
  for (const [date, bars] of index.intraday) {
    const barVolume = () => Math.round((fund.avgVolume / BARS_PER_DAY) * Math.exp(gaussian(rng) * 0.5 - 0.125));
    const scaled = bars.map((bar) => ({ ...scale(bar, barVolume()), ts: bar.ts }));
    if (date === dates[last]) scaled[scaled.length - 1]!.close = fund.price;
    intraday.set(date, scaled);
    daily[dates.indexOf(date)] = summarizeBars(scaled);
  }
  return { symbol: fund.symbol, daily, intraday };
}

function toPaiseCandle(candle: Candle, tick: number): Candle {
  const round = (v: number) => Math.max(tick, Math.round((v * 100) / tick) * tick);
  const open = round(candle.open);
  const close = round(candle.close);
  return {
    open,
    close,
    high: Math.max(open, close, Math.ceil((candle.high * 100) / tick) * tick),
    low: Math.max(tick, Math.min(open, close, Math.floor((candle.low * 100) / tick) * tick)),
    volume: candle.volume,
  };
}

function insertSecurity(values: Record<string, unknown>): number {
  const keys = Object.keys(values);
  const now = nowIso();
  const result = run(
    `INSERT INTO securities (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map(() => '?').join(', ')}, ?, ?)`,
    ...keys.map((k) => values[k]),
    now,
    now,
  );
  return Number(result.lastInsertRowid);
}

function stockFundamentals(stock: StockSeed) {
  const profitCr = stock.marketCapCr / stock.pe;
  return {
    face_value: (stock.faceValue ?? 1) * 100,
    shares_outstanding: Math.round((stock.marketCapCr * 1e7) / stock.price),
    eps: Math.round((stock.price / stock.pe) * 100),
    book_value: Math.round((stock.price / stock.pb) * 100),
    dividend_per_share: Math.round(stock.price * stock.dividendYield),
    roe: Math.round((stock.pb / stock.pe) * 10_000) / 100,
    debt_to_equity: stock.debtToEquity,
    beta: stock.beta,
    revenue_cr: Math.round(profitCr / (stock.netMargin / 100)),
    net_profit_cr: Math.round(profitCr),
  };
}

/** Populates securities, indices, five years of daily history, recent intraday bars and live quotes. */
export function seedMarket(options: SeedOptions = {}): void {
  if (get<{ n: number }>('SELECT COUNT(*) AS n FROM securities')!.n > 0) return;
  const seed = options.seed ?? 1234;
  const years = options.years ?? 5;
  const intradayDays = options.intradayDays ?? 5;

  const now = nowMs();
  const today = istDate(now);
  const dates = buildDateAxis(today, years);
  const intradayDates = new Set(dates.slice(-(intradayDays + 1)));
  const todayBars = Math.min(BARS_PER_DAY, Math.floor((now - istDayStart(today)) / BAR_MS) + 1);

  const marketRng = createRng(seed);
  const marketReturns = dates.map(() => {
    const shock = marketRng() < 0.015 ? 2.5 : 1;
    return MARKET_DAILY_DRIFT + gaussian(marketRng) * MARKET_DAILY_VOL * shock;
  });

  const series = new Map<string, Series>();
  for (const stock of STOCKS) {
    series.set(stock.symbol, generatePrimarySeries(stock, dates, marketReturns, intradayDates, todayBars, seed));
  }
  for (const fund of FUNDS) {
    if (!fund.underlying) {
      series.set(fund.symbol, generatePrimarySeries(fund, dates, marketReturns, intradayDates, todayBars, seed));
    }
  }

  const stockBySymbol = new Map(STOCKS.map((stock) => [stock.symbol, stock]));
  const indexComponents = new Map<string, IndexComponent[]>();
  for (const index of INDICES) {
    const caps = index.constituents.map((symbol) => stockBySymbol.get(symbol)!.marketCapCr);
    const totalCap = caps.reduce((a, b) => a + b, 0);
    const components = index.constituents.map((symbol, i) => ({
      series: series.get(symbol)!,
      weight: caps[i]! / totalCap,
      basePrice: stockBySymbol.get(symbol)!.price,
    }));
    indexComponents.set(index.symbol, components);
    series.set(index.symbol, generateIndexSeries(index.symbol, index.value, components, dates));
  }
  for (const fund of FUNDS) {
    if (fund.underlying) series.set(fund.symbol, generateTrackingSeries(fund, series.get(fund.underlying)!, dates, seed));
  }

  transaction(() => {
    const ids = new Map<string, number>();
    const ticks = new Map<string, number>();

    for (const stock of STOCKS) {
      const tick = tickSizeFor(stock.price);
      ticks.set(stock.symbol, tick);
      ids.set(
        stock.symbol,
        insertSecurity({
          symbol: stock.symbol,
          name: stock.name,
          security_type: 'STOCK',
          exchange: 'NSE',
          sector: stock.sector,
          industry: stock.industry,
          description: stock.description,
          founded_year: stock.founded,
          headquarters: stock.headquarters,
          ...stockFundamentals(stock),
          tick_size: tick,
          circuit_pct: stock.circuitPct ?? 20,
          volatility: stock.volatility,
          avg_volume: stock.avgVolume,
          listing_date: stock.listingDate ?? null,
        }),
      );
    }
    for (const fund of FUNDS) {
      const tick = tickSizeFor(fund.price);
      ticks.set(fund.symbol, tick);
      ids.set(
        fund.symbol,
        insertSecurity({
          symbol: fund.symbol,
          name: fund.name,
          security_type: fund.type,
          exchange: 'NSE',
          sector: fund.sector,
          industry: fund.industry,
          description: fund.description,
          founded_year: fund.founded,
          headquarters: fund.headquarters,
          dividend_per_share: fund.dividendYield ? Math.round(fund.price * fund.dividendYield) : null,
          expense_ratio: fund.expenseRatio ?? null,
          beta: fund.beta,
          face_value: fund.type === 'ETF' ? null : 10_000,
          tick_size: tick,
          circuit_pct: fund.volatility < 0.01 ? 5 : 20,
          volatility: fund.volatility,
          avg_volume: fund.avgVolume,
          underlying_symbol: fund.underlying ?? null,
          listing_date: fund.listingDate ?? null,
        }),
      );
    }
    for (const index of INDICES) {
      ticks.set(index.symbol, 1);
      ids.set(
        index.symbol,
        insertSecurity({
          symbol: index.symbol,
          name: index.name,
          security_type: 'INDEX',
          exchange: index.exchange,
          sector: 'Index',
          industry: 'Market Index',
          description: index.description,
          tick_size: 1,
          circuit_pct: 100,
          volatility: 0.15,
          index_base_value: Math.round(index.value * 100),
          is_tradable: 0,
        }),
      );
      for (const component of indexComponents.get(index.symbol)!) {
        run(
          'INSERT INTO index_constituents (index_id, security_id, weight, base_price) VALUES (?, ?, ?, ?)',
          ids.get(index.symbol),
          ids.get(component.series.symbol),
          component.weight,
          Math.round(component.basePrice * 100),
        );
      }
    }

    const updatedAt = nowIso();
    for (const [symbol, data] of series) {
      const id = ids.get(symbol)!;
      const tick = ticks.get(symbol)!;
      for (let t = 0; t < dates.length - 1; t++) {
        const candle = data.daily[t];
        if (!candle) continue;
        const c = toPaiseCandle(candle, tick);
        run(
          'INSERT INTO price_history (security_id, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id,
          dates[t],
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume,
        );
      }
      for (const bars of data.intraday.values()) {
        for (const bar of bars) {
          const c = toPaiseCandle(bar, tick);
          run(
            'INSERT INTO intraday_prices (security_id, ts, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)',
            id,
            bar.ts,
            c.open,
            c.high,
            c.low,
            c.close,
            c.volume,
          );
        }
      }
      const todayCandle = toPaiseCandle(data.daily[dates.length - 1]!, tick);
      const prev = data.daily[dates.length - 2];
      const prevClose = prev ? toPaiseCandle(prev, tick).close : todayCandle.open;
      const avgPrice = (todayCandle.open + todayCandle.close) / 2 / 100;
      run(
        `INSERT INTO quotes (security_id, last_price, prev_close, open, high, low, volume, turnover, trading_date, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        todayCandle.close,
        prevClose,
        todayCandle.open,
        todayCandle.high,
        todayCandle.low,
        todayCandle.volume,
        Math.round(todayCandle.volume * avgPrice * 100),
        today,
        updatedAt,
      );
    }
    run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('state:tradingDate', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      today,
      updatedAt,
    );
  });
}
