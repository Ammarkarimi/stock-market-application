import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatShortDate, todayIST } from '@/lib/format';
import type { Ipo } from '@/lib/types';

/** Horizontal subscription bar per investor category. */
export function SubscriptionBars({ ipo }: { ipo: Ipo }) {
  const rows = [
    { label: 'Retail', value: ipo.subscription.retail, quota: ipo.quotas.retail },
    { label: 'NII', value: ipo.subscription.nii, quota: ipo.quotas.nii },
    { label: 'QIB', value: ipo.subscription.qib, quota: ipo.quotas.qib },
    { label: 'Total', value: ipo.subscription.total, quota: 100 },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className={cn('text-muted', row.label === 'Total' && 'font-semibold text-fg')}>
              {row.label} {row.label !== 'Total' && <span className="text-subtle">· {row.quota}% quota</span>}
            </span>
            <span className="num font-semibold">{row.value.toFixed(2)}x</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
            <div className={cn('h-full rounded-full', row.label === 'Total' ? 'bg-primary' : row.value >= 1 ? 'bg-gain' : 'bg-warning')} style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Open → close → allotment → refund → listing, highlighting completed steps. */
export function IpoTimeline({ ipo }: { ipo: Ipo }) {
  const today = todayIST();
  const steps = [
    { label: 'Bidding opens', date: ipo.dates.open, done: today >= ipo.dates.open },
    { label: 'Bidding closes', date: ipo.dates.close, done: today > ipo.dates.close || ['CLOSED', 'ALLOTTED', 'LISTED'].includes(ipo.status) },
    { label: 'Allotment', date: ipo.dates.allotment, done: ipo.status === 'ALLOTTED' || ipo.status === 'LISTED' },
    { label: 'Refunds', date: ipo.dates.refund ?? ipo.dates.allotment, done: ipo.status === 'ALLOTTED' || ipo.status === 'LISTED' },
    { label: 'Listing', date: ipo.dates.listing, done: ipo.status === 'LISTED' },
  ];
  return (
    <ol className="grid grid-cols-5 gap-2">
      {steps.map((step, index) => (
        <li key={step.label} className="relative flex flex-col items-center text-center">
          {index > 0 && <span className={cn('absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2', step.done ? 'bg-gain' : 'bg-border')} />}
          <span className={cn('relative z-10 flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-bold', step.done ? 'border-gain bg-gain text-white' : 'border-border bg-surface text-muted')}>
            {step.done ? <Check className="size-3.5" /> : index + 1}
          </span>
          <span className="mt-2 text-[11px] font-medium leading-tight sm:text-xs">{step.label}</span>
          <span className="num text-[11px] text-muted">{formatShortDate(step.date)}</span>
        </li>
      ))}
    </ol>
  );
}
