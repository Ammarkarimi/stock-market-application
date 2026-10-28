import { afterAll, describe, expect, it, vi } from 'vitest';
import { analyzeSeries } from '../src/analysis/analyze.js';
import { atr, bollinger, ema, macd, rsi, sma } from '../src/analysis/indicators.js';
import { candlestickPatterns, chartPatterns } from '../src/analysis/patterns.js';
import { createYahooProvider, preferIndianListings, setMarketDataProvider, yahooProvider, type MarketDataProvider } from '../src/analysis/provider.js';
import { priceLevels, zigzag } from '../src/analysis/structure.js';
import type { Bar, PriceSeries } from '../src/analysis/types.js';
import { notFound } from '../src/lib/errors.js';
import { registerClient, TestClient } from './helpers.js';

/** Daily bars following straight lines between [barIndex, price] waypoints, with a little deterministic noise. */
function path(waypoints: [number, number][], noise = 0.002): Bar[] {
  const bars: Bar[] = [];
  const start = Date.UTC(2025, 0, 1);
  let prevClose = waypoints[0]![1];
  for (let w = 1; w < waypoints.length; w++) {
    const [i0, p0] = waypoints[w - 1]!;
    const [i1, p1] = waypoints[w]!;
    for (let i = i0 + (w === 1 ? 0 : 1); i <= i1; i++) {
      const base = p0 + ((p1 - p0) * (i - i0)) / (i1 - i0);
      const close = base * (1 + noise * Math.sin(i * 1.7));
      const open = i === 0 ? close : prevClose;
      bars.push({
        date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
        open,
        high: Math.max(open, close) * 1.004,
        low: Math.min(open, close) * 0.996,
        close,
        volume: 1_000_000,
      });
      prevClose = close;
    }
  }
  return bars;
}

function series(bars: Bar[], symbol = 'ACME.NS'): PriceSeries {
  return { symbol, name: 'Acme Ltd', exchange: 'NSE', currency: 'INR', instrumentType: 'EQUITY', fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, bars };
}

function patternsOf(bars: Bar[]) {
  const pivots = zigzag(bars, 0.04);
  return chartPatterns({ bars, pivots, tolerance: 0.015, maxAge: 60 }, priceLevels(pivots, 0.015), 1_000_000);
}

describe('indicators', () => {
  it('computes moving averages, RSI, MACD, Bollinger Bands and ATR', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(ema([2, 4, 6, 8], 2)).toEqual([null, 3, 5, 7]);

    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
    const falling = rising.map((v) => 300 - v);
    expect(rsi(rising).at(-1)).toBe(100);
    expect(rsi(falling).at(-1)).toBe(0);
    expect(rsi(rising).slice(0, 14).every((v) => v === null)).toBe(true);
    expect(macd(rising).line.at(-1)).toBeGreaterThan(0);
    expect(macd(falling).line.at(-1)).toBeLessThan(0);

    const flat = bollinger(Array(25).fill(50));
    expect([flat.upper.at(-1), flat.middle.at(-1), flat.lower.at(-1)]).toEqual([50, 50, 50]);

    const bars = Array.from({ length: 20 }, (_, i) => ({ date: `d${i}`, open: 100, high: 102, low: 98, close: 100, volume: 1 }));
    expect(atr(bars).at(-1)).toBeCloseTo(4);
  });

  it('finds alternating swing points and groups them into levels', () => {
    const bars = path([[0, 100], [30, 130], [60, 101], [90, 130], [100, 120]], 0);
    const pivots = zigzag(bars, 0.05);
    expect(pivots.map((p) => p.type)).toEqual(['low', 'high', 'low', 'high', 'low']);
    expect(pivots.map((p) => p.index)).toEqual([0, 30, 60, 90, 100]);
    // The last low has not yet been followed by a 5% rise.
    expect(pivots.map((p) => p.confirmed)).toEqual([true, true, true, true, false]);
    const top = priceLevels(pivots, 0.02)[0]!;
    expect(top.touches).toBe(2);
    expect(top.price).toBeCloseTo(130 * 1.004, 0);
  });
});

