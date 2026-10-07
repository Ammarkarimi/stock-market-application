import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatChange, formatPercent, formatPrice } from '@/lib/format';
import { useLiveTick } from '@/live/priceStore';

interface QuoteLike {
  lastPrice: number;
  change: number;
  changePercent: number;
}

/** Merges a live tick over a quote loaded from the API. */
export function useLiveQuote<T extends QuoteLike>(symbol: string | undefined, quote: T | undefined): T | undefined {
  const tick = useLiveTick(symbol);
  if (!quote) return quote;
  if (!tick) return quote;
  return { ...quote, lastPrice: tick.lastPrice, change: tick.change, changePercent: tick.changePercent };
}

/** Price that flashes green/red on each live move. */
export function LivePrice({ symbol, fallback, className, prefix = '₹' }: { symbol: string; fallback: number; className?: string; prefix?: string }) {
  const tick = useLiveTick(symbol);
  const price = tick?.lastPrice ?? fallback;
  return (
    <span
      key={tick?.at ?? 0}
      className={cn('num rounded px-0.5', tick?.at ? (tick.direction > 0 ? 'flash-up' : tick.direction < 0 ? 'flash-down' : '') : '', className)}
    >
      {prefix}
      {formatPrice(price)}
    </span>
  );
}

/** "+12.30 (+1.25%)" coloured by direction. */
export function PriceChange({ change, percent, className, showAbsolute = true, icon = false }: { change: number; percent: number; className?: string; showAbsolute?: boolean; icon?: boolean }) {
  const tone = change > 0 ? 'text-gain' : change < 0 ? 'text-loss' : 'text-muted';
  return (
    <span className={cn('num inline-flex items-center gap-0.5 whitespace-nowrap', tone, className)}>
      {icon && change !== 0 && (change > 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />)}
      {showAbsolute && <span>{formatChange(change)}</span>}
      <span>{showAbsolute ? `(${formatPercent(percent)})` : formatPercent(percent)}</span>
    </span>
  );
}

/** Live change for a symbol, falling back to API values. */
export function LiveChange({ symbol, change, percent, className, showAbsolute, icon }: { symbol: string; change: number; percent: number; className?: string; showAbsolute?: boolean; icon?: boolean }) {
  const tick = useLiveTick(symbol);
  return <PriceChange change={tick?.change ?? change} percent={tick?.changePercent ?? percent} className={className} showAbsolute={showAbsolute} icon={icon} />;
}

export function ChangePill({ percent, className }: { percent: number; className?: string }) {
  const tone = percent > 0 ? 'bg-gain-soft text-gain' : percent < 0 ? 'bg-loss-soft text-loss' : 'bg-surface-3 text-muted';
  return <span className={cn('num inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold', tone, className)}>{formatPercent(percent)}</span>;
}
