import { useState } from 'react';
import { formatINR, formatPercent } from '@/lib/format';

const PALETTE = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#84cc16', '#f97316', '#64748b'];

export interface DonutSlice {
  name: string;
  value: number;
}

/** Allocation donut with a legend; slices beyond `maxSlices` are grouped as "Others". */
export function DonutChart({ data, maxSlices = 7, size = 168 }: { data: DonutSlice[]; maxSlices?: number; size?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const slices = sorted.length > maxSlices
    ? [...sorted.slice(0, maxSlices - 1), { name: 'Others', value: sorted.slice(maxSlices - 1).reduce((s, d) => s + d.value, 0) }]
    : sorted;
  const total = slices.reduce((sum, d) => sum + d.value, 0) || 1;
  const radius = size / 2 - 10;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const focus = active !== null ? slices[active] : null;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label="Allocation chart">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth="18" />
          {slices.map((slice, i) => {
            const length = (slice.value / total) * circumference;
            const dash = `${Math.max(0, length - 2)} ${circumference}`;
            const element = (
              <circle
                key={slice.name}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={active === i ? 22 : 18}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                className="cursor-pointer transition-[stroke-width]"
              />
            );
            offset += length;
            return element;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[11px] text-muted">{focus ? focus.name : 'Total'}</span>
          <span className="num text-sm font-semibold">{formatINR(focus ? focus.value : total, { decimals: 0 })}</span>
          {focus && <span className="num text-[11px] text-muted">{formatPercent((focus.value / total) * 100, { sign: false, decimals: 1 })}</span>}
        </div>
      </div>
      <ul className="grid w-full grid-cols-1 gap-1.5 text-sm">
        {slices.map((slice, i) => (
          <li
            key={slice.name}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            className="flex items-center justify-between gap-3 rounded-md px-1.5 py-0.5 hover:bg-surface-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="truncate text-fg">{slice.name}</span>
            </span>
            <span className="num shrink-0 text-muted">{formatPercent((slice.value / total) * 100, { sign: false, decimals: 1 })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
