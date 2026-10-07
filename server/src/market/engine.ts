import { config } from '../config.js';
import { all, run, transaction } from '../db/index.js';
import { nowMs } from '../lib/clock.js';
import { gaussian } from '../lib/rng.js';
import { DAY_MS, istDate } from '../lib/time.js';
import { bus } from '../services/events.js';
import { getState, setState } from '../services/settings.service.js';
import {
  allQuotes,
  circuitLimits,
  getQuote,
  getQuoteBySymbol,
  loadQuotes,
  persistQuotes,
  toTickTuple,
  type LiveQuote,
} from './quoteStore.js';
import { BAR_MS } from './seedMarket.js';

interface PriceState {
  /** Slow-moving log price that carries the trend. */
  logAnchor: number;
  /** Mean-reverting short-term deviation that makes prices wiggle visibly. */
  deviation: number;
  driftPerTick: number;
}

interface Bar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface IndexComponent {
  securityId: number;
  weight: number;
  basePrice: number;
}

type TickListener = (changed: LiveQuote[]) => void;
type RolloverListener = (previousDate: string, newDate: string) => void;

const TRADING_DAYS_PER_YEAR = 252;
/** Time constant of the short-term deviation (8 minutes). */
const DEVIATION_TAU_MS = 8 * 60_000;
const INTRADAY_RETENTION_DAYS = 8;

const priceState = new Map<number, PriceState>();
const trackingRatio = new Map<number, number>();
const currentBars = new Map<number, Bar>();
let indexComponents = new Map<number, IndexComponent[]>();
let tradingDate = '';
let timer: NodeJS.Timeout | null = null;
const tickListeners: TickListener[] = [];
const rolloverListeners: RolloverListener[] = [];

const ticksPerDay = () => DAY_MS / config.tickIntervalMs;
const dailyVol = (q: LiveQuote) => q.volatility / Math.sqrt(TRADING_DAYS_PER_YEAR);

const isIndex = (q: LiveQuote) => q.type === 'INDEX';
const isTracking = (q: LiveQuote) => !isIndex(q) && q.underlyingSymbol !== null;
const isPrimary = (q: LiveQuote) => !isIndex(q) && q.underlyingSymbol === null;

export function onMarketTick(listener: TickListener): void {
  tickListeners.push(listener);
}

export function onMarketRollover(listener: RolloverListener): void {
  rolloverListeners.push(listener);
}

export function currentTradingDate(): string {
  return tradingDate || istDate();
}

function roundToTick(paise: number, tick: number): number {
  return Math.max(tick, Math.round(paise / tick) * tick);
}

function newDayDrifts(): void {
  const marketMove = 0.0004 + gaussian() * 0.006;
  for (const q of allQuotes()) {
    if (!isPrimary(q)) continue;
    const state = priceState.get(q.securityId);
    if (!state) continue;
    const vol = dailyVol(q);
    const idioVol = Math.sqrt(Math.max(vol ** 2 - q.beta ** 2 * 0.0085 ** 2, (0.3 * vol) ** 2));
    const dayTarget = q.beta * marketMove + gaussian() * idioVol * 0.5;
    state.driftPerTick = dayTarget / ticksPerDay();
  }
}

function resetState(q: LiveQuote): void {
  priceState.set(q.securityId, { logAnchor: Math.log(q.last), deviation: 0, driftPerTick: 0 });
}

function loadIndexComponents(): void {
  const rows = all<{ index_id: number; security_id: number; weight: number; base_price: number }>(
    'SELECT index_id, security_id, weight, base_price FROM index_constituents',
  );
  indexComponents = new Map();
  for (const row of rows) {
    const list = indexComponents.get(row.index_id) ?? [];
    list.push({ securityId: row.security_id, weight: row.weight, basePrice: row.base_price });
    indexComponents.set(row.index_id, list);
  }
}

function indexBaseValue(indexId: number): number {
  return all<{ index_base_value: number }>('SELECT index_base_value FROM securities WHERE id = ?', indexId)[0]?.index_base_value ?? 0;
}

const indexBaseCache = new Map<number, number>();

function computeIndexValue(q: LiveQuote): number {
  const components = indexComponents.get(q.securityId);
  if (!components?.length) return q.last;
  let base = indexBaseCache.get(q.securityId);
  if (base === undefined) {
    base = indexBaseValue(q.securityId);
    indexBaseCache.set(q.securityId, base);
  }
  let total = 0;
  for (const component of components) {
    const price = getQuote(component.securityId)?.last ?? component.basePrice;
    total += (component.weight * price) / component.basePrice;
  }
  return Math.max(1, Math.round(base * total));
}