describe('chart patterns', () => {
  it('detects a confirmed double bottom with a measured-move target', () => {
    const bars = path([[0, 125], [60, 100], [80, 115], [100, 100.5], [130, 121]]);
    const pattern = patternsOf(bars).find((p) => p.id === 'double-bottom');
    expect(pattern).toMatchObject({ direction: 'bullish', status: 'confirmed', kind: 'chart' });
    expect(pattern!.points).toHaveLength(3);
    expect(pattern!.target).toBeGreaterThan(125);
  });

  it('reports a double top as forming until the neckline breaks', () => {
    const bars = path([[0, 90], [40, 120], [60, 106], [80, 120.5], [90, 112]]);
    const pattern = patternsOf(bars).find((p) => p.id === 'double-top');
    expect(pattern).toMatchObject({ direction: 'bearish', status: 'forming' });
  });

  it('detects a head and shoulders top once price closes below the neckline', () => {
    const bars = path([[0, 100], [40, 120], [55, 108], [75, 132], [95, 108], [115, 120], [135, 98]]);
    const found = patternsOf(bars);
    expect(found.find((p) => p.id === 'head-and-shoulders')).toMatchObject({ direction: 'bearish', status: 'confirmed' });
    // The troughs either side of the head are not a double bottom: price has since fallen through them.
    expect(found.some((p) => p.id === 'double-bottom')).toBe(false);
  });

  it('detects an inverse head and shoulders bottom', () => {
    const bars = path([[0, 130], [40, 110], [55, 122], [75, 98], [95, 122], [115, 110], [135, 130]]);
    expect(patternsOf(bars).find((p) => p.id === 'inverse-head-and-shoulders')).toMatchObject({ direction: 'bullish', status: 'confirmed' });
  });

  it('detects an ascending triangle and its breakout', () => {
    const waypoints: [number, number][] = [[0, 96], [15, 110], [30, 100], [45, 110], [60, 104], [75, 110], [88, 106.5]];
    const formingPatterns = patternsOf(path(waypoints));
    expect(formingPatterns.find((p) => p.id === 'ascending-triangle')).toMatchObject({ direction: 'bullish', status: 'forming' });
    // The flat highs are the triangle's resistance, not an unfinished double top.
    expect(formingPatterns.some((p) => p.id === 'double-top')).toBe(false);
    const broken = patternsOf(path([...waypoints, [96, 117]])).find((p) => p.id === 'ascending-triangle');
    expect(broken).toMatchObject({ direction: 'bullish', status: 'confirmed' });
  });
});

describe('candlestick patterns', () => {
  const decline = () => path([[0, 120], [20, 100]], 0);

  it('detects a bullish engulfing candle after a decline', () => {
    const bars = decline();
    const prev = bars.at(-1)!;
    bars.push({ date: '2025-02-01', open: prev.close * 0.995, high: prev.open * 1.01, low: prev.close * 0.99, close: prev.open * 1.008, volume: 1 });
    expect(candlestickPatterns(bars)[0]).toMatchObject({ id: 'bullish-engulfing', direction: 'bullish', date: '2025-02-01' });
  });

  it('detects a hammer after a decline', () => {
    const bars = decline();
    const c = bars.at(-1)!.close;
    bars.push({ date: '2025-02-01', open: c, high: c * 1.006, low: c * 0.95, close: c * 1.005, volume: 1 });
    expect(candlestickPatterns(bars)[0]).toMatchObject({ id: 'hammer', direction: 'bullish' });
  });

  it('reports each pattern once, using its most recent occurrence', () => {
    const bars = path([[0, 100], [20, 120]], 0);
    for (let i = 0; i < 4; i++) {
      const c = bars.at(-1)!.close;
      bars.push({ date: `2025-02-0${i + 1}`, open: c, high: c * 1.002, low: c * 0.976, close: c * 0.98, volume: 1 });
    }
    const crows = candlestickPatterns(bars).filter((p) => p.id === 'three-black-crows');
    expect(crows).toHaveLength(1);
    expect(crows[0]!.date).toBe('2025-02-04');
  });
});

