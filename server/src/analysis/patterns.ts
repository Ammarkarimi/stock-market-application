import type { Level, Pivot } from './structure.js';
import type { Bar, ChartPoint, Pattern } from './types.js';

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const round = (value: number) => Math.round(value * 100) / 100;

/** A pattern still waiting for its neckline break after this many bars is no longer relevant. */
const STALE_FORMING = 40;

interface Context {
  bars: Bar[];
  pivots: Pivot[];
  /** Fractional tolerance for "equal" prices, scaled to the stock's volatility. */
  tolerance: number;
  /** Ignore patterns that finished longer ago than this many bars. */
  maxAge: number;
}

function point(bars: Bar[], index: number, price: number): ChartPoint {
  return { date: bars[index]!.date, price: round(price) };
}

/** Highest high and lowest low strictly after `index`. */
function extremesAfter(bars: Bar[], index: number) {
  let high = -Infinity;
  let low = Infinity;
  for (let i = index + 1; i < bars.length; i++) {
    high = Math.max(high, bars[i]!.high);
    low = Math.min(low, bars[i]!.low);
  }
  return { high, low };
}

/** Consecutive runs of `length` pivots, most recent first, that start with the given pivot type. */
function windows(pivots: Pivot[], length: number, first: Pivot['type']): Pivot[][] {
  const out: Pivot[][] = [];
  for (let end = pivots.length; end >= length; end--) {
    const run = pivots.slice(end - length, end);
    if (run[0]!.type === first) out.push(run);
  }
  return out;
}

function doubleTopOrBottom(ctx: Context, kind: 'top' | 'bottom'): Pattern | null {
  const { bars, tolerance } = ctx;
  const last = bars.length - 1;
  const close = bars[last]!.close;
  for (const [a, mid, b] of windows(ctx.pivots, 3, kind === 'top' ? 'high' : 'low')) {
    if (last - b!.index > ctx.maxAge) break;
    const peak = (a!.price + b!.price) / 2;
    const equal = Math.abs(a!.price - b!.price) / peak <= tolerance;
    const depth = Math.abs(peak - mid!.price) / peak;
    if (!equal || depth < tolerance * 1.5 || b!.index - a!.index < 10) continue;
    const after = extremesAfter(bars, b!.index);
    const neckline = mid!.price;
    const height = Math.abs(peak - neckline);
    if (kind === 'top') {
      if (after.high > Math.max(a!.price, b!.price) * (1 + tolerance)) continue; // broken out upwards: invalid
      const confirmed = close < neckline;
      if (!confirmed && last - b!.index > STALE_FORMING) continue;
      return {
        id: 'double-top',
        name: 'Double top',
        kind: 'chart',
        direction: 'bearish',
        status: confirmed ? 'confirmed' : 'forming',
        date: bars[b!.index]!.date,
        description: confirmed
          ? `Two peaks near ${round(peak)} and a close below the ${round(neckline)} neckline: sellers defended the highs twice.`
          : `Two peaks near ${round(peak)}. It completes on a close below the ${round(neckline)} neckline.`,
        points: [point(bars, a!.index, a!.price), point(bars, mid!.index, mid!.price), point(bars, b!.index, b!.price)],
        target: round(neckline - height),
      };
    }
    if (after.low < Math.min(a!.price, b!.price) * (1 - tolerance)) continue;
    const confirmed = close > neckline;
    if (!confirmed && last - b!.index > STALE_FORMING) continue;
    return {
      id: 'double-bottom',
      name: 'Double bottom',
      kind: 'chart',
      direction: 'bullish',
      status: confirmed ? 'confirmed' : 'forming',
      date: bars[b!.index]!.date,
      description: confirmed
        ? `Two troughs near ${round(peak)} and a close above the ${round(neckline)} neckline: buyers defended the lows twice.`
        : `Two troughs near ${round(peak)}. It completes on a close above the ${round(neckline)} neckline.`,
      points: [point(bars, a!.index, a!.price), point(bars, mid!.index, mid!.price), point(bars, b!.index, b!.price)],
      target: round(neckline + height),
    };
  }
  return null;
}

