import { useQuery } from '@tanstack/react-query';
import { BellPlus, Briefcase, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { DonutChart } from '@/components/charts/DonutChart';
import { PerformanceChart } from '@/components/charts/PerformanceChart';
import { LivePrice } from '@/components/market/LivePrice';
import { useTrade } from '@/components/trade/TradeProvider';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { EmptyState, ErrorState, PageHeader, Switch } from '@/components/ui/Misc';
import { PageLoader, Skeleton } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { useLivePortfolio } from '@/hooks/useLivePortfolio';
import { api, symbolPath } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatINR, formatNumber, formatPercent, todayIST, trendClass } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { Holding, Performance, PerformanceRange, Portfolio } from '@/lib/types';

type SortKey = 'value' | 'pnlPercent' | 'dayChangePercent' | 'symbol';
type AllocationView = 'bySecurity' | 'bySector' | 'byType';

function downloadHoldingsCsv(holdings: Holding[]) {
  const header = ['Symbol', 'Name', 'Type', 'Sector', 'Quantity', 'Avg price', 'Last price', 'Invested', 'Current value', 'P&L', 'P&L %', 'Day change'];
  const rows = holdings.map((h) => [h.symbol, h.name, h.type, h.sector ?? '', h.quantity, h.averagePrice, h.lastPrice, h.invested, h.currentValue, h.pnl, h.pnlPercent, h.dayChange]);
  const csv = [header, ...rows].map((row) => row.map((cell) => (typeof cell === 'string' && /[",]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `holdings_${todayIST()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function PortfolioPage() {
  const { openOrder, openAlert } = useTrade();
  const [sort, setSort] = useState<SortKey>('value');
  const [allocation, setAllocation] = useState<AllocationView>('bySecurity');
  const [range, setRange] = useState<PerformanceRange>('6M');
  const [benchmark, setBenchmark] = useState(true);

  const query = useQuery({ queryKey: keys.portfolio, queryFn: () => api.get<Portfolio>('/portfolio') });
  const portfolio = useLivePortfolio(query.data);
  const performance = useQuery({ queryKey: keys.performance(range), queryFn: () => api.get<Performance>(`/portfolio/performance?range=${range}`) });

  const holdings = useMemo(() => {
    const list = [...(portfolio?.holdings ?? [])];
    const by: Record<SortKey, (a: Holding, b: Holding) => number> = {
      value: (a, b) => b.currentValue - a.currentValue,
      pnlPercent: (a, b) => b.pnlPercent - a.pnlPercent,
      dayChangePercent: (a, b) => b.dayChangePercent - a.dayChangePercent,
      symbol: (a, b) => a.symbol.localeCompare(b.symbol),
    };
    return list.sort(by[sort]);
  }, [portfolio, sort]);

  if (query.isPending) return <PageLoader />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const summary = portfolio!.summary;

  if (summary.holdingsCount === 0) {
    return (
      <div>
        <PageHeader title="Portfolio" />
        <Card>
          <EmptyState
            icon={<Briefcase className="size-6" />}
            title="You don't own any investments yet"
            description={summary.realizedPnl ? `Realized P&L so far: ${formatINR(summary.realizedPnl, { sign: true })}` : 'Buy your first stock or ETF and it will appear here with live returns.'}
            action={<ButtonLink to="/explore" variant="primary">Explore stocks</ButtonLink>}
          />
        </Card>
      </div>
    );
  }

  const slices = portfolio!.allocation[allocation].map((s) => ({ name: s.name, value: s.value }));
  const liveSlices = allocation === 'bySecurity' ? holdings.map((h) => ({ name: h.symbol, value: h.currentValue })) : slices;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Portfolio"
        description={`${summary.holdingsCount} holdings, valued live`}
        actions={
          <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={() => downloadHoldingsCsv(holdings)}>
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Current value" value={formatINR(summary.currentValue)} />
        <Stat label="Invested" value={formatINR(summary.invested)} />
        <Stat
          label="Total returns"
          value={<span className={trendClass(summary.totalPnl)}>{formatINR(summary.totalPnl, { sign: true })}</span>}
          sub={<span className={trendClass(summary.totalPnl)}>{formatPercent(summary.totalPnlPercent)}</span>}
        />
        <Stat
          label="Today's P&L"
          value={<span className={trendClass(summary.dayPnl)}>{formatINR(summary.dayPnl, { sign: true })}</span>}
          sub={<span className={trendClass(summary.dayPnl)}>{formatPercent(summary.dayPnlPercent)}</span>}
        />
        <Stat label="Realized P&L" value={<span className={trendClass(summary.realizedPnl)}>{formatINR(summary.realizedPnl, { sign: true })}</span>} sub={<span className="text-muted">From completed sales</span>} />
      </div>

      <Card>
        <CardHeader
          title="Holdings"
          action={
            <Select aria-label="Sort holdings" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-8 text-xs">
              <option value="value">Sort: Current value</option>
              <option value="pnlPercent">Sort: Returns %</option>
              <option value="dayChangePercent">Sort: Today's change</option>
              <option value="symbol">Sort: Symbol</option>
            </Select>
          }
        />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Security</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Avg. price</Th>
                <Th align="right">LTP</Th>
                <Th align="right" className="hidden md:table-cell">Invested</Th>
                <Th align="right">Current value</Th>
                <Th align="right">Returns</Th>
                <Th align="right" className="hidden lg:table-cell">Today</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <Tr key={h.symbol}>
                  <Td>
                    <Link to={`/stocks/${symbolPath(h.symbol)}`} className="font-semibold hover:text-primary">
                      {h.symbol}
                    </Link>
                    {h.type !== 'STOCK' && <Badge tone="primary" className="ml-2">{h.type}</Badge>}
                    <p className="max-w-56 truncate text-xs text-muted">{h.name}</p>
                    <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-surface-3" title={`${h.weight}% of portfolio`}>
                      <div className="h-full bg-primary/70" style={{ width: `${Math.min(100, h.weight)}%` }} />
                    </div>
                  </Td>
                  <Td align="right">
                    {formatNumber(h.quantity)}
                    {h.freeQuantity < h.quantity && <p className="text-[11px] text-muted">{formatNumber(h.freeQuantity)} free</p>}
                  </Td>
                  <Td align="right">{formatINR(h.averagePrice)}</Td>
                  <Td align="right">
                    <LivePrice symbol={h.symbol} fallback={h.lastPrice} />
                  </Td>
                  <Td align="right" className="hidden md:table-cell">{formatINR(h.invested)}</Td>
                  <Td align="right" className="font-medium">{formatINR(h.currentValue)}</Td>
                  <Td align="right" className={trendClass(h.pnl)}>
                    {formatINR(h.pnl, { sign: true })}
                    <p className="text-[11px]">{formatPercent(h.pnlPercent)}</p>
                  </Td>
                  <Td align="right" className={cn('hidden lg:table-cell', trendClass(h.dayChange))}>
                    {formatINR(h.dayChange, { sign: true })}
                    <p className="text-[11px]">{formatPercent(h.dayChangePercent)}</p>
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <button type="button" className="rounded-md bg-gain-soft px-2 py-1 text-xs font-semibold text-gain hover:opacity-80" onClick={() => openOrder({ symbol: h.symbol, side: 'BUY' })}>
                        Buy
                      </button>
                      <button
                        type="button"
                        disabled={h.freeQuantity === 0}
                        className="rounded-md bg-loss-soft px-2 py-1 text-xs font-semibold text-loss hover:opacity-80 disabled:opacity-40"
                        onClick={() => openOrder({ symbol: h.symbol, side: 'SELL', quantity: h.freeQuantity })}
                      >
                        Sell
                      </button>
                      <button type="button" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Alert for ${h.symbol}`} onClick={() => openAlert(h.symbol)}>
                        <BellPlus className="size-4" />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-2/60 font-semibold">
                <Td>Total</Td>
                <Td />
                <Td />
                <Td />
                <Td align="right" className="hidden md:table-cell">{formatINR(summary.invested)}</Td>
                <Td align="right">{formatINR(summary.currentValue)}</Td>
                <Td align="right" className={trendClass(summary.totalPnl)}>{formatINR(summary.totalPnl, { sign: true })}</Td>
                <Td align="right" className={cn('hidden lg:table-cell', trendClass(summary.dayPnl))}>{formatINR(summary.dayPnl, { sign: true })}</Td>
                <Td />
              </tr>
            </tfoot>
          </Table>
        </TableWrap>
      </Card>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="flex flex-col xl:col-span-3">
          <CardHeader
            title="Performance"
            subtitle="Portfolio value vs. amount invested"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-muted">
                  <Switch checked={benchmark} onChange={setBenchmark} label="Compare with NIFTY 50" /> vs NIFTY 50
                </label>
                <Segmented aria-label="Performance range" value={range} onChange={setRange} options={(['1M', '3M', '6M', '1Y', 'ALL'] as const).map((v) => ({ value: v, label: v }))} />
              </div>
            }
          />
          <CardBody className="relative min-h-[300px] flex-1">
            {performance.data ? <PerformanceChart points={performance.data.points} showBenchmark={benchmark} fill /> : <Skeleton className="absolute inset-4" />}
          </CardBody>
          <div className="flex flex-wrap gap-4 border-t border-border px-5 py-2.5 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-primary" /> Portfolio value</span>
            <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t border-dashed border-muted" /> Invested</span>
            {benchmark && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-warning" /> Same investments in NIFTY 50</span>}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Allocation"
            action={
              <Segmented
                aria-label="Allocation view"
                value={allocation}
                onChange={setAllocation}
                options={[
                  { value: 'bySecurity', label: 'Holdings' },
                  { value: 'bySector', label: 'Sector' },
                  { value: 'byType', label: 'Type' },
                ]}
              />
            }
          />
          <CardBody>
            <DonutChart data={liveSlices} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