/** Loads live quotes and prepares simulation state. Safe to call more than once. */
export function initMarket(): void {
  loadQuotes();
  loadIndexComponents();
  indexBaseCache.clear();
  priceState.clear();
  trackingRatio.clear();
  currentBars.clear();
  for (const q of allQuotes()) {
    if (isPrimary(q)) resetState(q);
  }
  refreshTrackingRatios();
  tradingDate = getState('tradingDate') ?? allQuotes()[0]?.tradingDate ?? istDate();
  const bucket = Math.floor(nowMs() / BAR_MS) * BAR_MS;
  for (const bar of all<Bar & { security_id: number }>('SELECT * FROM intraday_prices WHERE ts = ?', bucket)) {
    currentBars.set(bar.security_id, { ts: bar.ts, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
  }
  newDayDrifts();
  if (tradingDate < istDate()) rollover(istDate());
}

function refreshTrackingRatios(): void {
  for (const q of allQuotes()) {
    if (!isTracking(q)) continue;
    const underlying = getQuoteBySymbol(q.underlyingSymbol!);
    if (underlying) trackingRatio.set(q.securityId, q.last / underlying.last);
  }
}

/** Adds a simulated or user trade to a security's day volume and current bar. */
export function recordTradeVolume(securityId: number, quantity: number, price: number): void {
  const q = getQuote(securityId);
  if (!q) return;
  q.volume += quantity;
  q.turnover += quantity * price;
  const bar = currentBars.get(securityId);
  if (bar) bar.volume += quantity;
}

function updateBar(q: LiveQuote, at: number, volumeDelta: number): void {
  const bucket = Math.floor(at / BAR_MS) * BAR_MS;
  let bar = currentBars.get(q.securityId);
  if (!bar || bar.ts !== bucket) {
    bar = { ts: bucket, open: q.last, high: q.last, low: q.last, close: q.last, volume: 0 };
    currentBars.set(q.securityId, bar);
  }
  bar.high = Math.max(bar.high, q.last);
  bar.low = Math.min(bar.low, q.last);
  bar.close = q.last;
  bar.volume += volumeDelta;
}

function persistBars(quotes: LiveQuote[]): void {
  for (const q of quotes) {
    const bar = currentBars.get(q.securityId);
    if (!bar) continue;
    run(
      `INSERT INTO intraday_prices (security_id, ts, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(security_id, ts) DO UPDATE SET high = excluded.high, low = excluded.low, close = excluded.close,
         volume = excluded.volume`,
      q.securityId,
      bar.ts,
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      bar.volume,
    );
  }
}

function applyPrice(q: LiveQuote, price: number, at: number): void {
  q.last = price;
  q.high = Math.max(q.high, price);
  q.low = Math.min(q.low, price);
  q.updatedAt = at;
}

/** Recomputes derived instruments (indices, then index-tracking ETFs) from their underlyings. */
function updateDerived(at: number, changed: LiveQuote[]): void {
  for (const q of allQuotes()) {
    if (!isIndex(q)) continue;
    applyPrice(q, computeIndexValue(q), at);
    updateBar(q, at, 0);
    changed.push(q);
  }
  for (const q of allQuotes()) {
    if (!isTracking(q) || q.tradingStatus !== 'ACTIVE') continue;
    const underlying = getQuoteBySymbol(q.underlyingSymbol!);
    const ratio = trackingRatio.get(q.securityId);
    if (!underlying || !ratio) continue;
    const { lower, upper } = circuitLimits(q);
    const target = underlying.last * ratio * (1 + gaussian() * 0.0002);
    const price = Math.min(upper, Math.max(lower, roundToTick(target, q.tickSize)));
    const volumeDelta = simulatedVolume(q);
    applyPrice(q, price, at);
    q.volume += volumeDelta;
    q.turnover += volumeDelta * price;
    updateBar(q, at, volumeDelta);
    changed.push(q);
  }
}

function simulatedVolume(q: LiveQuote): number {
  const expected = (q.avgVolume / ticksPerDay()) * (0.2 + Math.random() * 1.6);
  return Math.floor(expected + Math.random());
}

function finishTick(changed: LiveQuote[]): void {
  transaction(() => {
    persistQuotes(changed);
    persistBars(changed);
  });
  bus.emit('prices', changed.map(toTickTuple));
  for (const listener of tickListeners) {
    try {
      listener(changed);
    } catch (err) {
      console.error('Market tick listener failed', err);
    }
  }
}

/** Advances every simulated price by one step. */
export function tick(at: number = nowMs()): LiveQuote[] {
  const today = istDate(at);
  if (today !== tradingDate) rollover(today);

  const theta = 1 - Math.exp(-config.tickIntervalMs / DEVIATION_TAU_MS);
  const marketShock = gaussian();
  const changed: LiveQuote[] = [];

  for (const q of allQuotes()) {
    if (!isPrimary(q) || q.tradingStatus !== 'ACTIVE' || !q.isTradable) continue;
    let state = priceState.get(q.securityId);
    if (!state) {
      resetState(q);
      state = priceState.get(q.securityId)!;
    }
    const vol = dailyVol(q);
    const anchorVol = (vol * 0.55) / Math.sqrt(ticksPerDay());
    state.logAnchor += state.driftPerTick + anchorVol * (q.beta * 0.6 * marketShock + 0.8 * gaussian());
    const deviationVol = vol * 0.25 * Math.sqrt(2 * theta);
    state.deviation = state.deviation * (1 - theta) + deviationVol * gaussian();

    const { lower, upper } = circuitLimits(q);
    let price = roundToTick(Math.exp(state.logAnchor + state.deviation), q.tickSize);
    if (price <= lower || price >= upper) {
      price = Math.min(upper, Math.max(lower, price));
      state.logAnchor = Math.log(price) - state.deviation;
    }
    const volumeDelta = simulatedVolume(q);
    applyPrice(q, price, at);
    q.volume += volumeDelta;
    q.turnover += volumeDelta * price;
    updateBar(q, at, volumeDelta);
    changed.push(q);
  }

  updateDerived(at, changed);
  finishTick(changed);
  return changed;
}

/**
 * Moves a security to an exact price (admin tooling and tests). Derived instruments, order matching
 * and alerts react exactly as they would to a simulated move.
 */
export function setPrice(securityId: number, price: number, at: number = nowMs()): LiveQuote {
  const q = getQuote(securityId);
  if (!q) throw new Error(`Unknown security ${securityId}`);
  const { lower, upper } = circuitLimits(q);
  const bounded = Math.min(upper, Math.max(lower, roundToTick(price, q.tickSize)));
  applyPrice(q, bounded, at);
  updateBar(q, at, 0);
  const state = priceState.get(q.securityId);
  if (state) {
    state.logAnchor = Math.log(bounded);
    state.deviation = 0;
  }
  const changed = [q];
  updateDerived(at, changed);
  finishTick(changed);
  return q;
}

/** Closes the trading day: stores daily candles, opens the next session and notifies listeners. */
export function rollover(newDate: string): void {
  const previousDate = tradingDate;
  const quotes = allQuotes();
  transaction(() => {
    for (const q of quotes) {
      if (q.tradingDate < newDate) {
        run(
          `INSERT INTO price_history (security_id, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(security_id, date) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low,
             close = excluded.close, volume = excluded.volume`,
          q.securityId,
          q.tradingDate,
          q.open,
          Math.max(q.high, q.last),
          Math.min(q.low, q.last),
          q.last,
          q.volume,
        );
      }
      q.prevClose = q.last;
      if (isPrimary(q) && q.tradingStatus === 'ACTIVE') {
        const gap = Math.exp(gaussian() * dailyVol(q) * 0.25);
        q.last = roundToTick(q.last * gap, q.tickSize);
        resetState(q);
      }
      q.open = q.high = q.low = q.last;
      q.volume = 0;
      q.turnover = 0;
      q.tradingDate = newDate;
      q.updatedAt = nowMs();
    }
    for (const q of quotes) {
      if (isIndex(q)) q.open = q.high = q.low = q.last = computeIndexValue(q);
    }
    refreshTrackingRatios();
    persistQuotes(quotes);
    setState('tradingDate', newDate);
    run('DELETE FROM intraday_prices WHERE ts < ?', nowMs() - INTRADAY_RETENTION_DAYS * DAY_MS);
  });
  tradingDate = newDate;
  currentBars.clear();
  newDayDrifts();
  bus.emit('market-rollover', { previousDate, newDate });
  for (const listener of rolloverListeners) {
    try {
      listener(previousDate, newDate);
    } catch (err) {
      console.error('Market rollover listener failed', err);
    }
  }
}

export function startSimulation(): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      console.error('Market tick failed', err);
    }
  }, config.tickIntervalMs);
}

export function stopSimulation(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function isSimulationRunning(): boolean {
  return timer !== null;
}
