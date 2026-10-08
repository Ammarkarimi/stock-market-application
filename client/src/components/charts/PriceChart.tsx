import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { formatCompact, formatPrice } from '@/lib/format';
import { cssVar, useTheme } from '@/lib/theme';
import type { Candle } from '@/lib/types';
import { useLiveTick } from '@/live/priceStore';

/** lightweight-charts renders timestamps as UTC; shifting by +5:30 makes the axis read in IST. */
export const IST_OFFSET_SECONDS = 19_800;

export function toChartTime(time: number | string): Time {
  return typeof time === 'number' ? ((time + IST_OFFSET_SECONDS) as UTCTimestamp) : time;
}

interface PriceChartProps {
  candles: Candle[];
  mode: 'area' | 'candle';
  /** Seconds per bar for intraday data; undefined for daily/weekly bars. */
  barSeconds?: number;
  /** Previous close, drawn as a dashed reference line (1D view). */
  baseline?: number;
  /** Symbol whose live ticks extend the last bar. */
  liveSymbol?: string;
  height?: number;
  /** Fill a positioned parent instead of using a fixed height. */
  fill?: boolean;
}

interface Hover {
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const istDateTime = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
const istDate = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });

function timeLabel(time: Time): string {
  if (typeof time === 'number') return istDateTime.format(new Date(time * 1000));
  if (typeof time === 'string') return istDate.format(new Date(`${time}T00:00:00Z`));
  return istDate.format(new Date(Date.UTC(time.year, time.month - 1, time.day)));
}

export function PriceChart({ candles, mode, barSeconds, baseline, liveSymbol, height = 340, fill = false }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Area'> | ISeriesApi<'Candlestick'> | null>(null);
  const lastBarRef = useRef<{ time: Time; open: number; high: number; low: number; close: number } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [theme] = useTheme();
  const tick = useLiveTick(liveSymbol);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || candles.length === 0) return;
    const gain = cssVar('--gain');
    const loss = cssVar('--loss');
    const muted = cssVar('--text-muted');
    const border = cssVar('--border');
    const first = candles[0]!;
    const last = candles[candles.length - 1]!;
    const up = last.close >= (baseline ?? first.open);
    const trend = up ? gain : loss;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: muted,
        fontFamily: 'Inter Variable, ui-sans-serif, system-ui',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: border, style: LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.22 } },
      timeScale: { borderVisible: false, timeVisible: Boolean(barSeconds), secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { labelVisible: false }, horzLine: { labelBackgroundColor: cssVar('--primary') } },
      localization: { priceFormatter: (price: number) => formatPrice(price) },
      handleScale: { axisPressedMouseMove: false },
    });
    chartRef.current = chart;

    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    volume.setData(
      candles.map((c) => ({ time: toChartTime(c.time), value: c.volume, color: c.close >= c.open ? `${gain}55` : `${loss}55` })),
    );

    let series: ISeriesApi<'Area'> | ISeriesApi<'Candlestick'>;
    if (mode === 'candle') {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: gain,
        downColor: loss,
        wickUpColor: gain,
        wickDownColor: loss,
        borderVisible: false,
      });
      candleSeries.setData(candles.map((c) => ({ time: toChartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
      series = candleSeries;
    } else {
      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: trend,
        topColor: `${trend}40`,
        bottomColor: `${trend}02`,
        lineWidth: 2,
        priceLineVisible: false,
      });
      areaSeries.setData(candles.map((c) => ({ time: toChartTime(c.time), value: c.close })));
      series = areaSeries;
    }
    priceSeriesRef.current = series;
    lastBarRef.current = { time: toChartTime(last.time), open: last.open, high: last.high, low: last.low, close: last.close };
    if (baseline !== undefined) {
      series.createPriceLine({ price: baseline, color: muted, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: 'Prev close' });
    }
    chart.timeScale().fitContent();

    const byTime = new Map(candles.map((c) => [String(toChartTime(c.time)), c]));
    const onMove = (param: MouseEventParams<Time>) => {
      if (!param.time || !param.point) {
        setHover(null);
        return;
      }
      const candle = byTime.get(String(param.time));
      if (candle) setHover({ label: timeLabel(param.time), ...candle });
    };
    chart.subscribeCrosshairMove(onMove);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
    };
  }, [candles, mode, barSeconds, baseline, theme]);

  // Extend the latest bar with live ticks.
  useEffect(() => {
    const series = priceSeriesRef.current;
    const last = lastBarRef.current;
    if (!tick || !series || !last) return;
    let time = last.time;
    let bar = { ...last };
    if (barSeconds) {
      const bucket = (Math.floor(tick.time / barSeconds) * barSeconds + IST_OFFSET_SECONDS) as UTCTimestamp;
      if (typeof last.time === 'number' && bucket > last.time) {
        time = bucket;
        bar = { time, open: last.close, high: last.close, low: last.close, close: last.close };
      }
    }
    bar = { ...bar, time, close: tick.lastPrice, high: Math.max(bar.high, tick.lastPrice), low: Math.min(bar.low, tick.lastPrice) };
    lastBarRef.current = bar;
    try {
      if (mode === 'candle') (series as ISeriesApi<'Candlestick'>).update(bar);
      else (series as ISeriesApi<'Area'>).update({ time, value: tick.lastPrice });
    } catch {
      // Ignore out-of-order updates (e.g. right after a range switch).
    }
  }, [tick, barSeconds, mode]);

  return (
    <div className={fill ? 'absolute inset-0' : 'relative'} style={fill ? undefined : { height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {hover && (
        <div className="num pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 rounded-md bg-surface/85 px-2 py-1 text-[11px] text-muted backdrop-blur-sm">
          <span className="font-medium text-fg">{hover.label}</span>
          {mode === 'candle' ? (
            <>
              <span>O {formatPrice(hover.open)}</span>
              <span>H {formatPrice(hover.high)}</span>
              <span>L {formatPrice(hover.low)}</span>
              <span>C {formatPrice(hover.close)}</span>
            </>
          ) : (
            <span className="text-fg">₹{formatPrice(hover.close)}</span>
          )}
          {hover.volume > 0 && <span>Vol {formatCompact(hover.volume)}</span>}
        </div>
      )}
    </div>
  );
}