describe('verdict', () => {
  // Steady trends with regular pullbacks.
  const trend = (from: number, to: number) => {
    const points: [number, number][] = [];
    for (let i = 0; i <= 300; i += 15) {
      const base = from + ((to - from) * i) / 300;
      points.push([i, base * (i % 30 === 15 ? (to > from ? 0.96 : 1.04) : 1)]);
    }
    return path(points);
  };

  it('says buy for a strong uptrend, with a stop below and a target above the price', () => {
    // End during a pullback, not at the top of a rally.
    const result = analyzeSeries(series(trend(100, 220).slice(0, 281)));
    expect(result.verdict.action).toBe('BUY');
    expect(result.verdict.score).toBeGreaterThanOrEqual(25);
    expect(result.levels.stopLoss).toBeLessThan(result.levels.entry);
    expect(result.levels.target).toBeGreaterThan(result.levels.entry);
    expect(result.signals.some((s) => s.id === 'price-vs-sma200' && s.direction === 'bullish')).toBe(true);
    expect(result.indicators.sma200.value).not.toBeNull();
    expect(result.overlays.sma50.length).toBe(result.candles.length - 49);
  });

  it('says wait instead of buy when an uptrend is overbought', () => {
    const result = analyzeSeries(series(trend(100, 220)));
    expect(result.indicators.rsi.value).toBeGreaterThanOrEqual(75);
    expect(result.verdict).toMatchObject({ action: 'WAIT', headline: 'Wait: overbought for now' });
  });

  it('says avoid for a strong downtrend', () => {
    const result = analyzeSeries(series(trend(220, 100)));
    expect(result.verdict.action).toBe('AVOID');
    expect(result.verdict.score).toBeLessThanOrEqual(-20);
    expect(result.verdict.summary).toMatch(/Bearish signals dominate/);
  });

  it('says wait when the stock goes sideways', () => {
    const points: [number, number][] = [];
    for (let i = 0; i <= 260; i += 10) points.push([i, i % 20 === 0 ? 100 : 106]);
    const result = analyzeSeries(series(path(points)));
    expect(result.verdict.action).toBe('WAIT');
    expect(result.verdict.confidence).not.toBe('High');
  });
});

describe('market data provider', () => {

  const yahooChart = {
    chart: {
      result: [
        {
          meta: { symbol: 'TCS.NS', currency: 'INR', fullExchangeName: 'NSE', instrumentType: 'EQUITY', longName: 'Tata Consultancy Services Limited', gmtoffset: 19_800, fiftyTwoWeekHigh: 4000, fiftyTwoWeekLow: 3000 },
          // 09:15 IST (03:45 UTC) on 1, 2 and 3 Oct 2026, then a later quote on 3 Oct.
          timestamp: [1, 2, 3, 3].map((day, i) => Date.UTC(2026, 9, day, 3, 45) / 1000 + (i === 3 ? 3600 : 0)),
          indicators: { quote: [{ open: [3500, null, 3510, 3520], high: [3550, null, 3560, 3570], low: [3480, null, 3500, 3505], close: [3520, null, 3540, 3555], volume: [1000, null, 1200, null] }] },
        },
      ],
      error: null,
    },
  };

  it('parses daily bars in exchange time, skipping empty sessions and repeated dates', async () => {
    const provider = createYahooProvider(vi.fn().mockResolvedValue(new Response(JSON.stringify(yahooChart), { status: 200 })));
    const result = await provider.history('TCS.NS');
    expect(result).toMatchObject({ symbol: 'TCS.NS', name: 'Tata Consultancy Services Limited', currency: 'INR', exchange: 'NSE', fiftyTwoWeekHigh: 4000 });
    expect(result.bars).toEqual([
      { date: '2026-10-01', open: 3500, high: 3550, low: 3480, close: 3520, volume: 1000 },
      { date: '2026-10-03', open: 3520, high: 3570, low: 3505, close: 3555, volume: 0 },
    ]);
  });

  it('turns unknown symbols into 404s and outages into 503s', async () => {
    const fetchMock = vi.fn();
    const provider = createYahooProvider(fetchMock);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ chart: { result: null, error: { code: 'Not Found' } } }), { status: 404 }));
    await expect(provider.history('NOPE')).rejects.toMatchObject({ status: 404 });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(provider.history('TCS.NS')).rejects.toMatchObject({ status: 503, code: 'DATA_SOURCE_UNAVAILABLE' });
    fetchMock.mockResolvedValueOnce(new Response('<html>busy</html>', { status: 429 }));
    await expect(provider.search('tcs')).rejects.toMatchObject({ status: 503 });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ quotes: [{ symbol: 'TCS', quoteType: 'EQUITY', exchDisp: 'NYSE' }, { symbol: 'TCS.NS', longname: 'Tata Consultancy Services', quoteType: 'EQUITY', exchDisp: 'NSE' }, { symbol: 'TCSX', quoteType: 'OPTION' }] }), { status: 200 }),
    );
    expect((await provider.search('tcs')).map((m) => m.symbol)).toEqual(['TCS.NS', 'TCS']);
  });

  it('lists NSE and BSE listings ahead of foreign ones among the top matches', () => {
    const m = (symbol: string) => ({ symbol, name: symbol, exchange: '', type: 'EQUITY' });
    expect(preferIndianListings([m('INFY'), m('INFY.BO'), m('INFY.NS'), m('INFN')]).map((x) => x.symbol)).toEqual(['INFY.NS', 'INFY.BO', 'INFY', 'INFN']);
  });
});

