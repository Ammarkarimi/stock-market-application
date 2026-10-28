import type { Bar } from './types.js';

/** Indicator series are aligned with the input: index i is the value at bar i, or null while warming up. */
export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average seeded with the simple average of the first `period` values. */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing: like an EMA with alpha 1/period, seeded with a simple average. */
function wilder(values: number[], period: number, start: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length - start < period) return out;
  let prev = values.slice(start, start + period).reduce((a, b) => a + b, 0) / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/** Relative Strength Index (Wilder), 0–100. */
export function rsi(closes: number[], period = 14): Series {
  const gains = closes.map((c, i) => (i === 0 ? 0 : Math.max(0, c - closes[i - 1]!)));
  const losses = closes.map((c, i) => (i === 0 ? 0 : Math.max(0, closes[i - 1]! - c)));
  const avgGain = wilder(gains, period, 1);
  const avgLoss = wilder(losses, period, 1);
  return closes.map((_, i) => {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (g == null || l == null) return null;
    if (l === 0) return g === 0 ? 50 : 100;
    return 100 - 100 / (1 + g / l);
  });
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const line: Series = closes.map((_, i) => (fastEma[i] != null && slowEma[i] != null ? fastEma[i]! - slowEma[i]! : null));
  const firstValid = line.findIndex((v) => v != null);
  const signal: Series = new Array(closes.length).fill(null);
  if (firstValid >= 0) {
    const tail = ema(line.slice(firstValid) as number[], signalPeriod);
    tail.forEach((v, j) => (signal[firstValid + j] = v));
  }
  const histogram: Series = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i]! : null));
  return { line, signal, histogram };
}

export function bollinger(closes: number[], period = 20, multiplier = 2) {
  const middle = sma(closes, period);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i]!;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j]! - mean) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = mean + multiplier * sd;
    lower[i] = mean - multiplier * sd;
  }
  return { upper, middle, lower };
}

function trueRanges(bars: Bar[]): number[] {
  return bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const prevClose = bars[i - 1]!.close;
    return Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
  });
}

/** Average True Range (Wilder). */
export function atr(bars: Bar[], period = 14): Series {
  return wilder(trueRanges(bars), period, 0);
}

/** Average Directional Index with the directional indicators, all 0–100. */
export function adx(bars: Bar[], period = 14) {
  const plusDm = bars.map((b, i) => {
    if (i === 0) return 0;
    const up = b.high - bars[i - 1]!.high;
    const down = bars[i - 1]!.low - b.low;
    return up > down && up > 0 ? up : 0;
  });
  const minusDm = bars.map((b, i) => {
    if (i === 0) return 0;
    const up = b.high - bars[i - 1]!.high;
    const down = bars[i - 1]!.low - b.low;
    return down > up && down > 0 ? down : 0;
  });
  const tr = wilder(trueRanges(bars), period, 1);
  const plus = wilder(plusDm, period, 1);
  const minus = wilder(minusDm, period, 1);
  const plusDi: Series = bars.map((_, i) => (tr[i] ? (100 * plus[i]!) / tr[i]! : null));
  const minusDi: Series = bars.map((_, i) => (tr[i] ? (100 * minus[i]!) / tr[i]! : null));
  const dx = bars.map((_, i) => {
    const p = plusDi[i];
    const m = minusDi[i];
    if (p == null || m == null || p + m === 0) return 0;
    return (100 * Math.abs(p - m)) / (p + m);
  });
  const firstDx = plusDi.findIndex((v) => v != null);
  const adxLine: Series = firstDx >= 0 ? wilder(dx, period, firstDx) : new Array(bars.length).fill(null);
  return { adx: adxLine, plusDi, minusDi };
}

/** On-Balance Volume. */
export function obv(bars: Bar[]): number[] {
  let total = 0;
  return bars.map((b, i) => {
    if (i > 0) {
      const prev = bars[i - 1]!.close;
      if (b.close > prev) total += b.volume;
      else if (b.close < prev) total -= b.volume;
    }
    return total;
  });
}

/** Least-squares slope of the last `length` values, per bar. */
export function slope(values: number[], length = values.length): number {
  const ys = values.slice(-length);
  const n = ys.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  return num / den;
}

/** The last non-null value of a series. */
export function last(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i]!;
  return null;
}

/** The value `back` bars before the end (0 = last bar). */
export function at(series: Series, back: number): number | null {
  return series[series.length - 1 - back] ?? null;
}
