import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { LivePrice } from '@/components/market/LivePrice';
import { SymbolPicker } from '@/components/market/SymbolPicker';
import { useTrade } from '@/components/trade/TradeProvider';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, PageHeader, Switch } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, errorMessage, symbolPath } from '@/lib/api';
import { formatDateTime, formatINR, formatPercent, relativeTime } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { Alert, AlertStatus } from '@/lib/types';
import { useLiveTick } from '@/live/priceStore';

function Distance({ alert }: { alert: Alert }) {
  const tick = useLiveTick(alert.symbol);
  const price = tick?.lastPrice ?? alert.lastPrice;
  if (!price || alert.status !== 'ACTIVE') return <span className="text-muted">—</span>;
  const distance = ((alert.targetPrice - price) / price) * 100;
  return <span className="num text-muted">{formatPercent(distance)} away</span>;
}

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const { openAlert } = useTrade();
  const [tab, setTab] = useState<AlertStatus | 'ALL'>('ACTIVE');
  const { data, isPending, error, refetch } = useQuery({ queryKey: keys.alerts({}), queryFn: () => api.get<{ alerts: Alert[] }>('/alerts') });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['alerts'] });
  const toggle = useMutation({
    mutationFn: ({ alert, enable }: { alert: Alert; enable: boolean }) => api.patch(`/alerts/${alert.id}`, { status: enable ? 'ACTIVE' : 'DISABLED' }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err), { description: 'Edit the target so it is on the right side of the current price.' }),
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/alerts/${id}`), onSuccess: () => { toast.success('Alert deleted'); refresh(); } });

  if (isPending) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const counts = { ACTIVE: 0, TRIGGERED: 0, DISABLED: 0 };
  for (const alert of data.alerts) counts[alert.status]++;
  const alerts = tab === 'ALL' ? data.alerts : data.alerts.filter((a) => a.status === tab);

  return (
    <div>
      <PageHeader title="Price alerts" description="Get notified the moment a stock crosses your target price." />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <SymbolPicker className="w-full max-w-md" placeholder="Search a stock to create an alert…" onSelect={(symbol) => openAlert(symbol)} />
        </div>
        <Tabs
          className="px-2"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'ACTIVE', label: 'Active', count: counts.ACTIVE },
            { value: 'TRIGGERED', label: 'Triggered', count: counts.TRIGGERED },
            { value: 'DISABLED', label: 'Paused', count: counts.DISABLED },
            { value: 'ALL', label: 'All' },
          ]}
        />
        {alerts.length === 0 ? (
          <EmptyState icon={<BellRing className="size-6" />} title="No alerts here" description="Create an alert from any stock page, your watchlist or the search above." />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Security</Th>
                  <Th>Condition</Th>
                  <Th align="right">LTP</Th>
                  <Th align="right" className="hidden md:table-cell">Distance</Th>
                  <Th className="hidden lg:table-cell">Status</Th>
                  <Th align="right">On</Th>
                  <Th align="right"><span className="sr-only">Delete</span></Th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <Tr key={alert.id}>
                    <Td>
                      <Link to={`/stocks/${symbolPath(alert.symbol)}`} className="font-semibold hover:text-primary">{alert.symbol}</Link>
                      {alert.note && <p className="max-w-56 truncate text-xs text-muted">{alert.note}</p>}
                    </Td>
                    <Td>
                      <span className="text-muted">{alert.condition === 'ABOVE' ? 'Rises above' : 'Falls below'}</span>{' '}
                      <span className="num font-semibold">{formatINR(alert.targetPrice)}</span>
                    </Td>
                    <Td align="right"><LivePrice symbol={alert.symbol} fallback={alert.lastPrice ?? 0} /></Td>
                    <Td align="right" className="hidden md:table-cell"><Distance alert={alert} /></Td>
                    <Td className="hidden lg:table-cell">
                      {alert.status === 'TRIGGERED' ? (
                        <span>
                          <Badge tone="success">Triggered</Badge>
                          <span className="ml-2 text-xs text-muted" title={formatDateTime(alert.triggeredAt)}>at {formatINR(alert.triggeredPrice)} · {relativeTime(alert.triggeredAt!)}</span>
                        </span>
                      ) : alert.status === 'ACTIVE' ? <Badge tone="info">Watching</Badge> : <Badge>Paused</Badge>}
                    </Td>
                    <Td align="right">
                      <span className="inline-flex justify-end">
                        <Switch checked={alert.status === 'ACTIVE'} label={alert.status === 'ACTIVE' ? 'Pause alert' : 'Activate alert'} onChange={(enable) => toggle.mutate({ alert, enable })} />
                      </span>
                    </Td>
                    <Td align="right">
                      <button type="button" className="rounded-md p-1.5 text-muted hover:bg-loss-soft hover:text-loss" aria-label="Delete alert" onClick={() => remove.mutate(alert.id)}>
                        <Trash2 className="size-4" />
                      </button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
