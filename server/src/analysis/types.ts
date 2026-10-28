/** One daily bar. `date` is the exchange's local calendar date (YYYY-MM-DD). */
export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Daily history for one instrument, as returned by a market data provider. */
export interface PriceSeries {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  instrumentType: string;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  bars: Bar[];
}

export interface SymbolMatch {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export type Direction = 'bullish' | 'bearish' | 'neutral';

/** A point on the chart, used to draw a pattern. */
export interface ChartPoint {
  date: string;
  price: number;
}

export interface Pattern {
  id: string;
  name: string;
  kind: 'chart' | 'candlestick' | 'breakout';
  direction: Direction;
  /** Chart patterns are `forming` until price crosses their neckline or trend line. */
  status: 'confirmed' | 'forming' | null;
  /** Date of the bar that completed (or most recently shaped) the pattern. */
  date: string;
  description: string;
  points: ChartPoint[];
  /** Measured-move price objective, when the pattern has one. */
  target: number | null;
}

export interface Signal {
  id: string;
  group: 'trend' | 'momentum' | 'pattern' | 'candlestick' | 'volume' | 'position' | 'risk';
  label: string;
  detail: string;
  direction: Direction;
  /** Contribution to the score: positive is bullish, negative bearish. */
  weight: number;
}