function headAndShoulders(ctx: Context, inverse: boolean): Pattern | null {
  const { bars, tolerance } = ctx;
  const last = bars.length - 1;
  const close = bars[last]!.close;
  for (const [ls, n1, head, n2, rs] of windows(ctx.pivots, 5, inverse ? 'low' : 'high')) {
    if (last - rs!.index > ctx.maxAge) break;
    const sign = inverse ? -1 : 1;
    // The head must stand clear of both shoulders, and the shoulders must be roughly level.
    const headClear = sign * (head!.price - ls!.price) / ls!.price > tolerance && sign * (head!.price - rs!.price) / rs!.price > tolerance;
    const shouldersLevel = Math.abs(ls!.price - rs!.price) / ((ls!.price + rs!.price) / 2) <= tolerance * 2;
    if (!headClear || !shouldersLevel) continue;
    const after = extremesAfter(bars, rs!.index);
    if (inverse ? after.low < head!.price : after.high > head!.price) continue;
    const neckSlope = (n2!.price - n1!.price) / (n2!.index - n1!.index);
    const neckAt = (i: number) => n2!.price + neckSlope * (i - n2!.index);
    const height = Math.abs(head!.price - neckAt(head!.index));
    // Confirmed by the first close through the neckline after the right shoulder, as long as price has not
    // climbed back through that break level since.
    let breakIndex = -1;
    for (let i = rs!.index + 1; i <= last && breakIndex < 0; i++) {
      if (inverse ? bars[i]!.close > neckAt(i) : bars[i]!.close < neckAt(i)) breakIndex = i;
    }
    const breakLevel = breakIndex >= 0 ? neckAt(breakIndex) : neckAt(Math.min(last, rs!.index + 5));
    const confirmed = breakIndex >= 0 && (inverse ? close > breakLevel : close < breakLevel);
    if (breakIndex >= 0 && !confirmed) continue; // broke out, then failed
    if (!confirmed && last - rs!.index > STALE_FORMING) continue;
    const necklineNow = breakLevel;
    const points = [ls, n1, head, n2, rs].map((p) => point(bars, p!.index, p!.price));
    if (!inverse) {
      return {
        id: 'head-and-shoulders',
        name: 'Head and shoulders',
        kind: 'chart',
        direction: 'bearish',
        status: confirmed ? 'confirmed' : 'forming',
        date: bars[rs!.index]!.date,
        description: confirmed
          ? `A higher peak (head) between two lower peaks, and a close below the neckline near ${round(necklineNow)}: a classic top.`
          : `A higher peak between two lower peaks. A close below the neckline near ${round(necklineNow)} would confirm a top.`,
        points,
        target: round(necklineNow - height),
      };
    }
    return {
      id: 'inverse-head-and-shoulders',
      name: 'Inverse head and shoulders',
      kind: 'chart',
      direction: 'bullish',
      status: confirmed ? 'confirmed' : 'forming',
      date: bars[rs!.index]!.date,
      description: confirmed
        ? `A deeper trough (head) between two higher troughs, and a close above the neckline near ${round(necklineNow)}: a classic bottom.`
        : `A deeper trough between two higher troughs. A close above the neckline near ${round(necklineNow)} would confirm a bottom.`,
      points,
      target: round(necklineNow + height),
    };
  }
  return null;
}

