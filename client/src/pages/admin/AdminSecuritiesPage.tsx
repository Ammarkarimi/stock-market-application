import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Pencil, Play, Plus, Search, Tag } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { LiveChange, LivePrice } from '@/components/market/LivePrice';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { EmptyState, ErrorState, PageHeader, Pagination } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, ApiError, errorMessage, qs, symbolPath } from '@/lib/api';
import { formatCrores } from '@/lib/format';
import type { Page, SecurityDetail, SecurityListItem } from '@/lib/types';

type FormState = Record<string, string>;

const NUMBER_FIELDS: [string, string][] = [
  ['eps', 'EPS (₹)'],
  ['bookValue', 'Book value (₹)'],
  ['dividendPerShare', 'Dividend / share (₹)'],
  ['faceValue', 'Face value (₹)'],
  ['roe', 'ROE (%)'],
  ['debtToEquity', 'Debt / equity'],
  ['beta', 'Beta'],
  ['revenueCr', 'Revenue (₹ Cr)'],
  ['netProfitCr', 'Net profit (₹ Cr)'],
  ['sharesOutstanding', 'Shares outstanding'],
  ['circuitPct', 'Circuit band (%)'],
  ['volatility', 'Volatility (0–2)'],
];

function toPayload(form: FormState) {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(form)) {
    if (value === '') continue;
    const numeric = NUMBER_FIELDS.some(([k]) => k === key) || key === 'price' || key === 'foundedYear';
    payload[key] = numeric ? Number(value) : value;
  }
  return payload;
}

