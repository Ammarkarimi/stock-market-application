import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Field';
import { ErrorState, PageHeader } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { Settings } from '@/lib/types';

type Section = keyof Settings;

const FIELDS: Record<Section, { title: string; description: string; fields: [string, string, string?][] }> = {
  charges: {
    title: 'Brokerage & charges',
    description: 'Applied to every executed trade. Percentages are of trade value.',
    fields: [
      ['brokeragePct', 'Brokerage (%)'],
      ['brokerageMax', 'Brokerage cap (₹ per order)'],
      ['sttPct', 'STT (%)'],
      ['exchangePct', 'Exchange charges (%)'],
      ['sebiPerCrore', 'SEBI fee (₹ per crore)'],
      ['stampDutyPct', 'Stamp duty on buys (%)'],
      ['gstPct', 'GST (%)', 'On brokerage, exchange and SEBI charges'],
    ],
  },
  funds: {
    title: 'Fund limits',
    description: 'Per-transaction limits for adding and withdrawing money (₹).',
    fields: [
      ['minDeposit', 'Minimum deposit'],
      ['maxDeposit', 'Maximum deposit'],
      ['minWithdrawal', 'Minimum withdrawal'],
      ['maxWithdrawal', 'Maximum withdrawal'],
    ],
  },
  trading: {
    title: 'Trading limits',
    description: 'Risk limits applied to orders and IPO bids.',
    fields: [
      ['maxOrderQuantity', 'Maximum quantity per order'],
      ['ipoRetailLimit', 'Retail IPO bid limit (₹)'],
    ],
  },
};

function SettingsSection({ section, values }: { section: Section; values: Record<string, number> }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])));
  useEffect(() => setForm(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]))), [values]);
  const save = useMutation({
    mutationFn: () => api.put(`/admin/settings/${section}`, Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)]))),
    onSuccess: () => {
      toast.success(`${FIELDS[section].title} saved`);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const errors = save.error instanceof ApiError ? save.error.fields : {};
  const meta = FIELDS[section];
  return (
    <Card>
      <CardHeader title={meta.title} subtitle={meta.description} />
      <CardBody>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {meta.fields.map(([key, label, hint]) => (
            <Input key={key} label={label} hint={hint} type="number" step="any" value={form[key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} error={errors[key]} />
          ))}
          <div className="sm:col-span-2">
            <Button type="submit" loading={save.isPending}>Save</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function Announcement() {
  const [form, setForm] = useState({ title: '', message: '', link: '' });
  const send = useMutation({
    mutationFn: () => api.post<{ delivered: number }>('/admin/announcements', { ...form, link: form.link || null }),
    onSuccess: ({ delivered }) => {
      toast.success('Announcement sent', { description: `Delivered to ${delivered} user${delivered === 1 ? '' : 's'}.` });
      setForm({ title: '', message: '', link: '' });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const errors = send.error instanceof ApiError ? send.error.fields : {};
  return (
    <Card id="announcement">
      <CardHeader title="Announcement" subtitle="Send an in-app notification to every active user (respects their preferences)" />
      <CardBody>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <Input label="Title" maxLength={80} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} error={errors.title} />
          <Textarea label="Message" maxLength={500} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} error={errors.message} />
          <Input label="Link (optional)" placeholder="/ipo" hint="An in-app path users are taken to" value={form.link} onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))} error={errors.link} />
          <Button type="submit" icon={<Megaphone className="size-4" />} loading={send.isPending} disabled={form.title.trim().length < 3 || form.message.trim().length < 3} className="self-start">Send announcement</Button>
        </form>
      </CardBody>
    </Card>
  );
}

export default function AdminSettingsPage() {
  const { data, isPending, error, refetch } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<{ settings: Settings }>('/admin/settings') });
  if (isPending) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Platform configuration. Every change is recorded in the audit trail." />
      <div className="grid gap-6 xl:grid-cols-2">
        <SettingsSection section="charges" values={data.settings.charges} />
        <div className="flex flex-col gap-6">
          <SettingsSection section="funds" values={data.settings.funds} />
          <SettingsSection section="trading" values={data.settings.trading} />
        </div>
      </div>
      <Announcement />
    </div>
  );
}
