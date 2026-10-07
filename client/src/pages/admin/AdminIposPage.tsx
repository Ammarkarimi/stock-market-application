import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CheckCircle2, ListChecks, Pencil, Plus, Rocket, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ApplicationStatusBadge, IpoStatusBadge } from '@/components/trade/OrderStatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, ApiError, errorMessage } from '@/lib/api';
import { addDaysISO, formatDate, formatINR, formatNumber, formatShortDate, todayIST } from '@/lib/format';
import type { Ipo, IpoApplication } from '@/lib/types';

type FormState = Record<string, string>;

function emptyForm(): FormState {
  const today = todayIST();
  return {
    companyName: '', symbol: '', issueType: 'MAINBOARD', sector: '', industry: '', description: '',
    priceBandLow: '', priceBandHigh: '', lotSize: '', minLots: '1', maxLots: '13', issueSizeCr: '', freshIssueCr: '', ofsCr: '',
    openDate: addDaysISO(today, 3), closeDate: addDaysISO(today, 5), allotmentDate: addDaysISO(today, 6), listingDate: addDaysISO(today, 8),
    registrar: '', leadManagers: '', demandRetail: '', demandNii: '', demandQib: '',
  };
}

function fromIpo(ipo: Ipo): FormState {
  return {
    companyName: ipo.companyName, symbol: ipo.symbol, issueType: ipo.issueType, sector: ipo.sector ?? '', industry: ipo.industry ?? '', description: ipo.description ?? '',
    priceBandLow: String(ipo.priceBand.low), priceBandHigh: String(ipo.priceBand.high), lotSize: String(ipo.lotSize), minLots: String(ipo.minLots), maxLots: String(ipo.maxLots),
    issueSizeCr: String(ipo.issueSizeCr), freshIssueCr: String(ipo.freshIssueCr), ofsCr: String(ipo.ofsCr),
    openDate: ipo.dates.open, closeDate: ipo.dates.close, allotmentDate: ipo.dates.allotment, listingDate: ipo.dates.listing,
    registrar: ipo.registrar ?? '', leadManagers: ipo.leadManagers.join(', '), demandRetail: '', demandNii: '', demandQib: '',
  };
}

function toPayload(form: FormState, creating: boolean) {
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const demand = form.demandRetail && form.demandNii && form.demandQib ? { retail: Number(form.demandRetail), nii: Number(form.demandNii), qib: Number(form.demandQib) } : undefined;
  return {
    companyName: form.companyName,
    ...(creating ? { symbol: form.symbol } : {}),
    issueType: form.issueType,
    sector: form.sector || null,
    industry: form.industry || null,
    description: form.description || null,
    priceBandLow: num(form.priceBandLow),
    priceBandHigh: num(form.priceBandHigh),
    lotSize: num(form.lotSize),
    minLots: num(form.minLots),
    maxLots: num(form.maxLots),
    issueSizeCr: num(form.issueSizeCr),
    freshIssueCr: num(form.freshIssueCr) ?? 0,
    ofsCr: num(form.ofsCr) ?? 0,
    openDate: form.openDate,
    closeDate: form.closeDate,
    allotmentDate: form.allotmentDate,
    listingDate: form.listingDate,
    registrar: form.registrar || null,
    leadManagers: form.leadManagers.split(',').map((s) => s.trim()).filter(Boolean),
    ...(creating && demand ? { demand } : {}),
  };
}

