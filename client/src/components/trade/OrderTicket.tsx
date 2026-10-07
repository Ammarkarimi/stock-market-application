import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Minus, Plus, ShieldAlert, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { LiveChange, LivePrice } from '@/components/market/LivePrice';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Input, PinInput } from '@/components/ui/Field';
import { KeyValue } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { Segmented } from '@/components/ui/Tabs';
import { api, ApiError, symbolPath } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatINR, formatNumber, formatPrice } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { FundsSummary, Order, OrderPreview, OrderSide, OrderType, OrderValidity, SecurityDetail } from '@/lib/types';
import { markLocalAction } from '@/live/localActions';
import { useLiveTick } from '@/live/priceStore';

export interface TicketRequest {
  symbol: string;
  side: OrderSide;
  quantity?: number;
  orderType?: OrderType;
  limitPrice?: number;
}

type Step = 'form' | 'confirm' | 'result';

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function roundToTick(price: number, tick: number): number {
  return Math.round(Math.round(price / tick) * tick * 100) / 100;
}

/** Buy/sell order entry with live charge preview, PIN confirmation and an outcome screen. */
export function OrderTicket({ request, onClose }: { request: TicketRequest; onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [side, setSide] = useState<OrderSide>(request.side);
  const [orderType, setOrderType] = useState<OrderType>(request.orderType ?? 'MARKET');
  const [quantity, setQuantity] = useState(String(request.quantity ?? 1));
  const [limitPrice, setLimitPrice] = useState(request.limitPrice ? String(request.limitPrice) : '');
  const [validity, setValidity] = useState<OrderValidity>('DAY');
  const [step, setStep] = useState<Step>('form');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [showCharges, setShowCharges] = useState(false);
  const [result, setResult] = useState<Order | null>(null);
  const tick = useLiveTick(request.symbol);

  const { data: detail } = useQuery({
    queryKey: keys.security(request.symbol),
    queryFn: () => api.get<SecurityDetail>(`/securities/${symbolPath(request.symbol)}`),
  });
  const { data: funds } = useQuery({ queryKey: keys.funds, queryFn: () => api.get<FundsSummary>('/funds') });

  const tickSize = detail?.security.tickSize ?? 0.05;
  const lastPrice = tick?.lastPrice ?? detail?.quote.lastPrice ?? 0;

  // Pre-fill the limit price with the current price the first time the user switches to a limit order.
  useEffect(() => {
    if (orderType === 'LIMIT' && !limitPrice && lastPrice) setLimitPrice(String(roundToTick(lastPrice, tickSize)));
  }, [orderType, limitPrice, lastPrice, tickSize]);

  const qty = Number.parseInt(quantity, 10);
  const price = Number.parseFloat(limitPrice);
  const inputValid = Number.isInteger(qty) && qty > 0 && (orderType === 'MARKET' || (Number.isFinite(price) && price > 0));
  const previewInput = useDebounced(
    useMemo(
      () => ({ symbol: request.symbol, side, orderType, quantity: qty, limitPrice: orderType === 'LIMIT' ? price : null, validity: orderType === 'LIMIT' ? validity : 'DAY' }),
      [request.symbol, side, orderType, qty, price, validity],
    ),
  );

  const preview = useQuery({
    queryKey: ['order-preview', previewInput],
    queryFn: () => api.post<OrderPreview>('/orders/preview', previewInput),
    enabled: inputValid && step !== 'result',
    refetchInterval: step === 'form' && orderType === 'MARKET' ? 4000 : false,
    retry: false,
    placeholderData: (previous) => previous,
  });

  const place = useMutation({
    mutationFn: () => api.post<{ order: Order }>('/orders', { ...previewInput, pin }),
    onMutate: () => markLocalAction('ORDER'),
    onSuccess: ({ order }) => {
      setResult(order);
      setStep('result');
      for (const queryKey of [['orders'], ['portfolio'], ['funds'], ['trades'], ['securities', 'detail']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && ['INVALID_PIN', 'LOCKED', 'PIN_REQUIRED', 'PIN_NOT_SET'].includes(err.code)) setPinError(err.message);
      else setPinError(err instanceof ApiError ? err.message : 'Could not place the order');
    },
  });

  const position = detail?.position;
  const maxBuy = funds && lastPrice ? Math.floor(funds.availableBalance / ((orderType === 'LIMIT' && price) || lastPrice) / 1.0015) : 0;
  const previewError = preview.error instanceof ApiError ? preview.error.message : null;
  const issues = preview.data?.issues ?? [];
  const canReview = inputValid && !!preview.data && preview.data.canPlace && !preview.isFetching;
  const sideColor = side === 'BUY' ? 'text-gain' : 'text-loss';

  const title = (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span>
        <span className={sideColor}>{side === 'BUY' ? 'Buy' : 'Sell'}</span> {request.symbol}
      </span>
      {detail && (
        <span className="text-sm font-normal">
          <LivePrice symbol={request.symbol} fallback={detail.quote.lastPrice} className="font-medium text-fg" />{' '}
          <LiveChange symbol={request.symbol} change={detail.quote.change} percent={detail.quote.changePercent} className="text-xs" />
        </span>
      )}
    </div>
  );

  if (step === 'result' && result) {
    const outcome = {
      EXECUTED: { icon: CheckCircle2, tone: 'text-gain', heading: 'Order executed', text: `${result.side === 'BUY' ? 'Bought' : 'Sold'} ${formatNumber(result.quantity)} ${result.symbol} at ${formatINR(result.averagePrice)}.` },
      OPEN: { icon: Clock, tone: 'text-info', heading: 'Order placed', text: `Your limit order is open and will execute when ${result.symbol} reaches ${formatINR(result.limitPrice)}.` },
      REJECTED: { icon: XCircle, tone: 'text-loss', heading: 'Order rejected', text: result.statusReason ?? 'The order could not be placed.' },
      CANCELLED: { icon: XCircle, tone: 'text-warning', heading: 'Order cancelled', text: result.statusReason ?? 'The order was cancelled.' },
      EXPIRED: { icon: Clock, tone: 'text-muted', heading: 'Order expired', text: result.statusReason ?? '' },
    }[result.status];
    const Icon = outcome.icon;
    return (
      <Modal
        open
        onClose={onClose}
        title={title}
        footer={
          <>
            <Button variant="secondary" onClick={() => { onClose(); navigate('/orders'); }}>
              View orders
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        }
      >
        <div className="flex flex-col items-center py-4 text-center">
          <Icon className={cn('size-12', outcome.tone)} />
          <p className="mt-3 text-lg font-semibold">{outcome.heading}</p>
          <p className="mt-1 max-w-sm text-sm text-muted">{outcome.text}</p>
          <p className="mt-3 text-xs text-subtle">Order #{result.id}</p>
        </div>
      </Modal>
    );
  }

  if (step === 'confirm' && preview.data) {
    const p = preview.data;
    return (
      <Modal
        open
        onClose={onClose}
        busy={place.isPending}
        title={title}
        description="Review your order and confirm with your transaction PIN."
        footer={
          <>
            <Button variant="secondary" onClick={() => setStep('form')} disabled={place.isPending}>
              Back
            </Button>
            <Button
              variant={side === 'BUY' ? 'buy' : 'sell'}
              loading={place.isPending}
              disabled={!user?.hasPin || pin.length !== 4}
              onClick={() => {
                setPinError(null);
                place.mutate();
              }}
            >
              Confirm {side === 'BUY' ? 'buy' : 'sell'}
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-border bg-surface-2/60 px-4 py-2">
          <KeyValue label="Order" value={`${p.side === 'BUY' ? 'Buy' : 'Sell'} · ${p.orderType === 'MARKET' ? 'Market' : 'Limit'}${p.orderType === 'LIMIT' ? ` · ${p.validity}` : ''}`} />
          <KeyValue label="Quantity" value={formatNumber(p.quantity)} />
          <KeyValue label={p.orderType === 'MARKET' ? 'Est. price' : 'Limit price'} value={formatINR(p.orderType === 'MARKET' ? p.lastPrice : Number(limitPrice))} />
          <KeyValue label="Order value" value={formatINR(p.value)} />
          <KeyValue label="Charges" value={formatINR(p.charges.total)} />
          <KeyValue className="border-t border-border pt-2 font-semibold" label={p.side === 'BUY' ? 'Total payable' : 'Net receivable'} value={formatINR(p.totalAmount)} />
        </div>
        {!p.marketable && p.orderType === 'LIMIT' && (
          <p className="mt-3 flex items-start gap-2 text-xs text-muted">
            <Clock className="mt-0.5 size-3.5 shrink-0" />
            {p.side === 'BUY' ? `${formatINR(p.totalAmount)} will be blocked until the order executes or is cancelled.` : `${p.quantity} shares will be reserved until the order executes or is cancelled.`}
          </p>
        )}
        <div className="mt-4">
          {user?.hasPin ? (
            <PinInput autoFocus value={pin} onChange={(e) => setPin(e.target.value)} error={pinError ?? undefined} onKeyDown={(e) => e.key === 'Enter' && pin.length === 4 && place.mutate()} />
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <p className="font-medium text-fg">Set a transaction PIN first</p>
                <p className="mt-0.5 text-muted">A 4-digit PIN confirms every order, IPO bid and withdrawal.</p>
                <ButtonLink to="/profile?tab=security" size="sm" variant="secondary" className="mt-2" onClick={onClose}>
                  Set PIN
                </ButtonLink>
              </div>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={side === 'BUY' ? 'buy' : 'sell'} disabled={!canReview} onClick={() => setStep('confirm')}>
            Review order
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-1">
          {(['BUY', 'SELL'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSide(value)}
              className={cn(
                'rounded-lg py-2 text-sm font-semibold transition-colors',
                side === value ? (value === 'BUY' ? 'bg-gain text-white shadow-card' : 'bg-loss text-white shadow-card') : 'text-muted hover:text-fg',
              )}
            >
              {value === 'BUY' ? 'Buy' : 'Sell'}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Order type</span>
          <Segmented
            aria-label="Order type"
            value={orderType}
            onChange={setOrderType}
            options={[
              { value: 'MARKET', label: 'Market' },
              { value: 'LIMIT', label: 'Limit' },
            ]}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Quantity"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ''))}
            hint={
              side === 'SELL'
                ? `You hold ${formatNumber(position?.quantity ?? 0)} (${formatNumber(position?.freeQuantity ?? 0)} free)`
                : maxBuy > 0
                  ? `Approx. max ${formatNumber(maxBuy)} with available funds`
                  : 'Add funds to buy'
            }
            suffix={
              <span className="flex gap-0.5">
                <button type="button" aria-label="Decrease quantity" className="rounded p-1 hover:bg-surface-2" onClick={() => setQuantity(String(Math.max(1, (qty || 1) - 1)))}>
                  <Minus className="size-3.5" />
                </button>
                <button type="button" aria-label="Increase quantity" className="rounded p-1 hover:bg-surface-2" onClick={() => setQuantity(String((qty || 0) + 1))}>
                  <Plus className="size-3.5" />
                </button>
              </span>
            }
            className="pr-16"
          />
          {orderType === 'LIMIT' ? (
            <Input
              label="Limit price"
              type="number"
              inputMode="decimal"
              step={tickSize}
              prefix="₹"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              hint={detail ? `Tick ₹${tickSize.toFixed(2)} · Range ₹${formatPrice(detail.metrics.lowerCircuit)}–${formatPrice(detail.metrics.upperCircuit)}` : undefined}
            />
          ) : (
            <Input label="Price" value="At market" disabled hint="Executes immediately at the best available price" />
          )}
        </div>

        {orderType === 'LIMIT' && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Validity</span>
            <Segmented
              aria-label="Validity"
              value={validity}
              onChange={setValidity}
              options={[
                { value: 'DAY', label: 'Day' },
                { value: 'IOC', label: 'Immediate or cancel' },
              ]}
            />
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface-2/60 px-4 py-2">
          {preview.data ? (
            <>
              <KeyValue label="Order value" value={formatINR(preview.data.value)} />
              <button type="button" onClick={() => setShowCharges((v) => !v)} className="flex w-full items-center justify-between py-1.5 text-sm">
                <span className="flex items-center gap-1 text-muted">
                  Charges <ChevronDown className={cn('size-3.5 transition-transform', showCharges && 'rotate-180')} />
                </span>
                <span className="num font-medium">{formatINR(preview.data.charges.total)}</span>
              </button>
              {showCharges && (
                <div className="mb-1 rounded-lg bg-surface px-3 py-1 text-xs">
                  <KeyValue label="Brokerage" value={formatINR(preview.data.charges.brokerage)} className="py-0.5 text-xs" />
                  <KeyValue label="STT" value={formatINR(preview.data.charges.stt)} className="py-0.5 text-xs" />
                  <KeyValue label="Exchange charges" value={formatINR(preview.data.charges.exchangeCharges)} className="py-0.5 text-xs" />
                  <KeyValue label="SEBI fees" value={formatINR(preview.data.charges.sebiFees)} className="py-0.5 text-xs" />
                  <KeyValue label="Stamp duty" value={formatINR(preview.data.charges.stampDuty)} className="py-0.5 text-xs" />
                  <KeyValue label="GST" value={formatINR(preview.data.charges.gst)} className="py-0.5 text-xs" />
                </div>
              )}
              <KeyValue className="border-t border-border pt-2 font-semibold" label={side === 'BUY' ? 'Total payable' : 'Net receivable'} value={formatINR(preview.data.totalAmount)} />
              <KeyValue label="Available funds" value={formatINR(preview.data.availableBalance)} className="text-xs" />
            </>
          ) : (
            <p className="py-3 text-center text-sm text-muted">{previewError ?? (inputValid ? 'Calculating…' : 'Enter a quantity and price to see the estimate')}</p>
          )}
        </div>

        {issues.length > 0 && (
          <ul className="flex flex-col gap-1.5" role="alert">
            {issues.map((issue) => (
              <li key={issue} className="flex items-start gap-2 rounded-lg bg-loss-soft px-3 py-2 text-xs text-loss">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {issue}
              </li>
            ))}
          </ul>
        )}
        {detail?.security.tradingStatus === 'HALTED' && <p className="text-sm text-warning">Trading in this security is currently halted.</p>}
      </div>
    </Modal>
  );
}
