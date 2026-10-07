import { AreaSeries, ColorType, createChart, LineSeries, LineStyle, type MouseEventParams, type Time } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { formatDate, formatINR } from '@/lib/format';
import { cssVar, useTheme } from '@/lib/theme';
import type { PerformancePoint } from '@/lib/types';

interface PerformanceChartProps {
  points: PerformancePoint[];
  /** Overlay NIFTY 50 rebased to the portfolio's starting value. */
  showBenchmark?: boolean;
  height?: number;
  /** Fill a positioned parent instead of using a fixed height. */
  fill?: boolean;
}

interface Hover {
  date: string;
  value: number;
  invested: number;
  benchmark: number | null;
}

/** Portfolio value vs. amount invested over time, optionally against the NIFTY 50. */
export function PerformanceChart({ points, showBenchmark = false, height = 260, fill = false }: PerformanceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [theme] = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    const data = points.filter((p) => p.value > 0 || p.invested > 0);
    if (!container || data.length < 2) return;
    const primary = cssVar('--primary');
    const muted = cssVar('--text-muted');
    const border = cssVar('--border');
    const benchmarkColor = cssVar('--warning');

    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: muted, fontSize: 11, attributionLogo: false, fontFamily: 'Inter Variable, ui-sans-serif' },
      grid: { vertLines: { visible: false }, horzLines: { color: border, style: LineStyle.Dotted } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      localization: { priceFormatter: (v: number) => formatINR(v, { decimals: 0 }) },
      handleScroll: false,
      handleScale: false,
    });

    const value = chart.addSeries(AreaSeries, { lineColor: primary, topColor: `${primary}33`, bottomColor: `${primary}03`, lineWidth: 2, priceLineVisible: false });
    value.setData(data.map((p) => ({ time: p.date, value: p.value })));
    const invested = chart.addSeries(LineSeries, { color: muted, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    invested.setData(data.map((p) => ({ time: p.date, value: p.invested })));

    const firstWithBenchmark = data.find((p) => p.benchmark && p.value > 0);
    if (showBenchmark && firstWithBenchmark) {
      const scale = firstWithBenchmark.value / firstWithBenchmark.benchmark!;
      const benchmark = chart.addSeries(LineSeries, { color: benchmarkColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      benchmark.setData(
        data.filter((p) => p.benchmark && p.date >= firstWithBenchmark.date).map((p) => ({ time: p.date, value: p.benchmark! * scale })),
      );
    }
    chart.timeScale().fitContent();

    const byDate = new Map(data.map((p) => [p.date, p]));
    const onMove = (param: MouseEventParams<Time>) => {
      const point = typeof param.time === 'string' ? byDate.get(param.time) : undefined;
      setHover(point && param.point ? point : null);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [points, showBenchmark, theme]);

  const enough = points.filter((p) => p.value > 0 || p.invested > 0).length >= 2;
  return (
    <div className={fill ? 'absolute inset-0' : 'relative'} style={fill ? undefined : { height }}>
      {enough ? (
        <div ref={containerRef} className="absolute inset-0" />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted">Performance appears once you have held investments for a couple of days.</div>
      )}
      {hover && (
        <div className="num pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 rounded-md bg-surface/85 px-2 py-1 text-[11px] text-muted backdrop-blur-sm">
          <span className="font-medium text-fg">{formatDate(hover.date)}</span>
          <span>
            Value <span className="text-fg">{formatINR(hover.value, { decimals: 0 })}</span>
          </span>
          <span>Invested {formatINR(hover.invested, { decimals: 0 })}</span>
        </div>
      )}
    </div>
  );
}
