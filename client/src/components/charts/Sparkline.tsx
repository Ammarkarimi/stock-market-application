import { useId } from 'react';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Baseline (e.g. previous close) drawn as a dotted line and used to pick the colour. */
  baseline?: number;
  className?: string;
}

export function Sparkline({ values, width = 120, height = 36, baseline, className }: SparklineProps) {
  const gradientId = useId();
  if (values.length < 2) return <svg width={width} height={height} className={className} aria-hidden="true" />;
  const all = baseline !== undefined ? [...values, baseline] : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = values[values.length - 1]! >= (baseline ?? values[0]!);
  const color = up ? 'var(--gain)' : 'var(--loss)';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {baseline !== undefined && (
        <line x1="0" x2={width} y1={y(baseline)} y2={y(baseline)} stroke="var(--text-subtle)" strokeDasharray="2 3" strokeWidth="1" />
      )}
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${gradientId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
