import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellPlus, Check, ChevronDown, ExternalLink, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { PriceChart } from '@/components/charts/PriceChart';
import { ChangePill, LiveChange, LivePrice, useLiveQuote } from '@/components/market/LivePrice';
import { MoversTable } from '@/components/market/MarketWidgets';
import { useTrade } from '@/components/trade/TradeProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorState, KeyValue, Menu, MenuItem } from '@/components/ui/Misc';
import { PageLoader, Skeleton } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { api, errorMessage, symbolPath } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatCompact, formatCrores, formatDate, formatINR, formatNumber, formatPercent, formatPrice, trendClass } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { Constituent, HistoryRange, PriceHistory, SecurityDetail, Watchlist } from '@/lib/types';
import { useLiveTick } from '@/live/priceStore';

const RANGES: HistoryRange[] = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y'];
const BAR_SECONDS: Partial<Record<HistoryRange, number>> = { '1D': 300, '1W': 1800 };

function DayRange({ low, high, current }: { low: number; high: number; current: number }) {
  const position = high > low ? ((current - low) / (high - low)) * 100 : 50;
  return (
    <div>
      <div className="relative h-1.5 rounded-full bg-[linear-gradient(90deg,var(--loss),var(--warning),var(--gain))] opacity-80">
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-fg shadow" style={{ left: `${Math.min(100, Math.max(0, position))}%` }} />
      </div>
      <div className="num mt-1.5 flex justify-between text-xs text-muted">
        <span>{formatPrice(low)}</span>
        <span>{formatPrice(high)}</span>
      </div>
    </div>
  );
}

