import { adx, atr, bollinger, last, macd, obv, rsi, sma, slope, type Series } from './indicators.js';
import { candlestickPatterns, chartPatterns } from './patterns.js';
import { nearestLevels, priceLevels, zigzag } from './structure.js';
import type { Bar, Direction, Pattern, PriceSeries, Signal } from './types.js';

/** Fewer bars than this (about three months of trading) is too little to read a chart. */
export const MIN_BARS = 60;

export type Action = 'BUY' | 'WAIT' | 'AVOID';

export interface Analysis {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  instrumentType: string;
  price: { last: number; change: number; changePercent: number; asOf: string; fiftyTwoWeekHigh: number; fiftyTwoWeekLow: number };
  verdict: { action: Action; score: number; confidence: 'High' | 'Medium' | 'Low'; headline: string; summary: string };
  levels: {
    support: { price: number; touches: number }[];
    resistance: { price: number; touches: number }[];
    entry: number;
    stopLoss: number;
    target: number;
    riskReward: number;
  };
  signals: Signal[];
  patterns: Pattern[];
  indicators: {
    rsi: Reading;
    macd: Reading & { signal: number | null; histogram: number | null };
    adx: Reading & { plusDi: number | null; minusDi: number | null };
    bollinger: Reading & { upper: number | null; lower: number | null };
    sma20: Reading;
    sma50: Reading;
    sma200: Reading;
    volume: Reading;
    range52w: Reading;
    atr: Reading;
  };
  candles: Bar[];
  overlays: { sma20: LinePoint[]; sma50: LinePoint[]; sma200: LinePoint[]; bbUpper: LinePoint[]; bbLower: LinePoint[] };
  bars: number;
}

interface Reading {
  value: number | null;
  reading: string;
  direction: Direction;
}

interface LinePoint {
  time: string;
  value: number;
}

const r2 = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const ago = (sessions: number) => (sessions === 0 ? 'today' : sessions === 1 ? '1 session ago' : `${sessions} sessions ago`);
const dirOf = (weight: number): Direction => (weight > 0 ? 'bullish' : weight < 0 ? 'bearish' : 'neutral');

function overlay(bars: Bar[], series: Series): LinePoint[] {
  const out: LinePoint[] = [];
  series.forEach((value, i) => {
    if (value != null) out.push({ time: bars[i]!.date, value: r2(value) });
  });
  return out;
}

/** Bars since `a` last crossed `b` in the given direction, or null if not within `within` bars. */
function crossedWithin(a: Series, b: Series, within: number, direction: 'above' | 'below'): number | null {
  for (let back = 0; back < within; back++) {
    const i = a.length - 1 - back;
    const [a0, b0, a1, b1] = [a[i - 1], b[i - 1], a[i], b[i]];
    if (a0 == null || b0 == null || a1 == null || b1 == null) return null;
    if (direction === 'above' ? a0 <= b0 && a1 > b1 : a0 >= b0 && a1 < b1) return back;
  }
  return null;
}