function IpoForm({ ipo, onClose }: { ipo: Ipo | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const creating = ipo === null;
  const [form, setForm] = useState<FormState>(ipo ? fromIpo(ipo) : emptyForm());
  const save = useMutation({
    mutationFn: () => (creating ? api.post('/admin/ipos', toPayload(form, true)) : api.patch(`/admin/ipos/${ipo!.id}`, toPayload(form, false))),
    onSuccess: () => {
      toast.success(creating ? 'IPO created' : 'IPO updated');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ipos'] });
      void queryClient.invalidateQueries({ queryKey: ['ipos'] });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fields : {};
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: key === 'symbol' ? e.target.value.toUpperCase() : e.target.value }));
  const field = (key: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <Input label={label} value={form[key]} onChange={set(key)} error={errors[key]} {...props} />;
  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      size="xl"
      title={creating ? 'Create IPO' : `Edit ${ipo!.companyName}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{creating ? 'Create IPO' : 'Save changes'}</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {field('companyName', 'Company name')}
        {creating ? field('symbol', 'Symbol') : <Input label="Symbol" value={form.symbol} disabled />}
        <Select label="Issue type" value={form.issueType} onChange={set('issueType')}>
          <option value="MAINBOARD">Mainboard</option>
          <option value="SME">SME</option>
        </Select>
        {field('sector', 'Sector')}
        {field('industry', 'Industry')}
        {field('registrar', 'Registrar')}
        <Textarea label="Description" containerClassName="sm:col-span-2" value={form.description} onChange={set('description')} maxLength={1500} />
        {field('priceBandLow', 'Price band low (₹)', { type: 'number' })}
        {field('priceBandHigh', 'Price band high (₹)', { type: 'number' })}
        {field('lotSize', 'Lot size (shares)', { type: 'number' })}
        <div className="grid grid-cols-2 gap-3">
          {field('minLots', 'Min lots', { type: 'number' })}
          {field('maxLots', 'Max lots', { type: 'number' })}
        </div>
        {field('issueSizeCr', 'Issue size (₹ Cr)', { type: 'number' })}
        <div className="grid grid-cols-2 gap-3">
          {field('freshIssueCr', 'Fresh issue (₹ Cr)', { type: 'number' })}
          {field('ofsCr', 'OFS (₹ Cr)', { type: 'number' })}
        </div>
        {field('openDate', 'Opens', { type: 'date' })}
        {field('closeDate', 'Closes', { type: 'date' })}
        {field('allotmentDate', 'Allotment', { type: 'date' })}
        {field('listingDate', 'Listing', { type: 'date' })}
        <Input label="Lead managers" containerClassName="sm:col-span-2" hint="Comma separated" value={form.leadManagers} onChange={set('leadManagers')} />
        {creating && (
          <div className="grid grid-cols-3 gap-3 sm:col-span-2">
            <Input label="Expected retail (x)" type="number" value={form.demandRetail} onChange={set('demandRetail')} hint="Optional; random if blank" />
            <Input label="Expected NII (x)" type="number" value={form.demandNii} onChange={set('demandNii')} />
            <Input label="Expected QIB (x)" type="number" value={form.demandQib} onChange={set('demandQib')} />
          </div>
        )}
        {save.error && <p className="text-sm text-loss sm:col-span-2">{errorMessage(save.error)}</p>}
      </div>
    </Modal>
  );
}

function SubscriptionForm({ ipo, onClose }: { ipo: Ipo; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ retail: String(ipo.subscription.retail), nii: String(ipo.subscription.nii), qib: String(ipo.subscription.qib) });
  const save = useMutation({
    mutationFn: () => api.post(`/admin/ipos/${ipo.id}/subscription`, { retail: Number(values.retail), nii: Number(values.nii), qib: Number(values.qib) }),
    onSuccess: () => {
      toast.success('Subscription updated');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ipos'] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Modal open onClose={onClose} size="sm" title="Update subscription" description="Manual figures replace the simulated demand for this IPO. Retail subscription decides the allotment lottery." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid grid-cols-3 gap-3">
        {(['retail', 'nii', 'qib'] as const).map((key) => (
          <Input key={key} label={`${key.toUpperCase()} (x)`} type="number" step="0.01" value={values[key]} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />
        ))}
      </div>
    </Modal>
  );
}

function ApplicationsDialog({ ipo, onClose }: { ipo: Ipo; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['admin', 'ipos', ipo.id], queryFn: () => api.get<{ ipo: Ipo; applications: IpoApplication[] }>(`/admin/ipos/${ipo.id}`) });
  return (
    <Modal open onClose={onClose} size="xl" title={`Applications · ${ipo.companyName}`}>
      {!data ? <PageLoader /> : data.applications.length === 0 ? <EmptyState title="No applications yet" /> : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Investor</Th><Th align="right">Bid</Th><Th align="right">Amount</Th><Th>Status</Th><Th align="right">Allotted</Th></tr></thead>
            <tbody>
              {data.applications.map((a) => (
                <Tr key={a.id}>
                  <Td><Link to={`/admin/users/${a.userId}`} className="font-medium hover:text-primary">{a.userName}</Link><p className="text-xs text-muted">{a.applicationNo}</p></Td>
                  <Td align="right">{a.lots} × {a.isCutoff ? 'cut-off' : formatINR(a.bidPrice, { decimals: 0 })}</Td>
                  <Td align="right">{formatINR(a.amount, { decimals: 0 })}</Td>
                  <Td><ApplicationStatusBadge status={a.status} /></Td>
                  <Td align="right">{a.allottedQuantity ? formatNumber(a.allottedQuantity) : '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Modal>
  );
}

type Dialog = { kind: 'create' } | { kind: 'edit' | 'subscription' | 'applications' | 'allot' | 'list' | 'withdraw'; ipo: Ipo } | null;

export default function AdminIposPage() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const { data, isPending, error, refetch } = useQuery({ queryKey: ['admin', 'ipos'], queryFn: () => api.get<{ ipos: Ipo[] }>('/admin/ipos'), refetchInterval: 30_000 });
  const lifecycle = useMutation({
    mutationFn: ({ ipo, step, reason }: { ipo: Ipo; step: 'allot' | 'list' | 'withdraw'; reason?: string }) => api.post<{ result?: { allotted?: number; applications?: number; listingPrice?: number } }>(`/admin/ipos/${ipo.id}/${step}`, step === 'withdraw' ? { reason } : {}),
    onSuccess: (response, { step }) => {
      const result = response.result;
      toast.success(
        step === 'allot' ? `Allotment complete: ${result?.allotted ?? 0} of ${result?.applications ?? 0} applications allotted` : step === 'list' ? `Listed at ${formatINR(result?.listingPrice)}` : 'IPO withdrawn and bids released',
      );
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ipos'] });
      void queryClient.invalidateQueries({ queryKey: ['ipos'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div>
      <PageHeader title="IPOs" description="Create issues, track demand and run allotment and listing." actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setDialog({ kind: 'create' })}>Create IPO</Button>} />
      <Card>
        {isPending ? <PageLoader /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : data.ipos.length === 0 ? <EmptyState icon={<Rocket className="size-6" />} title="No IPOs yet" /> : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Issue</Th>
                  <Th>Status</Th>
                  <Th className="hidden md:table-cell">Window</Th>
                  <Th align="right" className="hidden lg:table-cell">Price band</Th>
                  <Th align="right">Subscribed</Th>
                  <Th align="right">Bids</Th>
                  <Th align="right"><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {data.ipos.map((ipo) => {
                  const editable = ['UPCOMING', 'OPEN', 'CLOSED'].includes(ipo.status);
                  return (
                    <Tr key={ipo.id}>
                      <Td>
                        <Link to={`/ipo/${ipo.id}`} className="font-semibold hover:text-primary">{ipo.companyName}</Link>
                        <p className="text-xs text-muted">{ipo.symbol} · ₹{formatNumber(ipo.issueSizeCr)} Cr</p>
                      </Td>
                      <Td><IpoStatusBadge status={ipo.status} /></Td>
                      <Td className="hidden text-xs text-muted md:table-cell">{formatShortDate(ipo.dates.open)} – {formatShortDate(ipo.dates.close)}<br />Allot {formatShortDate(ipo.dates.allotment)} · List {formatDate(ipo.dates.listing)}</Td>
                      <Td align="right" className="hidden lg:table-cell">₹{ipo.priceBand.low}–{ipo.priceBand.high}</Td>
                      <Td align="right">{ipo.subscription.total.toFixed(2)}x<p className="text-[11px] text-muted">Retail {ipo.subscription.retail.toFixed(2)}x</p></Td>
                      <Td align="right">
                        <button type="button" className="text-primary hover:underline" onClick={() => setDialog({ kind: 'applications', ipo })}>{ipo.applicationsCount ?? 0}</button>
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1">
                          {editable && <button type="button" title="Edit" aria-label="Edit IPO" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setDialog({ kind: 'edit', ipo })}><Pencil className="size-4" /></button>}
                          {editable && <button type="button" title="Update subscription" aria-label="Update subscription" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setDialog({ kind: 'subscription', ipo })}><BarChart3 className="size-4" /></button>}
                          {ipo.status === 'CLOSED' && <Button size="xs" variant="secondary" icon={<ListChecks className="size-3.5" />} onClick={() => setDialog({ kind: 'allot', ipo })}>Allot</Button>}
                          {ipo.status === 'ALLOTTED' && <Button size="xs" variant="secondary" icon={<CheckCircle2 className="size-3.5" />} onClick={() => setDialog({ kind: 'list', ipo })}>List</Button>}
                          {editable && <button type="button" title="Withdraw" aria-label="Withdraw IPO" className="rounded-md p-1.5 text-muted hover:bg-loss-soft hover:text-loss" onClick={() => setDialog({ kind: 'withdraw', ipo })}><XCircle className="size-4" /></button>}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
      {dialog?.kind === 'create' && <IpoForm ipo={null} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <IpoForm ipo={dialog.ipo} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'subscription' && <SubscriptionForm ipo={dialog.ipo} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'applications' && <ApplicationsDialog ipo={dialog.ipo} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog?.kind === 'allot'}
        title="Run allotment now?"
        description={dialog && 'ipo' in dialog ? `Retail is subscribed ${dialog.ipo.subscription.retail.toFixed(2)}x. ${dialog.ipo.subscription.retail > 1 ? 'Applications enter a lottery for one lot each.' : 'All valid bids will be allotted in full.'} Allotted amounts are debited and the rest released.` : undefined}
        confirmLabel="Run allotment"
        loading={lifecycle.isPending}
        onConfirm={() => dialog && 'ipo' in dialog && lifecycle.mutate({ ipo: dialog.ipo, step: 'allot' })}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.kind === 'list'}
        title="List this IPO now?"
        description="Creates the tradable security at its listing price and credits allotted shares to investors' holdings."
        confirmLabel="List"
        loading={lifecycle.isPending}
        onConfirm={() => dialog && 'ipo' in dialog && lifecycle.mutate({ ipo: dialog.ipo, step: 'list' })}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.kind === 'withdraw'}
        title="Withdraw this IPO?"
        description="All pending applications are cancelled and their blocked funds released. This cannot be undone."
        confirmLabel="Withdraw IPO"
        variant="danger"
        requireReason
        loading={lifecycle.isPending}
        onConfirm={(reason) => dialog && 'ipo' in dialog && lifecycle.mutate({ ipo: dialog.ipo, step: 'withdraw', reason })}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