/** Ascending, descending or symmetrical triangle from the latest swing highs and lows. */
function triangle(ctx: Context): Pattern | null {
  const { bars, pivots } = ctx;
  const last = bars.length - 1;
  const window = pivots.filter((p) => last - p.index <= 120);
  // The provisional last swing is the latest touch of a boundary, unless it reaches beyond every earlier swing
  // on its side: then it is the breakout itself and must not drag the trend line with it.
  const provisional = window.at(-1);
  if (provisional && !provisional.confirmed) {
    const sameSide = window.filter((p) => p.confirmed && p.type === provisional.type).map((p) => p.price);
    const beyond = provisional.type === 'high' ? provisional.price > Math.max(...sameSide) * (1 + ctx.tolerance) : provisional.price < Math.min(...sameSide) * (1 - ctx.tolerance);
    if (sameSide.length && beyond) window.pop();
  }
  const recent = window.slice(-6);
  const highs = recent.filter((p) => p.type === 'high');
  const lows = recent.filter((p) => p.type === 'low');
  // At least five confirmed swings, so one side is touched three times: four can just as well be a double top
  // or bottom.
  if (highs.length < 2 || lows.length < 2 || recent.filter((p) => p.confirmed).length < 5) return null;
  if (last - recent.at(-1)!.index > ctx.maxAge) return null;

  // Least-squares trend line through the swing points, by bar index.
  const fit = (points: Pivot[]) => {
    const meanIdx = points.reduce((s, p) => s + p.index, 0) / points.length;
    const meanPrice = points.reduce((s, p) => s + p.price, 0) / points.length;
    let num = 0;
    let den = 0;
    for (const p of points) {
      num += (p.index - meanIdx) * (p.price - meanPrice);
      den += (p.index - meanIdx) ** 2;
    }
    const m = den ? num / den : 0;
    return { m, valueAt: (i: number) => meanPrice + m * (i - meanIdx) };
  };
  const upper = fit(highs);
  const lower = fit(lows);
  const start = recent[0]!.index;
  const mid = (upper.valueAt(last) + lower.valueAt(last)) / 2;
  // Slopes as a fraction of price per bar; below 0.04% a day counts as flat.
  const flat = 0.0004 * mid;
  const widthStart = upper.valueAt(start) - lower.valueAt(start);
  const widthEnd = upper.valueAt(last) - lower.valueAt(last);
  if (widthStart <= 0 || widthEnd <= 0 || widthEnd > widthStart * 0.8) return null; // must be converging

  let id: string;
  let name: string;
  let bias: Pattern['direction'];
  if (Math.abs(upper.m) <= flat && lower.m > flat) [id, name, bias] = ['ascending-triangle', 'Ascending triangle', 'bullish'];
  else if (Math.abs(lower.m) <= flat && upper.m < -flat) [id, name, bias] = ['descending-triangle', 'Descending triangle', 'bearish'];
  else if (upper.m < -flat && lower.m > flat) [id, name, bias] = ['symmetrical-triangle', 'Symmetrical triangle', 'neutral'];
  else return null;

  const close = bars[last]!.close;
  const top = upper.valueAt(last);
  const bottom = lower.valueAt(last);
  const breakout = close > top ? 'up' : close < bottom ? 'down' : null;
  const direction = breakout === 'up' ? 'bullish' : breakout === 'down' ? 'bearish' : bias;
  const points = [
    point(bars, start, upper.valueAt(start)),
    point(bars, last, top),
    point(bars, start, lower.valueAt(start)),
    point(bars, last, bottom),
  ];
  const description = breakout
    ? `Price broke ${breakout === 'up' ? 'above' : 'below'} a ${name.toLowerCase()} (${round(bottom)}–${round(top)}), a ${breakout === 'up' ? 'bullish' : 'bearish'} continuation signal.`
    : `Price is coiling between ${round(bottom)} and ${round(top)}. ${bias === 'bullish' ? 'Rising lows against flat resistance usually resolve upwards.' : bias === 'bearish' ? 'Falling highs against flat support usually resolve downwards.' : 'Watch for a breakout in either direction.'}`;
  return {
    id,
    name,
    kind: 'chart',
    direction,
    status: breakout ? 'confirmed' : 'forming',
    date: bars[last]!.date,
    description,
    points,
    target: breakout ? round(breakout === 'up' ? top + widthStart : bottom - widthStart) : null,
  };
}

