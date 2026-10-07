import { ShoppingCart } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Sparkline } from '@/components/charts/Sparkline';
import { useTrade } from '@/components/trade/TradeProvider';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { symbolPath } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatCompact, formatCrores, formatPercent } from '@/lib/format';
import type { IndexSummary, MarketBreadth, SectorPerformance, SecurityListItem } from '@/lib/types';
import { useLiveTick } from '@/live/priceStore';
import { ChangePill, LiveChange, LivePrice } from './LivePrice';

export function IndexCard({ index, compact = false }: { index: IndexSummary; compact?: boolean }) {
  const tick = useLiveTick(index.symbol);
  const values = tick ? [...index.sparkline.slice(0, -1), tick.lastPrice] : index.sparkline;
  return (
    <Link
      to={`/stocks/${symbolPath(index.symbol)}`}
      className={cn('group flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-primary/40', compact && 'p-3')}
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted group-hover:text-primary">{index.name}</p>
        <LivePrice symbol={index.symbol} fallback={index.lastPrice} prefix="" className="mt-1 block text-lg font-semibold" />
        <LiveChange symbol={index.symbol} change={index.change} percent={index.changePercent} className="text-xs" />
      </div>
      <Sparkline values={values} baseline={index.prevClose} width={compact ? 80 : 96} height={40} />
    </Link>
  );
}

/** Compact live table of securities (movers, constituents, search results). */
export function MoversTable({ items, metric = 'change', showTrade = true }: { items: SecurityListItem[]; metric?: 'change' | 'volume' | 'value'; showTrade?: boolean }) {
  const navigate = useNavigate();
  const { openOrder } = useTrade();
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>Company</Th>
            <Th align="right">Price</Th>
            <Th align="right">Change</Th>
            {metric !== 'change' && <Th align="right">{metric === 'volume' ? 'Volume' : 'Value'}</Th>}
            {showTrade && <Th align="right" className="w-12"><span className="sr-only">Trade</span></Th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <Tr key={item.symbol} className="cursor-pointer" onClick={() => navigate(`/stocks/${symbolPath(item.symbol)}`)}>
              <Td>
                <Link to={`/stocks/${symbolPath(item.symbol)}`} className="font-semibold text-fg hover:text-primary" onClick={(e) => e.stopPropagation()}>{item.symbol}</Link>
                <p className="max-w-52 truncate text-xs text-muted">{item.name}</p>
              </Td>
              <Td align="right">
                <LivePrice symbol={item.symbol} fallback={item.lastPrice} />
              </Td>
              <Td align="right">
                <LiveChange symbol={item.symbol} change={item.change} percent={item.changePercent} showAbsolute={false} className="font-medium" />
              </Td>
              {metric !== 'change' && <Td align="right" className="text-muted">{metric === 'volume' ? formatCompact(item.volume) : `₹${formatCompact(item.turnover)}`}</Td>}
              {showTrade && (
                <Td align="right">
                  <button
                    type="button"
                    aria-label={`Buy ${item.symbol}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openOrder({ symbol: item.symbol, side: 'BUY' });
                    }}
                    className="rounded-md p-1.5 text-gain hover:bg-gain-soft"
                  >
                    <ShoppingCart className="size-4" />
                  </button>
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

function heatColor(change: number): string {
  const intensity = Math.min(1, Math.abs(change) / 3);
  const alpha = Math.round((0.12 + intensity * 0.5) * 100);
  return change >= 0 ? `color-mix(in srgb, var(--gain) ${alpha}%, transparent)` : `color-mix(in srgb, var(--loss) ${alpha}%, transparent)`;
}

export function SectorHeatmap({ sectors }: { sectors: SectorPerformance[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {sectors.map((sector) => (
        <div key={sector.sector} className="rounded-lg p-3" style={{ background: heatColor(sector.changePercent) }} title={`${sector.advances} advancing, ${sector.declines} declining`}>
          <p className="truncate text-xs font-medium text-fg">{sector.sector}</p>
          <p className={cn('num mt-1 text-base font-semibold', sector.changePercent >= 0 ? 'text-gain' : 'text-loss')}>{formatPercent(sector.changePercent)}</p>
          <p className="num mt-0.5 text-[11px] text-muted">
            {sector.count} {sector.count === 1 ? 'stock' : 'stocks'} · {formatCrores(sector.marketCapCr)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function BreadthBar({ breadth }: { breadth: MarketBreadth }) {
  const total = breadth.total || 1;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-3">
        <div className="bg-gain" style={{ width: `${(breadth.advances / total) * 100}%` }} />
        <div className="bg-subtle/40" style={{ width: `${(breadth.unchanged / total) * 100}%` }} />
        <div className="bg-loss" style={{ width: `${(breadth.declines / total) * 100}%` }} />
      </div>
      <div className="num mt-2 flex justify-between text-xs">
        <span className="text-gain">▲ {breadth.advances} advancing</span>
        {breadth.unchanged > 0 && <span className="text-muted">{breadth.unchanged} unchanged</span>}
        <span className="text-loss">▼ {breadth.declines} declining</span>
      </div>
    </div>
  );
}

export { ChangePill };