function WatchlistButton({ detail }: { detail: SecurityDetail }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: keys.watchlists, queryFn: () => api.get<{ watchlists: Watchlist[] }>('/watchlists') });
  const inLists = new Set(detail.watchlists.map((w) => w.id));
  const toggle = useMutation({
    mutationFn: ({ id, add }: { id: number; add: boolean }) =>
      add ? api.post(`/watchlists/${id}/items`, { symbol: detail.quote.symbol }) : api.delete(`/watchlists/${id}/items/${symbolPath(detail.quote.symbol)}`),
    onSuccess: (_data, { add, id }) => {
      const name = data?.watchlists.find((w) => w.id === id)?.name ?? 'watchlist';
      toast.success(add ? `Added to ${name}` : `Removed from ${name}`);
      void queryClient.invalidateQueries({ queryKey: keys.security(detail.quote.symbol) });
      void queryClient.invalidateQueries({ queryKey: keys.watchlists });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const watched = inLists.size > 0;
  return (
    <Menu
      trigger={({ toggle: open }) => (
        <Button variant="secondary" onClick={open} icon={<Star className={cn('size-4', watched && 'fill-warning text-warning')} />}>
          {watched ? 'Watching' : 'Watch'} <ChevronDown className="size-3.5" />
        </Button>
      )}
    >
      {(close) => (
        <>
          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Add to watchlist</p>
          {data?.watchlists.map((list) => (
            <MenuItem
              key={list.id}
              icon={inLists.has(list.id) ? <Check className="size-4 text-gain" /> : <span className="inline-block size-4" />}
              onClick={() => {
                close();
                toggle.mutate({ id: list.id, add: !inLists.has(list.id) });
              }}
            >
              {list.name}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

export default function SecurityPage() {
  const { symbol = '' } = useParams();
  const upper = symbol.toUpperCase();
  const [range, setRange] = useState<HistoryRange>('1D');
  const [mode, setMode] = useState<'area' | 'candle'>('area');
  const { openOrder, openAlert } = useTrade();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: keys.security(upper),
    queryFn: () => api.get<SecurityDetail>(`/securities/${symbolPath(upper)}`),
    refetchInterval: 30_000,
  });
  const history = useQuery({
    queryKey: keys.history(upper, range),
    queryFn: () => api.get<PriceHistory>(`/securities/${symbolPath(upper)}/history?range=${range}`),
    staleTime: range === '1D' ? 30_000 : 300_000,
  });
  const detail = detailQuery.data;
  const isIndex = detail?.security.type === 'INDEX';
  const constituents = useQuery({
    queryKey: keys.constituents(upper),
    queryFn: () => api.get<{ items: Constituent[] }>(`/securities/${symbolPath(upper)}/constituents`),
    enabled: isIndex,
  });
  const quote = useLiveQuote(upper, detail?.quote);
  const tick = useLiveTick(upper);
  const deleteAlert = useMutation({
    mutationFn: (id: number) => api.delete(`/alerts/${id}`),
    onSuccess: () => {
      toast.success('Alert deleted');
      void queryClient.invalidateQueries({ queryKey: keys.security(upper) });
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  if (detailQuery.isPending) return <PageLoader />;
  if (detailQuery.isError) return <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />;
  if (!detail || !quote) return null;

  const { security, metrics, position } = detail;
  const high = Math.max(quote.high, tick?.high ?? 0);
  const low = Math.min(quote.low, tick?.low ?? Number.MAX_VALUE);
  const halted = security.tradingStatus === 'HALTED';
  const livePosition = position && position.quantity > 0
    ? (() => {
        const currentValue = position.quantity * quote.lastPrice;
        return { ...position, currentValue, pnl: currentValue - position.invested, pnlPercent: position.invested ? ((currentValue - position.invested) / position.invested) * 100 : 0 };
      })()
    : null;

  const metricRows: [string, string][] = isIndex
    ? [
        ['Open', formatPrice(quote.open)],
        ['Previous close', formatPrice(quote.prevClose)],
        ['Day high', formatPrice(high)],
        ['Day low', formatPrice(low)],
        ['52-week high', formatPrice(metrics.week52High)],
        ['52-week low', formatPrice(metrics.week52Low)],
      ]
    : [
        ['Market cap', formatCrores(metrics.marketCapCr)],
        ['P/E ratio', metrics.pe?.toFixed(2) ?? '—'],
        ['P/B ratio', metrics.pb?.toFixed(2) ?? '—'],
        ['EPS (TTM)', metrics.eps !== null ? formatINR(metrics.eps) : '—'],
        ['Dividend yield', metrics.dividendYield !== null ? formatPercent(metrics.dividendYield, { sign: false }) : '—'],
        ['ROE', metrics.roe !== null ? formatPercent(metrics.roe, { sign: false }) : '—'],
        ['Debt to equity', metrics.debtToEquity?.toFixed(2) ?? '—'],
        ['Beta', metrics.beta?.toFixed(2) ?? '—'],
        ['Book value', metrics.bookValue !== null ? formatINR(metrics.bookValue) : '—'],
        ['Face value', security.faceValue !== null ? formatINR(security.faceValue) : '—'],
        ['52-week high', formatINR(metrics.week52High)],
        ['52-week low', formatINR(metrics.week52Low)],
        ['Volume', formatCompact(tick?.volume ?? quote.volume)],
        ['Avg. volume (20D)', formatCompact(metrics.avgVolume20d)],
        ['Upper circuit', formatINR(metrics.upperCircuit)],
        ['Lower circuit', formatINR(metrics.lowerCircuit)],
        ...(security.expenseRatio !== null ? ([['Expense ratio', formatPercent(security.expenseRatio, { sign: false })]] as [string, string][]) : []),
      ];

  const maxRevenue = Math.max(1, ...detail.financials.map((f) => f.revenueCr));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{security.name}</h1>
            <Badge tone={isIndex ? 'info' : security.type === 'STOCK' ? 'neutral' : 'primary'}>{security.type}</Badge>
            {halted && <Badge tone="warning">Trading halted</Badge>}
            {detail.priceSource === 'simulated' && <Badge tone="neutral">Simulated prices</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {security.exchange}: {security.symbol}
            {security.sector && ` · ${security.sector}`}
            {security.industry && ` · ${security.industry}`}
          </p>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <LivePrice symbol={upper} fallback={detail.quote.lastPrice} prefix={isIndex ? '' : '₹'} className="text-3xl font-semibold tracking-tight" />
            <LiveChange symbol={upper} change={detail.quote.change} percent={detail.quote.changePercent} className="text-base font-medium" icon />
            <span className="text-xs text-muted">today</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {security.isTradable && (
            <>
              <Button variant="buy" disabled={halted} onClick={() => openOrder({ symbol: upper, side: 'BUY' })}>
                Buy
              </Button>
              <Button variant="sell" disabled={halted || !position?.freeQuantity} onClick={() => openOrder({ symbol: upper, side: 'SELL', quantity: position?.freeQuantity })}>
                Sell
              </Button>
            </>
          )}
          <WatchlistButton detail={detail} />
          <Button variant="secondary" icon={<BellPlus className="size-4" />} onClick={() => openAlert(upper)}>
            Alert
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="flex flex-col xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <Segmented aria-label="Chart range" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: r }))} />
            <div className="flex items-center gap-3">
              {range !== '1D' && detail.performance[range] != null && <ChangePill percent={detail.performance[range]!} />}
              <Segmented
                aria-label="Chart type"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'area', label: 'Line' },
                  { value: 'candle', label: 'Candles' },
                ]}
              />
            </div>
          </div>
          <div className="relative mx-2 mb-2 mt-1 min-h-[380px] flex-1">
            {history.data ? (
              <PriceChart candles={history.data.candles} mode={mode} barSeconds={BAR_SECONDS[range]} baseline={range === '1D' ? quote.prevClose : undefined} liveSymbol={upper} fill />
            ) : (
              <Skeleton className="absolute inset-0" />
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Today" />
            <CardBody className="flex flex-col gap-4">
              <div>
                <p className="mb-2 text-xs text-muted">Day range</p>
                <DayRange low={low} high={high} current={quote.lastPrice} />
              </div>
              <div>
                <p className="mb-2 text-xs text-muted">52-week range</p>
                <DayRange low={Math.min(metrics.week52Low, low)} high={Math.max(metrics.week52High, high)} current={quote.lastPrice} />
              </div>
              <div className="grid grid-cols-2 gap-x-6">
                <KeyValue label="Open" value={formatPrice(quote.open)} />
                <KeyValue label="Prev. close" value={formatPrice(quote.prevClose)} />
              </div>
            </CardBody>
          </Card>

          {livePosition && (
            <Card>
              <CardHeader title="Your position" action={<Link to="/portfolio" className="text-xs font-medium text-primary hover:underline">Portfolio</Link>} />
              <CardBody className="py-3">
                <KeyValue label="Quantity" value={`${formatNumber(livePosition.quantity)}${livePosition.freeQuantity < livePosition.quantity ? ` (${formatNumber(livePosition.freeQuantity)} free)` : ''}`} />
                <KeyValue label="Avg. price" value={formatINR(livePosition.averagePrice)} />
                <KeyValue label="Invested" value={formatINR(livePosition.invested)} />
                <KeyValue label="Current value" value={formatINR(livePosition.currentValue)} />
                <KeyValue label="Returns" value={<span className={trendClass(livePosition.pnl)}>{formatINR(livePosition.pnl, { sign: true })} ({formatPercent(livePosition.pnlPercent)})</span>} />
              </CardBody>
            </Card>
          )}

          {detail.alerts.length > 0 && (
            <Card>
              <CardHeader title="Active alerts" action={<Link to="/alerts" className="text-xs font-medium text-primary hover:underline">All alerts</Link>} />
              <ul className="divide-y divide-border">
                {detail.alerts.map((alert) => (
                  <li key={alert.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>
                      {alert.condition === 'ABOVE' ? 'Above' : 'Below'} <span className="num font-semibold">{formatINR(alert.targetPrice)}</span>
                      {alert.note && <span className="block text-xs text-muted">{alert.note}</span>}
                    </span>
                    <button type="button" className="rounded p-1.5 text-muted hover:bg-loss-soft hover:text-loss" aria-label="Delete alert" onClick={() => deleteAlert.mutate(alert.id)}>
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader title="Returns" subtitle="Price change over each period" />
        <CardBody className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {Object.entries(detail.performance).map(([period, change]) => (
            <div key={period} className="rounded-lg bg-surface-2 p-3 text-center">
              <p className="text-xs text-muted">{period}</p>
              <p className={cn('num mt-1 font-semibold', trendClass(change))}>{formatPercent(change)}</p>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={isIndex ? 'Index statistics' : 'Key metrics'} />
          <CardBody className="grid gap-x-8 sm:grid-cols-2">
            {metricRows.map(([label, value]) => (
              <KeyValue key={label} label={label} value={value} className="border-b border-border/60" />
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="About" />
          <CardBody className="flex flex-col gap-3 text-sm">
            {security.description && <p className="leading-relaxed text-muted">{security.description}</p>}
            <div>
              {security.sector && <KeyValue label="Sector" value={security.sector} />}
              {security.industry && <KeyValue label="Industry" value={security.industry} />}
              {security.foundedYear && <KeyValue label="Founded" value={security.foundedYear} />}
              {security.headquarters && <KeyValue label="Headquarters" value={security.headquarters} />}
              {security.listingDate && <KeyValue label="Listed on" value={formatDate(security.listingDate)} />}
              <KeyValue label="Tick size" value={`₹${security.tickSize.toFixed(2)}`} />
            </div>
            {security.underlyingSymbol && (
              <Link to={`/stocks/${symbolPath(security.underlyingSymbol)}`} className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Tracks {security.underlyingSymbol} <ExternalLink className="size-3.5" />
              </Link>
            )}
            {detail.memberOf.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-muted">Part of</p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.memberOf.map((index) => (
                    <Link key={index.symbol} to={`/stocks/${symbolPath(index.symbol)}`} className="rounded-md bg-surface-2 px-2 py-1 text-xs font-medium hover:text-primary">
                      {index.name} <span className="num text-muted">{index.weight}%</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {detail.financials.length > 0 && (
        <Card>
          <CardHeader title="Financials" subtitle={`Annual revenue and net profit (₹ crore, ${detail.financialsSource === 'reported' ? 'as reported' : 'illustrative'})`} />
          <CardBody>
            <div className="flex h-48 items-end gap-3 sm:gap-6">
              {detail.financials.map((f) => (
                <div key={f.year} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex h-40 w-full items-end justify-center gap-1">
                    <div className="w-1/3 max-w-8 rounded-t bg-primary/80" style={{ height: `${(f.revenueCr / maxRevenue) * 100}%` }} title={`Revenue ₹${formatNumber(f.revenueCr)} Cr`} />
                    <div className="w-1/3 max-w-8 rounded-t bg-gain" style={{ height: `${Math.max(1, (Math.max(0, f.netProfitCr) / maxRevenue) * 100)}%` }} title={`Net profit ₹${formatNumber(f.netProfitCr)} Cr`} />
                  </div>
                  <span className="text-xs text-muted">{f.year}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary/80" /> Revenue</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-gain" /> Net profit</span>
            </div>
            <div className="relative mt-4 overflow-x-auto">
              <table className="num w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="py-1.5 text-left font-medium">₹ Cr</th>
                    {detail.financials.map((f) => (
                      <th key={f.year} className="py-1.5 text-right font-medium">{f.year}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="py-1.5 text-muted">Revenue</td>
                    {detail.financials.map((f) => <td key={f.year} className="py-1.5 text-right">{formatNumber(f.revenueCr)}</td>)}
                  </tr>
                  <tr className="border-t border-border">
                    <td className="py-1.5 text-muted">Net profit</td>
                    {detail.financials.map((f) => <td key={f.year} className="py-1.5 text-right">{formatNumber(f.netProfitCr)}</td>)}
                  </tr>
                  <tr className="border-t border-border">
                    <td className="py-1.5 text-muted">Net margin</td>
                    {detail.financials.map((f) => <td key={f.year} className="py-1.5 text-right">{f.netMarginPct}%</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {isIndex && (
        <Card>
          <CardHeader title="Constituents" subtitle="Weights and contribution to today's move" />
          {constituents.data ? (
            <div>
              <MoversTable items={constituents.data.items} />
              <p className="px-4 py-3 text-xs text-muted">
                Biggest contributors:{' '}
                {[...constituents.data.items]
                  .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
                  .slice(0, 3)
                  .map((c) => `${c.symbol} (${c.contribution > 0 ? '+' : ''}${c.contribution.toFixed(2)}%)`)
                  .join(', ')}
              </p>
            </div>
          ) : (
            <PageLoader />
          )}
        </Card>
      )}
    </div>
  );
}