/** A recent close through a horizontal level that held at least twice before. */
function levelBreak(ctx: Context, levels: Level[], averageVolume: number): Pattern | null {
  const { bars } = ctx;
  const last = bars.length - 1;
  if (last < 6) return null;
  const close = bars[last]!.close;
  const before = bars[last - 5]!.close;
  const volumeRatio = averageVolume > 0 ? Math.max(...bars.slice(-5).map((b) => b.volume)) / averageVolume : 0;
  const volumeNote = volumeRatio >= 1.5 ? ` on ${volumeRatio.toFixed(1)}× average volume` : '';
  for (const level of levels.filter((l) => l.touches >= 2 && l.lastIndex < last - 5)) {
    if (before <= level.price && close > level.price * 1.01) {
      return {
        id: 'breakout',
        name: 'Resistance breakout',
        kind: 'breakout',
        direction: 'bullish',
        status: 'confirmed',
        date: bars[last]!.date,
        description: `Closed ${pct(close / level.price - 1)} above resistance at ${round(level.price)} (tested ${level.touches} times)${volumeNote}.`,
        points: [point(bars, level.lastIndex, level.price), point(bars, last, level.price)],
        target: null,
      };
    }
    if (before >= level.price && close < level.price * 0.99) {
      return {
        id: 'breakdown',
        name: 'Support breakdown',
        kind: 'breakout',
        direction: 'bearish',
        status: 'confirmed',
        date: bars[last]!.date,
        description: `Closed ${pct(1 - close / level.price)} below support at ${round(level.price)} (tested ${level.touches} times)${volumeNote}.`,
        points: [point(bars, level.lastIndex, level.price), point(bars, last, level.price)],
        target: null,
      };
    }
  }
  return null;
}

/** Of two opposite patterns from the same family, keeps the confirmed one, or else the more recent. */
function stronger(a: Pattern | null, b: Pattern | null): Pattern | null {
  if (!a || !b) return a ?? b;
  if ((a.status === 'confirmed') !== (b.status === 'confirmed')) return a.status === 'confirmed' ? a : b;
  return a.date >= b.date ? a : b;
}

export function chartPatterns(ctx: Context, levels: Level[], averageVolume: number): Pattern[] {
  const tri = triangle(ctx);
  let double = stronger(doubleTopOrBottom(ctx, 'top'), doubleTopOrBottom(ctx, 'bottom'));
  // Flat highs with rising lows read as an ascending triangle, not as an unfinished double top (and vice versa).
  if (double?.status === 'forming' && ((tri?.id === 'ascending-triangle' && double.id === 'double-top') || (tri?.id === 'descending-triangle' && double.id === 'double-bottom'))) {
    double = null;
  }
  return [stronger(headAndShoulders(ctx, false), headAndShoulders(ctx, true)), double, tri, levelBreak(ctx, levels, averageVolume)].filter(
    (p): p is Pattern => p !== null,
  );
}

// ---- Candlesticks ----

const body = (b: Bar) => Math.abs(b.close - b.open);
const range = (b: Bar) => b.high - b.low;
const upperShadow = (b: Bar) => b.high - Math.max(b.open, b.close);
const lowerShadow = (b: Bar) => Math.min(b.open, b.close) - b.low;
const isUp = (b: Bar) => b.close > b.open;
const isDown = (b: Bar) => b.close < b.open;

