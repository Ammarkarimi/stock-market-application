import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { LivePrice } from '@/components/market/LivePrice';
import { ModifyOrderDialog, OrderDetailDialog } from '@/components/trade/OrderDialogs';
import { OrderStatusBadge } from '@/components/trade/OrderStatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState, PageHeader, Pagination } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, errorMessage, qs, symbolPath } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatINR, formatNumber, relativeTime, trendClass } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { Order, Page, TradesPage } from '@/lib/types';
import { markLocalAction } from '@/live/localActions';

type Tab = 'open' | 'history' | 'trades';

function SideLabel({ side }: { side: Order['side'] }) {
  return <span className={cn('text-xs font-bold', side === 'BUY' ? 'text-gain' : 'text-loss')}>{side}</span>;
}

function OpenOrders({ onShow }: { onShow: (id: number) => void }) {
  const queryClient = useQueryClient();
  const [modifying, setModifying] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: keys.orders({ status: 'OPEN' }),
    queryFn: () => api.get<Page<Order>>('/orders?status=OPEN&pageSize=100'),
  });
  const cancel = useMutation({
    mutationFn: (id: number) => api.post<{ order: Order }>(`/orders/${id}/cancel`),
    onMutate: () => markLocalAction('ORDER'),
    onSuccess: () => {
      toast.success('Order cancelled');
      setCancelling(null);
      for (const queryKey of [['orders'], ['funds'], ['portfolio']]) void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (isPending) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (data.items.length === 0) return <EmptyState title="No open orders" description="Limit orders waiting to execute appear here. They expire at the end of the trading day." />;

  return (
    <>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Limit price</Th>
              <Th align="right">LTP</Th>
              <Th align="right" className="hidden md:table-cell">Blocked</Th>
              <Th className="hidden sm:table-cell">Placed</Th>
              <Th align="right"><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((order) => (
              <Tr key={order.id}>
                <Td>
                  <button type="button" className="text-left" onClick={() => onShow(order.id)}>
                    <SideLabel side={order.side} /> <span className="font-semibold hover:text-primary">{order.symbol}</span>
                    <p className="text-xs text-muted">#{order.id} · Limit · {order.validity}</p>
                  </button>
                </Td>
                <Td align="right">{formatNumber(order.quantity)}</Td>
                <Td align="right">{formatINR(order.limitPrice)}</Td>
                <Td align="right"><LivePrice symbol={order.symbol} fallback={order.lastPrice ?? 0} /></Td>
                <Td align="right" className="hidden md:table-cell text-muted">{order.blockedAmount ? formatINR(order.blockedAmount) : `${order.quantity} shares`}</Td>
                <Td className="hidden text-xs text-muted sm:table-cell">{relativeTime(order.createdAt)}</Td>
                <Td align="right">
                  <div className="flex justify-end gap-1">
                    <button type="button" className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft" onClick={() => setModifying(order)}>
                      <Pencil className="size-3.5" /> Modify
                    </button>
                    <button type="button" className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-loss hover:bg-loss-soft" onClick={() => setCancelling(order)}>
                      <X className="size-3.5" /> Cancel
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      {modifying && <ModifyOrderDialog order={modifying} onClose={() => setModifying(null)} />}
      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Cancel this order?"
        description={cancelling && `${cancelling.side === 'BUY' ? 'Buy' : 'Sell'} ${cancelling.quantity} ${cancelling.symbol} at ${formatINR(cancelling.limitPrice)}. Any blocked funds or shares will be released.`}
        confirmLabel="Cancel order"
        variant="danger"
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
        onClose={() => setCancelling(null)}
      />
    </>
  );
}

function OrderHistory({ onShow }: { onShow: (id: number) => void }) {
  const [filters, setFilters] = useState({ status: '', side: '', symbol: '', from: '', to: '', page: 1 });
  const set = (changes: Partial<typeof filters>) => setFilters((f) => ({ ...f, page: 1, ...changes }));
  const { data, isPending, error, refetch } = useQuery({
    queryKey: keys.orders(filters),
    queryFn: () => api.get<Page<Order>>(`/orders${qs({ ...filters, symbol: filters.symbol.toUpperCase(), pageSize: 20 })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3 lg:grid-cols-5">
        <Select aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">All statuses</option>
          {['OPEN', 'EXECUTED', 'CANCELLED', 'REJECTED', 'EXPIRED'].map((s) => (
            <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
          ))}
        </Select>
        <Select aria-label="Side" value={filters.side} onChange={(e) => set({ side: e.target.value })}>
          <option value="">Buy & sell</option>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
        </Select>
        <Input aria-label="Symbol" placeholder="Symbol" value={filters.symbol} onChange={(e) => set({ symbol: e.target.value.trim() })} />
        <Input aria-label="From date" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        <Input aria-label="To date" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
      </div>
      {isPending ? (
        <PageLoader />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No orders match these filters" />
      ) : (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Price</Th>
                  <Th>Status</Th>
                  <Th align="right" className="hidden md:table-cell">Placed</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((order) => (
                  <Tr key={order.id} className="cursor-pointer" onClick={() => onShow(order.id)}>
                    <Td>
                      <button type="button" className="text-left" onClick={(e) => { e.stopPropagation(); onShow(order.id); }}>
                        <SideLabel side={order.side} /> <span className="font-semibold hover:text-primary">{order.symbol}</span>
                        <p className="text-xs text-muted">#{order.id} · {order.orderType === 'MARKET' ? 'Market' : `Limit ${formatINR(order.limitPrice)}`}{order.orderType === 'LIMIT' ? ` · ${order.validity}` : ''}</p>
                      </button>
                    </Td>
                    <Td align="right">{formatNumber(order.quantity)}</Td>
                    <Td align="right">{formatINR(order.averagePrice ?? order.limitPrice)}</Td>
                    <Td>
                      <OrderStatusBadge status={order.status} />
                      {order.statusReason && order.status !== 'EXECUTED' && <p className="mt-1 max-w-64 truncate text-xs text-muted" title={order.statusReason}>{order.statusReason}</p>}
                    </Td>
                    <Td align="right" className="hidden text-xs text-muted md:table-cell">{formatDateTime(order.createdAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => setFilters((f) => ({ ...f, page }))} />
        </>
      )}
    </>
  );
}

function TradeHistory() {
  const [filters, setFilters] = useState({ side: '', symbol: '', from: '', to: '', page: 1 });
  const set = (changes: Partial<typeof filters>) => setFilters((f) => ({ ...f, page: 1, ...changes }));
  const { data, isPending, error, refetch } = useQuery({
    queryKey: keys.trades(filters),
    queryFn: () => api.get<TradesPage>(`/trades${qs({ ...filters, symbol: filters.symbol.toUpperCase(), pageSize: 20 })}`),
    placeholderData: keepPreviousData,
  });
  const csvHref = `/api/statements/trades.csv${qs({ from: filters.from || '2000-01-01', to: filters.to })}`;

  return (
    <>
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Select aria-label="Side" value={filters.side} onChange={(e) => set({ side: e.target.value })}>
          <option value="">Buy & sell</option>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
        </Select>
        <Input aria-label="Symbol" placeholder="Symbol" value={filters.symbol} onChange={(e) => set({ symbol: e.target.value.trim() })} />
        <Input aria-label="From date" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        <Input aria-label="To date" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        <a href={csvHref} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium hover:bg-surface-2">
          <Download className="size-4" /> Download CSV
        </a>
      </div>
      {isPending ? (
        <PageLoader />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No trades yet" description="Executed buy and sell trades are listed here with their charges." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
            {[
              ['Bought', formatINR(data.totals.buyValue)],
              ['Sold', formatINR(data.totals.sellValue)],
              ['Charges paid', formatINR(data.totals.charges)],
              ['Realized P&L', <span key="pnl" className={trendClass(data.totals.realizedPnl)}>{formatINR(data.totals.realizedPnl, { sign: true })}</span>],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-surface px-4 py-3">
                <p className="text-xs text-muted">{label}</p>
                <p className="num mt-0.5 font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Trade</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Price</Th>
                  <Th align="right" className="hidden md:table-cell">Value</Th>
                  <Th align="right" className="hidden lg:table-cell">Charges</Th>
                  <Th align="right">Net amount</Th>
                  <Th align="right">P&L</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((trade) => (
                  <Tr key={trade.id}>
                    <Td>
                      <SideLabel side={trade.side} />{' '}
                      <Link to={`/stocks/${symbolPath(trade.symbol)}`} className="font-semibold hover:text-primary">{trade.symbol}</Link>
                      {trade.source === 'IPO' && <Badge tone="primary" className="ml-2">IPO</Badge>}
                      <p className="text-xs text-muted">{formatDateTime(trade.executedAt)}</p>
                    </Td>
                    <Td align="right">{formatNumber(trade.quantity)}</Td>
                    <Td align="right">{formatINR(trade.price)}</Td>
                    <Td align="right" className="hidden md:table-cell">{formatINR(trade.value)}</Td>
                    <Td align="right" className="hidden text-muted lg:table-cell">{formatINR(trade.charges.total)}</Td>
                    <Td align="right">{formatINR(trade.netAmount)}</Td>
                    <Td align="right" className={trendClass(trade.realizedPnl)}>{trade.realizedPnl === null ? '—' : formatINR(trade.realizedPnl, { sign: true })}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => setFilters((f) => ({ ...f, page }))} />
        </>
      )}
    </>
  );
}

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'open';
  const [detailId, setDetailId] = useState<number | null>(null);
  const { data: openCount } = useQuery({
    queryKey: keys.orders({ status: 'OPEN', count: true }),
    queryFn: () => api.get<Page<Order>>('/orders?status=OPEN&pageSize=1'),
  });

  return (
    <div>
      <PageHeader title="Orders" description="Track open orders, your full order history and executed trades." />
      <Card>
        <Tabs
          className="px-2"
          value={tab}
          onChange={(value) => setParams({ tab: value }, { replace: true })}
          items={[
            { value: 'open', label: 'Open orders', count: openCount?.total },
            { value: 'history', label: 'Order history' },
            { value: 'trades', label: 'Trades' },
          ]}
        />
        {tab === 'open' && <OpenOrders onShow={setDetailId} />}
        {tab === 'history' && <OrderHistory onShow={setDetailId} />}
        {tab === 'trades' && <TradeHistory />}
      </Card>
      {detailId !== null && <OrderDetailDialog orderId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
