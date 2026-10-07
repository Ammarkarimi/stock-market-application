import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { LivePrice } from '@/components/market/LivePrice';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Segmented } from '@/components/ui/Tabs';
import { api, ApiError, symbolPath } from '@/lib/api';
import { formatPercent } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { Alert, AlertCondition, SecurityDetail } from '@/lib/types';
import { useLiveTick } from '@/live/priceStore';

/** Create a one-time price alert for a security. */
export function AlertDialog({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: detail } = useQuery({
    queryKey: keys.security(symbol),
    queryFn: () => api.get<SecurityDetail>(`/securities/${symbolPath(symbol)}`),
  });
  const tick = useLiveTick(symbol);
  const lastPrice = tick?.lastPrice ?? detail?.quote.lastPrice ?? 0;
  const [condition, setCondition] = useState<AlertCondition>('ABOVE');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const suggested = lastPrice ? (lastPrice * (condition === 'ABOVE' ? 1.05 : 0.95)).toFixed(2) : '';
  const value = target === '' ? suggested : target;
  const numeric = Number.parseFloat(value);
  const distance = lastPrice && Number.isFinite(numeric) ? ((numeric - lastPrice) / lastPrice) * 100 : null;

  const create = useMutation({
    mutationFn: () => api.post<{ alert: Alert }>('/alerts', { symbol, condition, targetPrice: numeric, note: note || null }),
    onSuccess: () => {
      toast.success('Price alert created', { description: `We'll notify you when ${symbol} goes ${condition === 'ABOVE' ? 'above' : 'below'} ₹${numeric.toFixed(2)}.` });
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: keys.security(symbol) });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not create the alert'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      busy={create.isPending}
      title={`Price alert for ${symbol}`}
      description={detail ? <>Current price <LivePrice symbol={symbol} fallback={detail.quote.lastPrice} className="font-medium text-fg" /></> : undefined}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!Number.isFinite(numeric) || numeric <= 0} onClick={() => create.mutate()}>
            Create alert
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Notify me when price goes</span>
          <Segmented
            aria-label="Alert condition"
            value={condition}
            onChange={(c) => {
              setCondition(c);
              setTarget('');
            }}
            options={[
              { value: 'ABOVE', label: 'Above' },
              { value: 'BELOW', label: 'Below' },
            ]}
          />
        </div>
        <Input
          label="Target price"
          type="number"
          step="0.05"
          prefix="₹"
          value={value}
          onChange={(e) => setTarget(e.target.value)}
          error={error ?? undefined}
          hint={distance !== null ? `${formatPercent(distance)} from the current price` : undefined}
        />
        <Input label="Note (optional)" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Book partial profits" />
      </div>
    </Modal>
  );
}