describe('analysis API', () => {
  const uptrend = path(Array.from({ length: 21 }, (_, k) => [k * 15, (100 + k * 6) * (k % 2 ? 0.96 : 1)] as [number, number]));
  const histories: Record<string, PriceSeries> = {
    'ACME.NS': series(uptrend),
    'NEWCO.NS': series(uptrend.slice(0, 30), 'NEWCO.NS'),
  };
  const stub: MarketDataProvider = {
    name: 'Test data',
    search: async (q) => (q.toLowerCase().startsWith('acme') ? [{ symbol: 'ACME.NS', name: 'Acme Ltd', exchange: 'NSE', type: 'EQUITY' }] : []),
    history: async (symbol) => {
      const found = histories[symbol];
      if (!found) throw notFound(`No price data found for ${symbol}`);
      return found;
    },
  };
  setMarketDataProvider(stub);
  afterAll(() => setMarketDataProvider(yahooProvider));

  it('requires a session', async () => {
    expect((await new TestClient().get('/api/analysis/ACME.NS')).status).toBe(401);
  });

  it('searches by name and analyzes the chosen symbol', async () => {
    const { client } = await registerClient();
    const search = await client.get('/api/analysis/search?q=acme');
    expect(search.status).toBe(200);
    expect(search.body.items[0]).toMatchObject({ symbol: 'ACME.NS', exchange: 'NSE' });

    const res = await client.get('/api/analysis/acme.ns');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ symbol: 'ACME.NS', name: 'Acme Ltd', currency: 'INR', dataSource: 'Test data' });
    expect(['BUY', 'WAIT', 'AVOID']).toContain(res.body.verdict.action);
    expect(res.body.verdict.summary.length).toBeGreaterThan(20);
    expect(res.body.candles).toHaveLength(uptrend.length);
    expect(res.body.signals.length).toBeGreaterThan(3);
    expect(res.body.indicators.rsi.value).toBeGreaterThan(0);
  });

  it('explains unknown symbols, short histories and bad input', async () => {
    const { client } = await registerClient();
    const unknown = await client.get('/api/analysis/ZZZZ.NS');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.message).toMatch(/No price data/);

    const short = await client.get('/api/analysis/NEWCO.NS');
    expect(short.status).toBe(422);
    expect(short.body.error.code).toBe('INSUFFICIENT_HISTORY');

    expect((await client.get('/api/analysis/search?q=')).status).toBe(400);
    expect((await client.get('/api/analysis/bad%20symbol!')).status).toBe(400);
  });
});