export function analyzeSeries(series: PriceSeries): Analysis {
  const bars = series.bars;
  if (bars.length < MIN_BARS) throw new Error(`At least ${MIN_BARS} bars are required`);
  const closes = bars.map((b) => b.close);
  const n = bars.length;
  const lastBar = bars[n - 1]!;
  const close = lastBar.close;
  const prevClose = bars[n - 2]!.close;
  const signals: Signal[] = [];
  const add = (signal: Omit<Signal, 'direction'>) => {
    if (signal.weight !== 0 || signal.group === 'momentum') signals.push({ ...signal, weight: Math.round(signal.weight), direction: dirOf(signal.weight) });
  };

  // ---- Indicators ----
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsiSeries = rsi(closes);
  const macdSeries = macd(closes);
  const adxSeries = adx(bars);
  const bands = bollinger(closes);
  const atrSeries = atr(bars);
  const atrNow = last(atrSeries) ?? close * 0.02;
  const atrPct = atrNow / close;
  const hasVolume = bars.slice(-20).some((b) => b.volume > 0);
  const avgVolume20 = bars.slice(-21, -1).reduce((s, b) => s + b.volume, 0) / 20;
  const year = bars.slice(-252);
  const high52 = series.fiftyTwoWeekHigh ?? Math.max(...year.map((b) => b.high));
  const low52 = series.fiftyTwoWeekLow ?? Math.min(...year.map((b) => b.low));

  // ---- Structure ----
  const threshold = clamp(2.5 * atrPct, 0.04, 0.15);
  const pivots = zigzag(bars, threshold);
  const tolerance = clamp(atrPct * 1.2, 0.012, 0.04);
  const levels = priceLevels(pivots.filter((p) => n - p.index <= 500), tolerance);
  const near = nearestLevels(levels, close);

  // ---- Trend ----
  const s50 = last(sma50);
  const s200 = last(sma200);
  if (s200 != null) {
    add({ id: 'price-vs-sma200', group: 'trend', label: close > s200 ? 'Above the 200-day average' : 'Below the 200-day average', detail: `Price is ${(((close - s200) / s200) * 100).toFixed(1)}% ${close > s200 ? 'above' : 'below'} its 200-day moving average (${r2(s200)}), the line that separates long-term uptrends from downtrends.`, weight: close > s200 ? 10 : -10 });
  }
  if (s50 != null && s200 != null) {
    const golden = crossedWithin(sma50, sma200, 30, 'above');
    const death = crossedWithin(sma50, sma200, 30, 'below');
    if (golden !== null) add({ id: 'golden-cross', group: 'trend', label: 'Golden cross', detail: `The 50-day average crossed above the 200-day average ${ago(golden)}, a widely watched long-term buy signal.`, weight: 12 });
    else if (death !== null) add({ id: 'death-cross', group: 'trend', label: 'Death cross', detail: `The 50-day average crossed below the 200-day average ${ago(death)}, a widely watched long-term sell signal.`, weight: -12 });
    else add({ id: 'sma-alignment', group: 'trend', label: s50 > s200 ? '50-day above 200-day average' : '50-day below 200-day average', detail: s50 > s200 ? 'The medium-term trend is above the long-term trend.' : 'The medium-term trend is below the long-term trend.', weight: s50 > s200 ? 6 : -6 });
  }
  if (s50 != null) {
    add({ id: 'price-vs-sma50', group: 'trend', label: close > s50 ? 'Above the 50-day average' : 'Below the 50-day average', detail: `Price is ${close > s50 ? 'above' : 'below'} its 50-day moving average (${r2(s50)}).`, weight: close > s50 ? 5 : -5 });
  }
  const highs = pivots.filter((p) => p.type === 'high').slice(-2);
  const lows = pivots.filter((p) => p.type === 'low').slice(-2);
  if (highs.length === 2 && lows.length === 2) {
    const hh = highs[1]!.price > highs[0]!.price;
    const hl = lows[1]!.price > lows[0]!.price;
    if (hh && hl) add({ id: 'higher-highs', group: 'trend', label: 'Higher highs and higher lows', detail: 'Each swing peak and trough is above the previous one: the chart is in an uptrend.', weight: 8 });
    else if (!hh && !hl) add({ id: 'lower-lows', group: 'trend', label: 'Lower highs and lower lows', detail: 'Each swing peak and trough is below the previous one: the chart is in a downtrend.', weight: -8 });
  }

  // ---- Momentum ----
  const rsiNow = last(rsiSeries);
  let rsiReading: Reading = { value: null, reading: 'Not enough data', direction: 'neutral' };
  if (rsiNow != null) {
    let weight = 0;
    let reading: string;
    if (rsiNow >= 75) [weight, reading] = [-8, 'Overbought: the rally is stretched and a pullback is likely'];
    else if (rsiNow >= 60) [weight, reading] = [6, 'Strong bullish momentum'];
    else if (rsiNow >= 50) [weight, reading] = [3, 'Mildly bullish momentum'];
    else if (rsiNow > 40) [weight, reading] = [-3, 'Mildly bearish momentum'];
    else if (rsiNow > 25) [weight, reading] = [-6, 'Weak, bearish momentum'];
    else [weight, reading] = [3, 'Oversold: a relief bounce is possible, but the trend is weak'];
    rsiReading = { value: r2(rsiNow), reading, direction: dirOf(weight) };
    add({ id: 'rsi', group: 'momentum', label: `RSI ${rsiNow.toFixed(0)}`, detail: `${reading}.`, weight });
  }

  const macdLine = last(macdSeries.line);
  const macdSignal = last(macdSeries.signal);
  const macdHist = last(macdSeries.histogram);
  let macdReading: Analysis['indicators']['macd'] = { value: null, signal: null, histogram: null, reading: 'Not enough data', direction: 'neutral' };
  if (macdLine != null && macdSignal != null) {
    const bullCross = crossedWithin(macdSeries.line, macdSeries.signal, 5, 'above');
    const bearCross = crossedWithin(macdSeries.line, macdSeries.signal, 5, 'below');
    let weight = macdLine > macdSignal ? 6 : -6;
    let reading = macdLine > macdSignal ? 'MACD is above its signal line: momentum is rising' : 'MACD is below its signal line: momentum is falling';
    if (bullCross !== null) [weight, reading] = [9, `Bullish MACD crossover ${ago(bullCross)}`];
    else if (bearCross !== null) [weight, reading] = [-9, `Bearish MACD crossover ${ago(bearCross)}`];
    macdReading = { value: r2(macdLine), signal: r2(macdSignal), histogram: macdHist == null ? null : r2(macdHist), reading, direction: dirOf(weight) };
    add({ id: 'macd', group: 'momentum', label: bullCross !== null ? 'MACD bullish crossover' : bearCross !== null ? 'MACD bearish crossover' : macdLine > macdSignal ? 'MACD above signal' : 'MACD below signal', detail: `${reading}.`, weight });
  }

  const adxNow = last(adxSeries.adx);
  const plusDi = last(adxSeries.plusDi);
  const minusDi = last(adxSeries.minusDi);
  let adxReading: Analysis['indicators']['adx'] = { value: null, plusDi: null, minusDi: null, reading: 'Not enough data', direction: 'neutral' };
  if (adxNow != null && plusDi != null && minusDi != null) {
    const up = plusDi > minusDi;
    let weight = 0;
    let reading: string;
    if (adxNow >= 25) [weight, reading] = [up ? 7 : -7, `Strong ${up ? 'up' : 'down'}trend (ADX ${adxNow.toFixed(0)})`];
    else if (adxNow >= 20) [weight, reading] = [up ? 3 : -3, `Developing ${up ? 'up' : 'down'}trend (ADX ${adxNow.toFixed(0)})`];
    else reading = `No clear trend (ADX ${adxNow.toFixed(0)}): price is moving sideways`;
    adxReading = { value: r2(adxNow), plusDi: r2(plusDi), minusDi: r2(minusDi), reading, direction: dirOf(weight) };
    add({ id: 'adx', group: 'momentum', label: adxNow >= 20 ? `ADX ${adxNow.toFixed(0)}: trending ${up ? 'up' : 'down'}` : `ADX ${adxNow.toFixed(0)}: no trend`, detail: `${reading}.`, weight });
  }

  if (n > 63) {
    const roc = (close - closes[n - 64]!) / closes[n - 64]!;
    if (Math.abs(roc) >= 0.1) add({ id: 'three-month-return', group: 'momentum', label: `${roc > 0 ? 'Up' : 'Down'} ${(Math.abs(roc) * 100).toFixed(0)}% in 3 months`, detail: `The stock has ${roc > 0 ? 'gained' : 'lost'} ${(Math.abs(roc) * 100).toFixed(1)}% over the last three months.`, weight: roc > 0 ? 4 : -4 });
  }

  // ---- Patterns ----
  const patterns = [
    ...chartPatterns({ bars, pivots, tolerance, maxAge: 60 }, levels, avgVolume20),
    ...candlestickPatterns(bars, 5),
  ];
  let candleTotal = 0;
  for (const pattern of patterns) {
    if (pattern.direction === 'neutral') continue;
    const sign = pattern.direction === 'bullish' ? 1 : -1;
    let weight: number;
    if (pattern.kind === 'candlestick') {
      const strong = pattern.id.startsWith('three-') || pattern.id === 'morning-star' || pattern.id === 'evening-star';
      const base = strong ? 6 : 4;
      weight = clamp(sign * base, -10 - candleTotal, 10 - candleTotal);
      candleTotal += weight;
    } else if (pattern.kind === 'breakout') {
      weight = sign * 12;
    } else {
      weight = sign * (pattern.status === 'confirmed' ? 15 : 6);
    }
    add({
      id: `pattern-${pattern.id}`,
      group: pattern.kind === 'candlestick' ? 'candlestick' : 'pattern',
      label: `${pattern.name}${pattern.status ? ` (${pattern.status})` : ''}`,
      detail: pattern.description,
      weight,
    });
  }

  // ---- Volume ----
  let volumeReading: Reading = { value: null, reading: 'No volume data for this instrument', direction: 'neutral' };
  if (hasVolume && avgVolume20 > 0) {
    const obvSeries = obv(bars);
    const obvSlope = slope(obvSeries, 20);
    const priceSlope = slope(closes, 20);
    // A session still in progress can report no volume yet: use the latest bar that has some.
    const latestVolume = [...bars].reverse().find((b) => b.volume > 0)?.volume ?? 0;
    const ratio = latestVolume / avgVolume20;
    let weight = 0;
    let reading = `Volume ${ratio.toFixed(1)}× the 20-day average`;
    if (obvSlope > 0 && priceSlope > 0) [weight, reading] = [4, `${reading}; buying volume is confirming the rise (OBV rising)`];
    else if (obvSlope < 0 && priceSlope < 0) [weight, reading] = [-4, `${reading}; selling volume is confirming the fall (OBV falling)`];
    else if (obvSlope > 0 && priceSlope <= 0) [weight, reading] = [3, `${reading}; volume is accumulating while price dips (bullish divergence)`];
    else if (obvSlope < 0 && priceSlope >= 0) [weight, reading] = [-3, `${reading}; the rise is not backed by volume (bearish divergence)`];
    volumeReading = { value: r2(ratio), reading, direction: dirOf(weight) };
    add({ id: 'volume', group: 'volume', label: weight > 0 ? 'Volume supports buyers' : weight < 0 ? 'Volume supports sellers' : 'Volume neutral', detail: `${reading}.`, weight });
  }

  // ---- Position ----
  const upperBand = last(bands.upper);
  const lowerBand = last(bands.lower);
  let bbReading: Analysis['indicators']['bollinger'] = { value: null, upper: null, lower: null, reading: 'Not enough data', direction: 'neutral' };
  if (upperBand != null && lowerBand != null) {
    const position = (close - lowerBand) / (upperBand - lowerBand);
    let weight = 0;
    let reading = `Price is at ${(position * 100).toFixed(0)}% of the band range`;
    if (close > upperBand) [weight, reading] = [-3, 'Price is above the upper band: stretched in the short term'];
    else if (close < lowerBand) [weight, reading] = [2, 'Price is below the lower band: stretched to the downside'];
    const width = (upperBand - lowerBand) / (last(bands.middle) ?? close);
    if (width < 0.06) reading += '. The bands are tight, which often precedes a big move';
    bbReading = { value: r2(position * 100), upper: r2(upperBand), lower: r2(lowerBand), reading, direction: dirOf(weight) };
    if (weight) add({ id: 'bollinger', group: 'position', label: close > upperBand ? 'Above upper Bollinger band' : 'Below lower Bollinger band', detail: `${reading}.`, weight });
  }
  const rangePosition = high52 > low52 ? (close - low52) / (high52 - low52) : 0.5;
  const range52Reading: Reading = {
    value: r2(rangePosition * 100),
    reading: rangePosition >= 0.9 ? 'Near the 52-week high' : rangePosition <= 0.1 ? 'Near the 52-week low' : `${(rangePosition * 100).toFixed(0)}% of the way from the 52-week low to the high`,
    direction: 'neutral',
  };
  if (rangePosition >= 0.9 && s200 != null && close > s200) add({ id: 'near-high', group: 'position', label: 'Near the 52-week high', detail: 'Stocks making new highs in an uptrend tend to keep showing strength.', weight: 3 });
  if (rangePosition <= 0.1 && s200 != null && close < s200) add({ id: 'near-low', group: 'position', label: 'Near the 52-week low', detail: 'The stock is near its yearly low and still below its long-term average.', weight: -3 });

  // ---- Levels and risk/reward ----
  const support = near.support[0]?.price;
  const resistance = near.resistance.find((l) => l.price >= close + atrNow)?.price;
  const stopLoss = clamp(support !== undefined ? support - 0.5 * atrNow : close - 2 * atrNow, close - 3 * atrNow, close - atrNow);
  const bullishTarget = patterns.find((p) => p.direction === 'bullish' && p.status === 'confirmed' && p.target && p.target > close)?.target;
  const target = resistance ?? bullishTarget ?? close + 2 * (close - stopLoss);
  const riskReward = (target - close) / (close - stopLoss);
  if (riskReward >= 2) add({ id: 'risk-reward', group: 'risk', label: `Reward ${riskReward.toFixed(1)}× the risk`, detail: `Room to ${r2(target)} against a stop at ${r2(stopLoss)}.`, weight: 5 });
  else if (riskReward < 1) add({ id: 'risk-reward', group: 'risk', label: `Reward only ${riskReward.toFixed(1)}× the risk`, detail: `Resistance at ${r2(target)} is closer than the stop at ${r2(stopLoss)}: little upside before sellers return.`, weight: -5 });

  // ---- Verdict ----
  const total = signals.reduce((s, x) => s + x.weight, 0);
  const score = clamp(Math.round(total), -100, 100);
  const absolute = signals.reduce((s, x) => s + Math.abs(x.weight), 0);
  const agreement = absolute ? Math.abs(total) / absolute : 0;
  let action: Action = score >= 25 ? 'BUY' : score <= -20 ? 'AVOID' : 'WAIT';
  let caution: string | null = null;
  if (action === 'BUY' && rsiNow != null && rsiNow >= 75) {
    action = 'WAIT';
    caution = 'The trend is bullish, but the stock is overbought: wait for a pullback before buying.';
  }
  const confidence = Math.abs(score) >= 50 && agreement >= 0.55 ? 'High' : Math.abs(score) >= 25 && agreement >= 0.35 ? 'Medium' : 'Low';
  const top = (direction: Direction) =>
    signals
      .filter((s) => s.direction === direction)
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, 3)
      // Lower-case the first letter for use mid-sentence, but leave acronyms such as RSI and MACD alone.
      .map((s) => (/^[A-Z][a-z]/.test(s.label) ? s.label.charAt(0).toLowerCase() + s.label.slice(1) : s.label));
  const bulls = top('bullish');
  const bears = top('bearish');
  const headline = {
    BUY: 'Buy: the chart is bullish',
    WAIT: caution ? 'Wait: overbought for now' : 'Wait: the signals are mixed',
    AVOID: 'Avoid: the chart is bearish',
  }[action];
  const summary =
    caution ??
    {
      BUY: `Bullish signals dominate (${bulls.join(', ')}). Consider buying near ${r2(close)} with a stop-loss at ${r2(stopLoss)}.`,
      WAIT: `Bullish and bearish signals roughly balance${bulls.length ? ` (for: ${bulls.join(', ')}` : ' ('}${bears.length ? `${bulls.length ? '; ' : ''}against: ${bears.join(', ')}` : ''}). Wait for a clearer trend or a breakout above ${r2(resistance ?? target)}.`,
      AVOID: `Bearish signals dominate (${bears.join(', ')}). Avoid buying until price recovers above ${r2(s50 ?? resistance ?? target)}.`,
    }[action];

  return {
    symbol: series.symbol,
    name: series.name,
    exchange: series.exchange,
    currency: series.currency,
    instrumentType: series.instrumentType,
    price: {
      last: r2(close),
      change: r2(close - prevClose),
      changePercent: r2(((close - prevClose) / prevClose) * 100),
      asOf: lastBar.date,
      fiftyTwoWeekHigh: r2(high52),
      fiftyTwoWeekLow: r2(low52),
    },
    verdict: { action, score, confidence, headline, summary },
    levels: {
      support: near.support.map((l) => ({ price: r2(l.price), touches: l.touches })),
      resistance: near.resistance.map((l) => ({ price: r2(l.price), touches: l.touches })),
      entry: r2(close),
      stopLoss: r2(stopLoss),
      target: r2(target),
      riskReward: r2(riskReward),
    },
    signals: signals.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    patterns,
    indicators: {
      rsi: rsiReading,
      macd: macdReading,
      adx: adxReading,
      bollinger: bbReading,
      sma20: smaReading(close, last(sma20), 20),
      sma50: smaReading(close, s50, 50),
      sma200: smaReading(close, s200, 200),
      volume: volumeReading,
      range52w: range52Reading,
      atr: { value: r2(atrNow), reading: `Typical daily move ${(atrPct * 100).toFixed(1)}% (${r2(atrNow)})`, direction: 'neutral' },
    },
    candles: bars.map((b) => ({ ...b, open: r2(b.open), high: r2(b.high), low: r2(b.low), close: r2(b.close) })),
    overlays: {
      sma20: overlay(bars, sma20),
      sma50: overlay(bars, sma50),
      sma200: overlay(bars, sma200),
      bbUpper: overlay(bars, bands.upper),
      bbLower: overlay(bars, bands.lower),
    },
    bars: n,
  };
}

function smaReading(close: number, value: number | null, period: number): Reading {
  if (value == null) return { value: null, reading: `Needs ${period} days of history`, direction: 'neutral' };
  const above = close > value;
  return { value: r2(value), reading: `Price is ${Math.abs(((close - value) / value) * 100).toFixed(1)}% ${above ? 'above' : 'below'}`, direction: above ? 'bullish' : 'bearish' };
}
