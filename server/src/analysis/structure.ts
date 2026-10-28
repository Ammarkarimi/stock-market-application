import type { Bar } from './types.js';

export interface Pivot {
  index: number;
  price: number;
  type: 'high' | 'low';
  /** The final pivot is provisional: price has not yet reversed far enough to confirm it. */
  confirmed: boolean;
}

/**
 * Zigzag swing points: a high is confirmed once price falls `threshold` (a fraction, e.g. 0.05) below it,
 * and a low once price rises `threshold` above it. Pivots strictly alternate between highs and lows.
 */
export function zigzag(bars: Bar[], threshold: number): Pivot[] {
  const pivots: Pivot[] = [];
  if (bars.length === 0) return pivots;
  let trend: 'up' | 'down' | null = null;
  let hiIdx = 0;
  let loIdx = 0;

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i]!;
    if (trend === null) {
      if (bar.high > bars[hiIdx]!.high) hiIdx = i;
      if (bar.low < bars[loIdx]!.low) loIdx = i;
      if (bar.high >= bars[loIdx]!.low * (1 + threshold) && loIdx < i) {
        pivots.push({ index: loIdx, price: bars[loIdx]!.low, type: 'low', confirmed: true });
        trend = 'up';
        hiIdx = i;
      } else if (bar.low <= bars[hiIdx]!.high * (1 - threshold) && hiIdx < i) {
        pivots.push({ index: hiIdx, price: bars[hiIdx]!.high, type: 'high', confirmed: true });
        trend = 'down';
        loIdx = i;
      }
    } else if (trend === 'up') {
      if (bar.high > bars[hiIdx]!.high) hiIdx = i;
      else if (bar.low <= bars[hiIdx]!.high * (1 - threshold)) {
        pivots.push({ index: hiIdx, price: bars[hiIdx]!.high, type: 'high', confirmed: true });
        trend = 'down';
        loIdx = i;
      }
    } else {
      if (bar.low < bars[loIdx]!.low) loIdx = i;
      else if (bar.high >= bars[loIdx]!.low * (1 + threshold)) {
        pivots.push({ index: loIdx, price: bars[loIdx]!.low, type: 'low', confirmed: true });
        trend = 'up';
        hiIdx = i;
      }
    }
  }

  // The running extreme becomes a provisional pivot.
  if (trend === 'up' && hiIdx > (pivots.at(-1)?.index ?? -1)) {
    pivots.push({ index: hiIdx, price: bars[hiIdx]!.high, type: 'high', confirmed: false });
  } else if (trend === 'down' && loIdx > (pivots.at(-1)?.index ?? -1)) {
    pivots.push({ index: loIdx, price: bars[loIdx]!.low, type: 'low', confirmed: false });
  }
  return pivots;
}

export interface Level {
  price: number;
  /** How many swing points formed near this price. */
  touches: number;
  /** Index of the most recent swing point at this level. */
  lastIndex: number;
}

/**
 * Groups swing points that lie within `tolerance` (a fraction) of each other into horizontal levels.
 * The strongest levels have the most touches; recent touches break ties.
 */
export function priceLevels(pivots: Pivot[], tolerance: number): Level[] {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters: Pivot[][] = [];
  for (const pivot of sorted) {
    const cluster = clusters.at(-1);
    const mean = cluster ? cluster.reduce((s, p) => s + p.price, 0) / cluster.length : 0;
    if (cluster && Math.abs(pivot.price - mean) / mean <= tolerance) cluster.push(pivot);
    else clusters.push([pivot]);
  }
  return clusters
    .map((cluster) => ({
      price: cluster.reduce((s, p) => s + p.price, 0) / cluster.length,
      touches: cluster.length,
      lastIndex: Math.max(...cluster.map((p) => p.index)),
    }))
    .sort((a, b) => b.touches - a.touches || b.lastIndex - a.lastIndex);
}

/** Nearest levels below and above the price, closest first. */
export function nearestLevels(levels: Level[], price: number, count = 3) {
  const support = levels.filter((l) => l.price < price * 0.995).sort((a, b) => b.price - a.price).slice(0, count);
  const resistance = levels.filter((l) => l.price > price * 1.005).sort((a, b) => a.price - b.price).slice(0, count);
  return { support, resistance };
}