function SecurityForm({ symbol, onClose }: { symbol: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const creating = symbol === null;
  const { data: detail } = useQuery({ queryKey: ['securities', 'detail', symbol], queryFn: () => api.get<SecurityDetail>(`/securities/${symbolPath(symbol!)}`), enabled: !creating });
  const [form, setForm] = useState<FormState | null>(creating ? { symbol: '', name: '', type: 'STOCK', price: '', sector: '', industry: '', description: '', headquarters: '', foundedYear: '' } : null);
  if (!form && detail) {
    const m = detail.metrics;
    setForm({
      name: detail.security.name,
      sector: detail.security.sector ?? '',
      industry: detail.security.industry ?? '',
      description: detail.security.description ?? '',
      headquarters: detail.security.headquarters ?? '',
      foundedYear: detail.security.foundedYear ? String(detail.security.foundedYear) : '',
      eps: m.eps?.toString() ?? '',
      bookValue: m.bookValue?.toString() ?? '',
      dividendPerShare: m.dividendPerShare?.toString() ?? '',
      faceValue: detail.security.faceValue?.toString() ?? '',
      roe: m.roe?.toString() ?? '',
      debtToEquity: m.debtToEquity?.toString() ?? '',
      beta: m.beta?.toString() ?? '',
      revenueCr: m.revenueCr?.toString() ?? '',
      netProfitCr: m.netProfitCr?.toString() ?? '',
      circuitPct: String(detail.security.circuitPct),
    });
  }
  const save = useMutation({
    mutationFn: () => (creating ? api.post('/admin/securities', toPayload(form!)) : api.patch(`/admin/securities/${symbolPath(symbol!)}`, toPayload(form!))),
    onSuccess: () => {
      toast.success(creating ? 'Security created' : 'Security updated');
      void queryClient.invalidateQueries({ queryKey: ['securities'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'securities'] });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fields : {};
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f!, [key]: e.target.value }));

  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      size="xl"
      title={creating ? 'Add security' : `Edit ${symbol}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!form} onClick={() => save.mutate()}>{creating ? 'Create' : 'Save changes'}</Button>
        </>
      }
    >
      {!form ? (
        <PageLoader />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {creating && (
            <>
              <Input label="Symbol" value={form.symbol} onChange={(e) => setForm((f) => ({ ...f!, symbol: e.target.value.toUpperCase() }))} error={errors.symbol} />
              <Select label="Type" value={form.type} onChange={set('type')}>
                <option value="STOCK">Stock</option>
                <option value="ETF">ETF</option>
                <option value="REIT">REIT</option>
                <option value="INVIT">InvIT</option>
              </Select>
              <Input label="Listing price (₹)" type="number" value={form.price} onChange={set('price')} error={errors.price} />
            </>
          )}
          <Input label="Name" value={form.name} onChange={set('name')} error={errors.name} containerClassName={creating ? '' : 'sm:col-span-2'} />
          <Input label="Sector" value={form.sector} onChange={set('sector')} />
          <Input label="Industry" value={form.industry} onChange={set('industry')} />
          <Input label="Headquarters" value={form.headquarters} onChange={set('headquarters')} />
          <Input label="Founded" type="number" value={form.foundedYear} onChange={set('foundedYear')} error={errors.foundedYear} />
          <Textarea label="Description" containerClassName="sm:col-span-2" value={form.description} onChange={set('description')} maxLength={1000} />
          {NUMBER_FIELDS.filter(([key]) => !creating || ['eps', 'bookValue', 'sharesOutstanding', 'circuitPct', 'volatility'].includes(key)).map(([key, label]) => (
            <Input key={key} label={label} type="number" step="any" value={form[key] ?? ''} onChange={set(key)} error={errors[key]} />
          ))}
          {save.error && !Object.keys(errors).length && <p className="text-sm text-loss sm:col-span-2">{errorMessage(save.error)}</p>}
        </div>
      )}
    </Modal>
  );
}

function PriceDialog({ item, onClose }: { item: SecurityListItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(String(item.lastPrice));
  const reprice = useMutation({
    mutationFn: () => api.post(`/admin/securities/${symbolPath(item.symbol)}/price`, { price: Number(price) }),
    onSuccess: () => {
      toast.success(`${item.symbol} repriced`, { description: 'Limit orders and alerts were evaluated against the new price.' });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'securities'] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Modal open onClose={onClose} size="sm" title={`Set price · ${item.symbol}`} description="Moves the simulated price (within today's circuit limits). Useful to demonstrate limit orders and alerts." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={reprice.isPending} onClick={() => reprice.mutate()}>Set price</Button></>}>
      <Input label="New price" type="number" step="0.05" prefix="₹" value={price} onChange={(e) => setPrice(e.target.value)} />
    </Modal>
  );
}

export default function AdminSecuritiesPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ q: '', type: '', page: 1 });
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [repricing, setRepricing] = useState<SecurityListItem | null>(null);
  const [toggling, setToggling] = useState<SecurityListItem | null>(null);
  const params = { ...filters, pageSize: 25, sort: filters.q ? undefined : 'symbol' };
  const { data, isPending, error, refetch } = useQuery({ queryKey: ['admin', 'securities', params], queryFn: () => api.get<Page<SecurityListItem>>(`/admin/securities${qs(params)}`), placeholderData: keepPreviousData });
  const toggle = useMutation({
    mutationFn: ({ item, reason }: { item: SecurityListItem; reason: string }) => api.post(`/admin/securities/${symbolPath(item.symbol)}/trading-status`, { status: item.tradingStatus === 'ACTIVE' ? 'HALTED' : 'ACTIVE', reason }),
    onSuccess: () => {
      toast.success('Trading status updated');
      setToggling(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'securities'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div>
      <PageHeader title="Securities" description="Manage the tradable universe, company data and trading halts." actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>Add security</Button>} />
      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3">
          <Input aria-label="Search" placeholder="Symbol or name" prefix={<Search className="size-4" />} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })} />
          <Select aria-label="Type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value, page: 1 })}>
            <option value="">All types</option>
            {['STOCK', 'ETF', 'REIT', 'INVIT', 'INDEX'].map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
        {isPending ? <PageLoader /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : data.items.length === 0 ? <EmptyState title="No securities found" /> : (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Security</Th>
                    <Th className="hidden md:table-cell">Sector</Th>
                    <Th align="right">Price</Th>
                    <Th align="right">Change</Th>
                    <Th align="right" className="hidden lg:table-cell">Market cap</Th>
                    <Th>Status</Th>
                    <Th align="right"><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <Tr key={item.symbol}>
                      <Td>
                        <Link to={`/stocks/${symbolPath(item.symbol)}`} className="font-semibold hover:text-primary">{item.symbol}</Link> <Badge tone={item.type === 'STOCK' ? 'neutral' : 'primary'}>{item.type}</Badge>
                        <p className="max-w-60 truncate text-xs text-muted">{item.name}</p>
                      </Td>
                      <Td className="hidden text-muted md:table-cell">{item.sector}</Td>
                      <Td align="right"><LivePrice symbol={item.symbol} fallback={item.lastPrice} /></Td>
                      <Td align="right"><LiveChange symbol={item.symbol} change={item.change} percent={item.changePercent} showAbsolute={false} /></Td>
                      <Td align="right" className="hidden text-muted lg:table-cell">{formatCrores(item.marketCapCr)}</Td>
                      <Td>{item.type === 'INDEX' ? <Badge tone="info">Derived</Badge> : item.tradingStatus === 'ACTIVE' ? <Badge tone="success">Trading</Badge> : <Badge tone="warning">Halted</Badge>}</Td>
                      <Td align="right">
                        {item.type !== 'INDEX' && (
                          <div className="flex justify-end gap-1">
                            <button type="button" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Edit ${item.symbol}`} title="Edit" onClick={() => setEditing(item.symbol)}><Pencil className="size-4" /></button>
                            <button type="button" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Set price for ${item.symbol}`} title="Set price" onClick={() => setRepricing(item)}><Tag className="size-4" /></button>
                            <button type="button" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={item.tradingStatus === 'ACTIVE' ? `Halt ${item.symbol}` : `Resume ${item.symbol}`} title={item.tradingStatus === 'ACTIVE' ? 'Halt trading' : 'Resume trading'} onClick={() => setToggling(item)}>
                              {item.tradingStatus === 'ACTIVE' ? <Pause className="size-4" /> : <Play className="size-4" />}
                            </button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => setFilters({ ...filters, page })} />
          </>
        )}
      </Card>
      {editing !== undefined && <SecurityForm symbol={editing} onClose={() => setEditing(undefined)} />}
      {repricing && <PriceDialog item={repricing} onClose={() => setRepricing(null)} />}
      <ConfirmDialog
        open={Boolean(toggling)}
        title={toggling?.tradingStatus === 'ACTIVE' ? `Halt trading in ${toggling?.symbol}?` : `Resume trading in ${toggling?.symbol}?`}
        description={toggling?.tradingStatus === 'ACTIVE' ? 'New orders will be rejected and prices will stop moving. Holders are notified.' : 'Orders and price updates resume immediately. Holders are notified.'}
        confirmLabel={toggling?.tradingStatus === 'ACTIVE' ? 'Halt trading' : 'Resume trading'}
        variant={toggling?.tradingStatus === 'ACTIVE' ? 'danger' : 'primary'}
        requireReason
        loading={toggle.isPending}
        onConfirm={(reason) => toggling && toggle.mutate({ item: toggling, reason })}
        onClose={() => setToggling(null)}
      />
    </div>
  );
}
