import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus, Rocket, Star, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { PerformanceChart } from '@/components/charts/PerformanceChart';
import { LiveChange, LivePrice } from '@/components/market/LivePrice';
import { IndexCard, MoversTable } from '@/components/market/MarketWidgets';
import { OrderStatusBadge } from '@/components/trade/OrderStatusBadge';
import { useTrade } from '@/components/trade/TradeProvider';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/Misc';
import { Skeleton } from '@/components/ui/Spinner';
import { Segmented, Tabs } from '@/components/ui/Tabs';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { useLivePortfolio } from '@/hooks/useLivePortfolio';
import { api, symbolPath } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatINR, formatNumber, formatPercent, relativeTime, trendClass } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { FundsSummary, Ipo, MarketOverview, Order, Page, Performance, PerformanceRange, Portfolio, Watchlist } from '@/lib/types';

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openOrder } = useTrade();
  const [range, setRange] = useState<PerformanceRange>('3M');
  const [moverTab, setMoverTab] = useState<'gainers' | 'losers' | 'active'>('gainers');

  const portfolioQuery = useQuery({ queryKey: keys.portfolio, queryFn: () => api.get<Portfolio>('/portfolio') });
  const portfolio = useLivePortfolio(portfolioQuery.data);
  const { data: funds } = useQuery({ queryKey: keys.funds, queryFn: () => api.get<FundsSummary>('/funds') });
  const { data: market } = useQuery({ queryKey: keys.marketOverview, queryFn: () => api.get<MarketOverview>('/market/overview'), refetchInterval: 60_000 });
  const { data: performance } = useQuery({ queryKey: keys.performance(range), queryFn: () => api.get<Performance>(`/portfolio/performance?range=${range}`) });
  const { data: watchlists } = useQuery({ queryKey: keys.watchlists, queryFn: () => api.get<{ watchlists: Watchlist[] }>('/watchlists') });
  const { data: orders } = useQuery({ queryKey: keys.orders({ recent: true }), queryFn: () => api.get<Page<Order>>('/orders?pageSize=6') });
  const { data: openIpos } = useQuery({ queryKey: keys.ipos('open'), queryFn: () => api.get<{ ipos: Ipo[] }>('/ipos?status=open') });

  const summary = portfolio?.summary;
  const watchlist = watchlists?.watchlists[0];
  // Change in unrealised P&L over the range, so new purchases don't count as gains.
  const periodPnl = (() => {
    const points = performance?.points.filter((p) => p.value > 0) ?? [];
    if (points.length < 2) return null;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    return last.value - last.invested - (first.value - first.invested);
  })();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {greeting()}, {user?.fullName.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {formatDate(market?.status.tradingDate)} · {market?.status.session ?? 'Loading market status…'}
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink to="/funds" variant="secondary" size="sm" icon={<Plus className="size-4" />}>
            Add funds
          </ButtonLink>
          <ButtonLink to="/explore" variant="primary" size="sm">
            Invest now
          </ButtonLink>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Current value"
          value={summary ? formatINR(summary.currentValue) : <Skeleton className="h-7 w-32" />}
          sub={summary && <span className="text-muted">Invested {formatINR(summary.invested, { decimals: 0 })}</span>}
        />
        <Stat
          label="Total returns"
          value={summary ? <span className={trendClass(summary.totalPnl)}>{formatINR(summary.totalPnl, { sign: true })}</span> : <Skeleton className="h-7 w-28" />}
          sub={summary && <span className={trendClass(summary.totalPnl)}>{formatPercent(summary.totalPnlPercent)} overall</span>}
        />
        <Stat
          label="Today's P&L"
          value={summary ? <span className={trendClass(summary.dayPnl)}>{formatINR(summary.dayPnl, { sign: true })}</span> : <Skeleton className="h-7 w-24" />}
          sub={summary && <span className={trendClass(summary.dayPnl)}>{formatPercent(summary.dayPnlPercent)} today</span>}
        />
        <Stat
          label="Available funds"
          icon={<Wallet className="size-4" />}
          value={funds ? formatINR(funds.availableBalance) : <Skeleton className="h-7 w-28" />}
          sub={
            funds && (funds.blockedForOrders + funds.blockedForIpos > 0 ? <span className="text-muted">{formatINR(funds.blockedForOrders + funds.blockedForIpos)} blocked</span> : <Link to="/funds" className="text-primary hover:underline">Add money</Link>)
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="flex flex-col xl:col-span-2">
          <CardHeader
            title="Portfolio performance"
            subtitle={periodPnl !== null ? <span>P&L this period <span className={cn('num font-medium', trendClass(periodPnl))}>{formatINR(periodPnl, { sign: true })}</span> · value vs. invested</span> : 'Value of your holdings over time'}
            action={
              <Segmented
                aria-label="Performance range"
                value={range}
                onChange={setRange}
                options={(['1M', '3M', '6M', '1Y', 'ALL'] as const).map((value) => ({ value, label: value }))}
              />
            }
          />
          <CardBody className="relative min-h-[270px] flex-1 pt-2">
            {performance ? <PerformanceChart points={performance.points} fill /> : <Skeleton className="h-[250px] w-full" />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Market indices" action={<Link to="/markets" className="text-xs font-medium text-primary hover:underline">All markets</Link>} />
          <CardBody className="grid gap-2">
            {market ? market.indices.slice(0, 4).map((index) => <IndexCard key={index.symbol} index={index} compact />) : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title={watchlist ? watchlist.name : 'Watchlist'}
            subtitle="Live prices from your watchlist"
            action={<Link to="/watchlist" className="text-xs font-medium text-primary hover:underline">Manage</Link>}
          />
          {watchlist && watchlist.items.length > 0 ? (
            <ul className="divide-y divide-border">
              {watchlist.items.slice(0, 7).map((item) => (
                <li key={item.symbol} className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2/60 sm:px-5" onClick={() => navigate(`/stocks/${symbolPath(item.symbol)}`)}>
                  <div className="min-w-0">
                    <p className="font-semibold">{item.symbol}</p>
                    <p className="truncate text-xs text-muted">{item.name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <LivePrice symbol={item.symbol} fallback={item.lastPrice} className="text-sm font-medium" />
                      <div>
                        <LiveChange symbol={item.symbol} change={item.change} percent={item.changePercent} showAbsolute={false} className="text-xs" />
                      </div>
                    </div>
                    {item.isTradable && (
                      <button
                        type="button"
                        className="rounded-md bg-gain-soft px-2 py-1 text-xs font-semibold text-gain hover:opacity-80"
                        onClick={(e) => {
                          e.stopPropagation();
                          openOrder({ symbol: item.symbol, side: 'BUY' });
                        }}
                      >
                        Buy
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Star className="size-6" />} title="Your watchlist is empty" description="Add stocks to track their prices here." action={<ButtonLink to="/explore" size="sm">Explore stocks</ButtonLink>} />
          )}
        </Card>

        <Card>
          <CardHeader title="Market movers" subtitle="Top stocks by today's change and activity" />
          <Tabs
            className="px-2"
            value={moverTab}
            onChange={setMoverTab}
            items={[
              { value: 'gainers', label: 'Top gainers' },
              { value: 'losers', label: 'Top losers' },
              { value: 'active', label: 'Most active' },
            ]}
          />
          {market ? <MoversTable items={market[moverTab]} metric={moverTab === 'active' ? 'volume' : 'change'} /> : <Skeleton className="m-4 h-48" />}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recent orders" action={<Link to="/orders" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">All orders <ArrowRight className="size-3" /></Link>} />
          {orders && orders.items.length > 0 ? (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Price</Th>
                    <Th>Status</Th>
                    <Th align="right">Placed</Th>
                  </tr>
                </thead>
                <tbody>
                  {orders.items.map((order) => (
                    <Tr key={order.id}>
                      <Td>
                        <span className={cn('mr-2 text-xs font-bold', order.side === 'BUY' ? 'text-gain' : 'text-loss')}>{order.side}</span>
                        <Link to={`/stocks/${symbolPath(order.symbol)}`} className="font-semibold hover:text-primary">{order.symbol}</Link>
                        <span className="ml-2 text-xs text-muted">{order.orderType === 'MARKET' ? 'Market' : 'Limit'}</span>
                      </Td>
                      <Td align="right">{formatNumber(order.quantity)}</Td>
                      <Td align="right">{formatINR(order.averagePrice ?? order.limitPrice)}</Td>
                      <Td>
                        <OrderStatusBadge status={order.status} />
                      </Td>
                      <Td align="right" className="text-xs text-muted">{relativeTime(order.createdAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <EmptyState title="No orders yet" description="Your recent orders will show up here." />
          )}
        </Card>

        <Card>
          <CardHeader title="IPOs open now" action={<Link to="/ipo" className="text-xs font-medium text-primary hover:underline">All IPOs</Link>} />
          <CardBody className="flex flex-col gap-3">
            {openIpos && openIpos.ipos.length === 0 && <p className="text-sm text-muted">No IPOs are open right now. Check upcoming issues.</p>}
            {openIpos?.ipos.map((ipo) => (
              <Link key={ipo.id} to={`/ipo/${ipo.id}`} className="rounded-lg border border-border p-3 transition-colors hover:border-primary/40">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <Rocket className="size-4 text-primary" />
                    {ipo.companyName}
                  </span>
                  {ipo.myApplication?.status === 'APPLIED' ? <Badge tone="success">Applied</Badge> : <Badge tone="info">Open</Badge>}
                </div>
                <p className="num mt-1 text-xs text-muted">
                  ₹{ipo.priceBand.low}–{ipo.priceBand.high} · Lot {ipo.lotSize} · Closes {formatDate(ipo.dates.close)}
                </p>
                <p className="num mt-1 text-xs">Subscribed <span className="font-semibold">{ipo.subscription.total.toFixed(2)}x</span></p>
              </Link>
            ))}
            {summary && summary.holdingsCount === 0 && (
              <p className="rounded-lg bg-primary-soft p-3 text-xs text-primary">Tip: add funds and buy your first stock to start building your portfolio.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
