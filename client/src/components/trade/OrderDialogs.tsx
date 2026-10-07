import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { LivePrice } from '@/components/market/LivePrice';
import { Button } from '@/components/ui/Button';
import { Input, PinInput } from '@/components/ui/Field';
import { KeyValue } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { api, ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatINR, formatNumber, titleCase, trendClass } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { Order, OrderDetail, OrderType } from '@/lib/types';
import { markLocalAction } from '@/live/localActions';
import { OrderStatusBadge } from './OrderStatusBadge';

function invalidateTrading(queryClient: ReturnType<typeof useQueryClient>) {
  for (const queryKey of [['orders'], ['portfolio'], ['funds'], ['trades'], ['securities', 'detail']]) void queryClient.invalidateQueries({ queryKey });
}

/** Change quantity, price or type of an open order; confirmed with the transaction PIN. */
export function ModifyOrderDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [orderType, setOrderType] = useState<OrderType>(order.orderType);
  const [quantity, setQuantity] = useState(String(order.quantity));
  const [price, setPrice] = useState(String(order.limitPrice ?? order.lastPrice ?? ''));
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const modify = useMutation({
    mutationFn: () =>
      api.patch<{ order: Order }>(`/orders/${order.id}`, {
        quantity: Number(quantity),
        orderType,
        ...(orderType === 'LIMIT' ? { limitPrice: Number(price) } : {}),
        pin,
      }),
    onMutate: () => markLocalAction('ORDER'),
    onSuccess: ({ order: updated }) => {
      toast.success(updated.status === 'EXECUTED' ? 'Order executed' : 'Order modified', {
        description: updated.status === 'EXECUTED' ? `${updated.side === 'BUY' ? 'Bought' : 'Sold'} ${updated.quantity} ${updated.symbol} at ${formatINR(updated.averagePrice)}` : `${updated.symbol}: ${updated.quantity} @ ${formatINR(updated.limitPrice)}`,
      });
      invalidateTrading(queryClient);
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const valid = Number(quantity) > 0 && (orderType === 'MARKET' || Number(price) > 0) && pin.length === 4;
  return (
    <Modal
      open
      onClose={onClose}
      busy={modify.isPending}
      title={`Modify ${order.side === 'BUY' ? 'buy' : 'sell'} order · ${order.symbol}`}
      description={<>LTP <LivePrice symbol={order.symbol} fallback={order.lastPrice ?? 0} className="font-medium text-fg" /></>}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={modify.isPending}>
            Cancel
          </Button>
          <Button loading={modify.isPending} disabled={!valid || !user?.hasPin} onClick={() => { setError(null); modify.mutate(); }}>
            Modify order
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Order type</span>
          <Segmented aria-label="Order type" value={orderType} onChange={setOrderType} options={[{ value: 'LIMIT', label: 'Limit' }, { value: 'MARKET', label: 'Market' }]} />
        </div>
        <Input label="Quantity" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))} />
        {orderType === 'LIMIT' && <Input label="Limit price" type="number" step="0.05" prefix="₹" value={price} onChange={(e) => setPrice(e.target.value)} />}
        {orderType === 'MARKET' && <p className="text-xs text-muted">Converting to a market order executes it immediately at the current price.</p>}
        <PinInput value={pin} onChange={(e) => setPin(e.target.value)} error={error ?? undefined} />
      </div>
    </Modal>
  );
}

const ACTION_LABELS: Record<string, string> = {
  ORDER_PLACED: 'Order placed',
  ORDER_MODIFIED: 'Order modified',
  ORDER_EXECUTED: 'Order executed',
  ORDER_CANCELLED: 'Order cancelled',
  ORDER_REJECTED: 'Order rejected',
  ORDER_EXPIRED: 'Order expired',
};

/** Read-only order details: execution, charges and the audited timeline. */
export function OrderDetailDialog({ orderId, onClose, adminView = false }: { orderId: number; onClose: () => void; adminView?: boolean }) {
  const { data, isPending, error } = useQuery({
    queryKey: [...keys.order(orderId), adminView],
    queryFn: () => api.get<OrderDetail>(adminView ? `/admin/orders/${orderId}` : `/orders/${orderId}`),
  });
  return (
    <Modal open onClose={onClose} title={`Order #${orderId}`} size="lg">
      {isPending ? (
        <PageLoader />
      ) : error ? (
        <p className="text-sm text-loss">{error instanceof ApiError ? error.message : 'Could not load the order'}</p>
      ) : data ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-lg font-semibold">
              <span className={data.order.side === 'BUY' ? 'text-gain' : 'text-loss'}>{data.order.side === 'BUY' ? 'Buy' : 'Sell'}</span> {formatNumber(data.order.quantity)} {data.order.symbol}
            </p>
            <OrderStatusBadge status={data.order.status} />
          </div>
          {data.order.statusReason && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">{data.order.statusReason}</p>}
          <div className="grid gap-x-8 sm:grid-cols-2">
            <KeyValue label="Order type" value={`${titleCase(data.order.orderType)} · ${data.order.validity}`} />
            <KeyValue label="Limit price" value={formatINR(data.order.limitPrice)} />
            <KeyValue label="Executed price" value={formatINR(data.order.averagePrice)} />
            <KeyValue label="Filled quantity" value={`${formatNumber(data.order.filledQuantity)} / ${formatNumber(data.order.quantity)}`} />
            <KeyValue label="Placed" value={formatDateTime(data.order.createdAt)} />
            <KeyValue label="Trading date" value={data.order.tradingDate} />
          </div>
          {data.trade && (
            <div className="rounded-xl border border-border bg-surface-2/50 px-4 py-2">
              <p className="py-1.5 text-sm font-semibold">Trade #{data.trade.id}</p>
              <KeyValue label="Trade value" value={formatINR(data.trade.value)} />
              <KeyValue label="Brokerage" value={formatINR(data.trade.charges.brokerage)} />
              <KeyValue label="STT" value={formatINR(data.trade.charges.stt)} />
              <KeyValue label="Exchange + SEBI" value={formatINR(data.trade.charges.exchangeCharges + data.trade.charges.sebiFees)} />
              <KeyValue label="Stamp duty" value={formatINR(data.trade.charges.stampDuty)} />
              <KeyValue label="GST" value={formatINR(data.trade.charges.gst)} />
              <KeyValue className="border-t border-border font-semibold" label={data.trade.side === 'BUY' ? 'Total debited' : 'Net credited'} value={formatINR(data.trade.netAmount)} />
              {data.trade.realizedPnl !== null && <KeyValue label="Realized P&L" value={<span className={trendClass(data.trade.realizedPnl)}>{formatINR(data.trade.realizedPnl, { sign: true })}</span>} />}
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-semibold">Timeline</p>
            <ol className="relative ml-2 border-l border-border">
              {data.timeline.map((event, index) => (
                <li key={index} className="mb-3 ml-4 last:mb-0">
                  <span className={cn('absolute -left-[5px] mt-1.5 size-2.5 rounded-full', event.action === 'ORDER_EXECUTED' ? 'bg-gain' : event.action === 'ORDER_REJECTED' ? 'bg-loss' : 'bg-primary')} />
                  <p className="text-sm font-medium">{ACTION_LABELS[event.action] ?? titleCase(event.action)}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(event.createdAt)} · by {event.actorRole === 'SYSTEM' ? 'exchange (system)' : event.actorRole === 'ADMIN' ? 'administrator' : 'you'}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
