import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { LiveChange, LivePrice } from '@/components/market/LivePrice';
import { api, symbolPath } from '@/lib/api';
import { keys } from '@/lib/queryClient';
import type { MarketOverview } from '@/lib/types';

/** Scrolling strip of indices and top movers with live prices. */
export function MarketTicker() {
  const { data } = useQuery({
    queryKey: keys.marketOverview,
    queryFn: () => api.get<MarketOverview>('/market/overview'),
    refetchInterval: 60_000,
  });
  if (!data) return <div className="h-9 border-b border-border bg-surface" />;
  const items = [...data.indices, ...data.gainers.slice(0, 4), ...data.losers.slice(0, 4)];
  const row = (copy: number) =>
    items.map((item) => (
      <Link
        key={`${copy}-${item.symbol}`}
        to={`/stocks/${symbolPath(item.symbol)}`}
        className="flex shrink-0 items-center gap-2 px-4 text-xs hover:text-primary"
        tabIndex={copy ? -1 : 0}
        aria-hidden={copy ? true : undefined}
      >
        <span className="font-semibold text-fg">{item.type === 'INDEX' ? item.name : item.symbol}</span>
        <LivePrice symbol={item.symbol} fallback={item.lastPrice} prefix="" className="text-muted" />
        <LiveChange symbol={item.symbol} change={item.change} percent={item.changePercent} showAbsolute={false} />
      </Link>
    ));
  return (
    <div className="relative h-9 overflow-hidden border-b border-border bg-surface" aria-label="Market ticker">
      <div className="ticker-track flex h-full w-max items-center">
        {row(0)}
        {row(1)}
      </div>
    </div>
  );
}
