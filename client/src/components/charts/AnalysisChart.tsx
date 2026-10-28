import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { formatCompact, formatDate, formatPrice } from '@/lib/format';
import { cssVar, useTheme } from '@/lib/theme';
import type { AnalysisBar, AnalysisPattern, StockAnalysis } from '@/lib/types';

export type AnalysisRange = '6M' | '1Y' | '2Y';
const RANGE_BARS: Record<AnalysisRange, number> = { '6M': 126, '1Y': 252, '2Y': Infinity };

export interface AnalysisLayers {
  averages: boolean;
  bands: boolean;
  levels: boolean;
  patterns: boolean;
}

/** Colours shared with the chart legend. */
export const AVERAGE_COLORS = { sma20: '--info', sma50: '--warning', sma200: '--primary' } as const;

/** Line segments that outline a chart pattern; each segment needs strictly increasing dates. */
function patternSegments(pattern: AnalysisPattern): { date: string; price: number }[][] {
  if (pattern.id.endsWith('-triangle') && pattern.points.length === 4) {
    return [pattern.points.slice(0, 2), pattern.points.slice(2, 4)];
  }
  const sorted = [...pattern.points].sort((a, b) => a.date.localeCompare(b.date));
  return [sorted.filter((p, i) => i === 0 || p.date !== sorted[i - 1]!.date)];
}

export function AnalysisChart({ analysis, range, layers, height = 420 }: { analysis: StockAnalysis; range: AnalysisRange; layers: AnalysisLayers; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<AnalysisBar | null>(null);
  const [theme] = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    const candles = analysis.candles;
    if (!container || candles.length === 0) return;
    const gain = cssVar('--gain');
    const loss = cssVar('--loss');
    const muted = cssVar('--text-muted');
    const border = cssVar('--border');
    const neutral = cssVar('--info');

    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: muted, fontFamily: 'Inter Variable, ui-sans-serif, system-ui', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: border, style: LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.2 } },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true, rightOffset: 3 },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { labelVisible: false }, horzLine: { labelBackgroundColor: cssVar('--primary') } },
      localization: { priceFormatter: (price: number) => formatPrice(price) },
      handleScale: { axisPressedMouseMove: false },
    });

    if (candles.some((c) => c.volume > 0)) {
      const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
      volume.setData(candles.map((c) => ({ time: c.date as Time, value: c.volume, color: c.close >= c.open ? `${gain}55` : `${loss}55` })));
    }

    const price = chart.addSeries(CandlestickSeries, { upColor: gain, downColor: loss, wickUpColor: gain, wickDownColor: loss, borderVisible: false });
    price.setData(candles.map((c) => ({ time: c.date as Time, open: c.open, high: c.high, low: c.low, close: c.close })));

    const line = (points: { time: string; value: number }[], color: string, options: { width?: 1 | 2; style?: LineStyle } = {}) => {
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: options.width ?? 1,
        lineStyle: options.style ?? LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null, // overlays never stretch the price scale
      });
      series.setData(points.map((p) => ({ time: p.time as Time, value: p.value })));
    };

    if (layers.averages) {
      line(analysis.overlays.sma20, cssVar(AVERAGE_COLORS.sma20));
      line(analysis.overlays.sma50, cssVar(AVERAGE_COLORS.sma50), { width: 2 });
      line(analysis.overlays.sma200, cssVar(AVERAGE_COLORS.sma200), { width: 2 });
    }
    if (layers.bands) {
      line(analysis.overlays.bbUpper, muted, { style: LineStyle.Dashed });
      line(analysis.overlays.bbLower, muted, { style: LineStyle.Dashed });
    }
    if (layers.levels) {
      const { support, resistance, stopLoss, target } = analysis.levels;
      for (const level of support) price.createPriceLine({ price: level.price, color: `${gain}99`, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: 'Support' });
      for (const level of resistance) price.createPriceLine({ price: level.price, color: `${loss}99`, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: 'Resistance' });
      price.createPriceLine({ price: stopLoss, color: loss, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: 'Stop' });
      price.createPriceLine({ price: target, color: gain, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: 'Target' });
    }

    if (layers.patterns) {
      const markers: SeriesMarker<Time>[] = [];
      for (const pattern of analysis.patterns) {
        const color = pattern.direction === 'bullish' ? gain : pattern.direction === 'bearish' ? loss : neutral;
        if (pattern.kind !== 'candlestick') {
          for (const segment of patternSegments(pattern)) {
            if (segment.length > 1) line(segment.map((p) => ({ time: p.date, value: p.price })), color, { width: 2, style: pattern.status === 'forming' ? LineStyle.Dashed : LineStyle.Solid });
          }
        }
        // Chart patterns are drawn as outlines; candlesticks get an unlabelled arrow on their bar (the pattern
        // list names them), since labels on neighbouring bars overlap.
        if (pattern.kind === 'candlestick') {
          markers.push({
            time: pattern.date as Time,
            position: pattern.direction === 'bullish' ? 'belowBar' : 'aboveBar',
            shape: pattern.direction === 'bullish' ? 'arrowUp' : pattern.direction === 'bearish' ? 'arrowDown' : 'circle',
            color,
          });
        }
      }
      markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      createSeriesMarkers(price, markers);
    }

    const visible = Math.min(candles.length, RANGE_BARS[range]);
    chart.timeScale().setVisibleLogicalRange({ from: candles.length - visible, to: candles.length + 2 });

    const byDate = new Map(candles.map((c) => [c.date, c]));
    const onMove = (param: MouseEventParams<Time>) => setHover(param.time && param.point ? (byDate.get(String(param.time)) ?? null) : null);
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [analysis, range, layers, theme]);

  return (
    <div className="relative" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" aria-label={`Price chart for ${analysis.name}`} role="img" />
      {hover && (
        <div className="num pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 rounded-md bg-surface/85 px-2 py-1 text-[11px] text-muted backdrop-blur-sm">
          <span className="font-medium text-fg">{formatDate(hover.date)}</span>
          <span>O {formatPrice(hover.open)}</span>
          <span>H {formatPrice(hover.high)}</span>
          <span>L {formatPrice(hover.low)}</span>
          <span>C {formatPrice(hover.close)}</span>
          {hover.volume > 0 && <span>Vol {formatCompact(hover.volume)}</span>}
        </div>
      )}
    </div>
  );
}
