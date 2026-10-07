import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'primary';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-muted',
  success: 'bg-gain-soft text-gain',
  danger: 'bg-loss-soft text-loss',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
  primary: 'bg-primary-soft text-primary',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', tones[tone], className)}>
      {children}
    </span>
  );
}
