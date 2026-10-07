import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellPlus, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { LiveChange, LivePrice } from '@/components/market/LivePrice';
import { SymbolPicker } from '@/components/market/SymbolPicker';
import { useTrade } from '@/components/trade/TradeProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Field';
import { EmptyState, ErrorState, Menu, MenuItem, PageHeader } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, errorMessage, symbolPath } from '@/lib/api';
import { formatCompact, formatPrice } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { Watchlist } from '@/lib/types';
import { useLiveTick } from '@/live/priceStore';

function DayRangeCell({ symbol, low, high }: { symbol: string; low: number; high: number }) {
  const tick = useLiveTick(symbol);
  return (
    <span className="num text-xs text-muted">
      {formatPrice(Math.min(low, tick?.low ?? low))} – {formatPrice(Math.max(high, tick?.high ?? high))}
    </span>
  );
}

function NameDialog({ title, initial = '', onSubmit, onClose, loading }: { title: string; initial?: string; onSubmit: (name: string) => void; onClose: () => void; loading?: boolean }) {
  const [name, setName] = useState(initial);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={loading} disabled={!name.trim()} onClick={() => onSubmit(name.trim())}>Save</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim()); }}>
        <Input label="Watchlist name" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
      </form>
    </Modal>
  );
}

export default function WatchlistPage() {
  const queryClient = useQueryClient();
  const { openOrder, openAlert } = useTrade();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<'create' | 'rename' | 'delete' | null>(null);
  const { data, isPending, error, refetch } = useQuery({ queryKey: keys.watchlists, queryFn: () => api.get<{ watchlists: Watchlist[] }>('/watchlists') });

  const lists = data?.watchlists ?? [];
  const active = lists.find((l) => l.id === activeId) ?? lists[0];
  useEffect(() => {
    if (lists.length && !lists.some((l) => l.id === activeId)) setActiveId(lists[0]!.id);
  }, [lists, activeId]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.watchlists });
  const onError = (err: unknown) => toast.error(errorMessage(err));
  const add = useMutation({ mutationFn: (symbol: string) => api.post(`/watchlists/${active!.id}/items`, { symbol }), onSuccess: (_d, symbol) => { toast.success(`${symbol} added to ${active!.name}`); refresh(); }, onError });
  const remove = useMutation({ mutationFn: (symbol: string) => api.delete(`/watchlists/${active!.id}/items/${symbolPath(symbol)}`), onSuccess: refresh, onError });
  const create = useMutation({
    mutationFn: (name: string) => api.post<{ watchlist: Watchlist }>('/watchlists', { name }),
    onSuccess: ({ watchlist }) => { setActiveId(watchlist.id); setDialog(null); refresh(); },
    onError,
  });
  const rename = useMutation({ mutationFn: (name: string) => api.patch(`/watchlists/${active!.id}`, { name }), onSuccess: () => { setDialog(null); refresh(); }, onError });
  const destroy = useMutation({ mutationFn: () => api.delete(`/watchlists/${active!.id}`), onSuccess: () => { setDialog(null); setActiveId(null); refresh(); }, onError });

  if (isPending) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader
        title="Watchlist"
        description="Track the stocks you care about with live prices."
        actions={<Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setDialog('create')} disabled={lists.length >= 10}>New watchlist</Button>}
      />
      <Card>
        <div className="flex items-center gap-2 pr-3">
          <Tabs className="flex-1 px-2" value={String(active?.id ?? '')} onChange={(v) => setActiveId(Number(v))} items={lists.map((l) => ({ value: String(l.id), label: l.name, count: l.items.length }))} />
          {active && (
            <Menu trigger={({ toggle }) => <button type="button" onClick={toggle} className="rounded-md p-1.5 text-muted hover:bg-surface-2" aria-label="Watchlist options"><MoreHorizontal className="size-5" /></button>}>
              {(close) => (
                <>
                  <MenuItem icon={<Pencil className="size-4" />} onClick={() => { close(); setDialog('rename'); }}>Rename</MenuItem>
                  <MenuItem danger icon={<Trash2 className="size-4" />} onClick={() => { close(); setDialog('delete'); }}>Delete watchlist</MenuItem>
                </>
              )}
            </Menu>
          )}
        </div>
        {active && (
          <>
            <div className="border-b border-border p-4">
              <SymbolPicker className="max-w-md" onSelect={(symbol) => add.mutate(symbol)} exclude={active.items.map((i) => i.symbol)} />
            </div>
            {active.items.length === 0 ? (
              <EmptyState icon={<Star className="size-6" />} title={`${active.name} is empty`} description="Search above to add stocks, ETFs or indices." />
            ) : (
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Security</Th>
                      <Th align="right">LTP</Th>
                      <Th align="right">Change</Th>
                      <Th align="right" className="hidden md:table-cell">Day range</Th>
                      <Th align="right" className="hidden lg:table-cell">Volume</Th>
                      <Th align="right"><span className="sr-only">Actions</span></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.items.map((item) => (
                      <Tr key={item.symbol}>
                        <Td>
                          <Link to={`/stocks/${symbolPath(item.symbol)}`} className="font-semibold hover:text-primary">{item.symbol}</Link>
                          {item.type !== 'STOCK' && <Badge tone={item.type === 'INDEX' ? 'info' : 'primary'} className="ml-2">{item.type}</Badge>}
                          <p className="max-w-60 truncate text-xs text-muted">{item.name}</p>
                        </Td>
                        <Td align="right"><LivePrice symbol={item.symbol} fallback={item.lastPrice} className="font-medium" prefix={item.type === 'INDEX' ? '' : '₹'} /></Td>
                        <Td align="right"><LiveChange symbol={item.symbol} change={item.change} percent={item.changePercent} /></Td>
                        <Td align="right" className="hidden md:table-cell"><DayRangeCell symbol={item.symbol} low={item.low} high={item.high} /></Td>
                        <Td align="right" className="hidden text-muted lg:table-cell">{item.volume ? formatCompact(item.volume) : '—'}</Td>
                        <Td align="right">
                          <div className="flex items-center justify-end gap-1">
                            {item.isTradable && (
                              <>
                                <button type="button" className="rounded-md bg-gain-soft px-2 py-1 text-xs font-semibold text-gain hover:opacity-80" onClick={() => openOrder({ symbol: item.symbol, side: 'BUY' })}>Buy</button>
                                <button type="button" className="rounded-md bg-loss-soft px-2 py-1 text-xs font-semibold text-loss hover:opacity-80" onClick={() => openOrder({ symbol: item.symbol, side: 'SELL' })}>Sell</button>
                              </>
                            )}
                            <button type="button" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Alert for ${item.symbol}`} onClick={() => openAlert(item.symbol)}><BellPlus className="size-4" /></button>
                            <button type="button" className="rounded-md p-1 text-muted hover:bg-loss-soft hover:text-loss" aria-label={`Remove ${item.symbol}`} onClick={() => remove.mutate(item.symbol)}><Trash2 className="size-4" /></button>
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </>
        )}
      </Card>
      {dialog === 'create' && <NameDialog title="New watchlist" onSubmit={(name) => create.mutate(name)} onClose={() => setDialog(null)} loading={create.isPending} />}
      {dialog === 'rename' && active && <NameDialog title="Rename watchlist" initial={active.name} onSubmit={(name) => rename.mutate(name)} onClose={() => setDialog(null)} loading={rename.isPending} />}
      <ConfirmDialog
        open={dialog === 'delete'}
        title={`Delete “${active?.name}”?`}
        description="The watchlist and its securities will be removed. Your holdings are not affected."
        confirmLabel="Delete"
        variant="danger"
        loading={destroy.isPending}
        onConfirm={() => destroy.mutate()}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
