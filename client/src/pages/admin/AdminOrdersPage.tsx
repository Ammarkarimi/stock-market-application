import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { OrderDetailDialog } from '@/components/trade/OrderDialogs';
import { OrderStatusBadge } from '@/components/trade/OrderStatusBadge';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState, PageHeader, Pagination } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, errorMessage, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatINR, formatNumber } from '@/lib/format';
import type { Order, Page } from '@/lib/types';

export default function AdminOrdersPage() {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({ status: '', side: '', symbol: '', userId: params.get('userId') ?? '', from: '', to: '', page: 1 });
  const [detail, setDetail] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const set = (changes: Partial<typeof filters>) => setFilters((f) => ({ ...f, page: 1, ...changes }));
  const query = { ...filters, symbol: filters.symbol.toUpperCase(), pageSize: 25 };
  const { data, isPending, error, refetch } = useQuery({ queryKey: ['admin', 'orders', query], queryFn: () => api.get<Page<Order>>(`/admin/orders${qs(query)}`), placeholderData: keepPreviousData, refetchInterval: 15_000 });
  const cancel = useMutation({
    mutationFn: ({ order, reason }: { order: Order; reason: string }) => api.post(`/admin/orders/${order.id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success('Order cancelled');
      setCancelling(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div>
      <PageHeader title="Orders" description="Every order across the platform, with status and reasons." />
      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Select aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            {['OPEN', 'EXECUTED', 'CANCELLED', 'REJECTED', 'EXPIRED'].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
          </Select>
          <Select aria-label="Side" value={filters.side} onChange={(e) => set({ side: e.target.value })}>
            <option value="">Buy & sell</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </Select>
          <Input aria-label="Symbol" placeholder="Symbol" value={filters.symbol} onChange={(e) => set({ symbol: e.target.value.trim() })} />
          <Input aria-label="User ID" placeholder="User ID" inputMode="numeric" value={filters.userId} onChange={(e) => set({ userId: e.target.value.replace(/\D/g, '') })} />
          <Input aria-label="From" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          <Input aria-label="To" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
        {isPending ? <PageLoader /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : data.items.length === 0 ? <EmptyState title="No orders match" /> : (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Investor</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Price</Th>
                    <Th>Status</Th>
                    <Th align="right" className="hidden lg:table-cell">Placed</Th>
                    <Th align="right"><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((order) => (
                    <Tr key={order.id}>
                      <Td>
                        <button type="button" className="text-left" onClick={() => setDetail(order.id)}>
                          <span className={cn('text-xs font-bold', order.side === 'BUY' ? 'text-gain' : 'text-loss')}>{order.side}</span> <span className="font-semibold hover:text-primary">{order.symbol}</span>
                          <p className="text-xs text-muted">#{order.id} · {order.orderType === 'MARKET' ? 'Market' : `Limit · ${order.validity}`}</p>
                        </button>
                      </Td>
                      <Td><Link to={`/admin/users/${order.userId}`} className="hover:text-primary">{order.userName}</Link></Td>
                      <Td align="right">{formatNumber(order.quantity)}</Td>
                      <Td align="right">{formatINR(order.averagePrice ?? order.limitPrice)}</Td>
                      <Td>
                        <OrderStatusBadge status={order.status} />
                        {order.statusReason && order.status !== 'EXECUTED' && <p className="mt-1 max-w-56 truncate text-xs text-muted" title={order.statusReason}>{order.statusReason}</p>}
                      </Td>
                      <Td align="right" className="hidden text-xs text-muted lg:table-cell">{formatDateTime(order.createdAt)}</Td>
                      <Td align="right">
                        {order.status === 'OPEN' && <button type="button" className="rounded-md px-2 py-1 text-xs font-medium text-loss hover:bg-loss-soft" onClick={() => setCancelling(order)}>Cancel</button>}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => setFilters((f) => ({ ...f, page }))} />
          </>
        )}
      </Card>
      {detail !== null && <OrderDetailDialog orderId={detail} adminView onClose={() => setDetail(null)} />}
      <ConfirmDialog
        open={Boolean(cancelling)}
        title={`Cancel order #${cancelling?.id}?`}
        description={cancelling && `${cancelling.userName}'s ${cancelling.side.toLowerCase()} order for ${cancelling.quantity} ${cancelling.symbol}. The investor is notified with your reason.`}
        confirmLabel="Cancel order"
        variant="danger"
        requireReason
        loading={cancel.isPending}
        onConfirm={(reason) => cancelling && cancel.mutate({ order: cancelling, reason })}
        onClose={() => setCancelling(null)}
      />
    </div>
  );
}