/** Candlestick patterns completed on any of the last `lookback` bars, most recent first. */
export function candlestickPatterns(bars: Bar[], lookback = 5): Pattern[] {
  const found: Pattern[] = [];
  const n = bars.length;
  if (n < 15) return found;
  const avgBody = bars.slice(-20).reduce((s, b) => s + body(b), 0) / Math.min(20, n);

  for (let i = n - 1; i >= Math.max(10, n - lookback); i--) {
    const c = bars[i]!;
    const p = bars[i - 1]!;
    const pp = bars[i - 2]!;
    // Short-term context: the move over the five bars before this one.
    const priorMove = (p.close - bars[i - 6]!.close) / bars[i - 6]!.close;
    const downBefore = priorMove < -0.01;
    const upBefore = priorMove > 0.01;
    const add = (id: string, name: string, direction: Pattern['direction'], description: string, from = i) => {
      // Overlapping windows can repeat a multi-bar pattern on consecutive days: keep the most recent.
      if (found.some((p) => p.id === id)) return;
      found.push({
        id,
        name,
        kind: 'candlestick',
        direction,
        status: null,
        date: c.date,
        description,
        points: [{ date: bars[from]!.date, price: round(direction === 'bearish' ? Math.max(...bars.slice(from, i + 1).map((b) => b.high)) : Math.min(...bars.slice(from, i + 1).map((b) => b.low))) }],
        target: null,
      });
    };

    if (isDown(pp) && body(pp) > avgBody && body(p) < body(pp) * 0.35 && isUp(c) && c.close > (pp.open + pp.close) / 2 && downBefore) {
      add('morning-star', 'Morning star', 'bullish', 'A long red candle, a small indecisive one, then a strong green close: selling pressure is fading.', i - 2);
    } else if (isUp(pp) && body(pp) > avgBody && body(p) < body(pp) * 0.35 && isDown(c) && c.close < (pp.open + pp.close) / 2 && upBefore) {
      add('evening-star', 'Evening star', 'bearish', 'A long green candle, a small indecisive one, then a strong red close: buying pressure is fading.', i - 2);
    } else if ([pp, p, c].every((b) => isUp(b) && body(b) > range(b) * 0.5 && upperShadow(b) < body(b) * 0.5) && p.close > pp.close && c.close > p.close) {
      add('three-white-soldiers', 'Three white soldiers', 'bullish', 'Three strong green candles in a row, each closing higher: steady buying.', i - 2);
    } else if ([pp, p, c].every((b) => isDown(b) && body(b) > range(b) * 0.5 && lowerShadow(b) < body(b) * 0.5) && p.close < pp.close && c.close < p.close) {
      add('three-black-crows', 'Three black crows', 'bearish', 'Three strong red candles in a row, each closing lower: steady selling.', i - 2);
    } else if (isDown(p) && isUp(c) && c.open <= p.close && c.close >= p.open && body(c) > body(p) && downBefore) {
      add('bullish-engulfing', 'Bullish engulfing', 'bullish', 'A green candle whose body swallows the previous red one after a decline: buyers took control.', i - 1);
    } else if (isUp(p) && isDown(c) && c.open >= p.close && c.close <= p.open && body(c) > body(p) && upBefore) {
      add('bearish-engulfing', 'Bearish engulfing', 'bearish', 'A red candle whose body swallows the previous green one after a rally: sellers took control.', i - 1);
    } else if (range(c) > 0 && lowerShadow(c) >= 2 * body(c) && upperShadow(c) <= Math.max(body(c) * 0.5, range(c) * 0.1) && downBefore) {
      add('hammer', 'Hammer', 'bullish', 'A long lower wick after a decline: sellers pushed price down but buyers drove it back up.');
    } else if (range(c) > 0 && upperShadow(c) >= 2 * body(c) && lowerShadow(c) <= Math.max(body(c) * 0.5, range(c) * 0.1) && upBefore) {
      add('shooting-star', 'Shooting star', 'bearish', 'A long upper wick after a rally: buyers pushed price up but sellers drove it back down.');
    } else if (range(c) > 0 && body(c) <= range(c) * 0.1 && i === n - 1) {
      add('doji', 'Doji', 'neutral', 'Open and close are almost equal: buyers and sellers are undecided.');
    }
  }
  return found;
}
