import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LaptopMinimal, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, PinInput, Textarea } from '@/components/ui/Field';
import { ErrorState, KeyValue, PageHeader, Pagination, Switch } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { actionLabel, detailSummary } from '@/lib/activity';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, relativeTime } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { ActivityEntry, NotificationPreferences, Page, Profile, Session } from '@/lib/types';
import { markLocalAction } from '@/live/localActions';
import { categoryLabel } from './notificationMeta';

type Tab = 'personal' | 'bank' | 'security' | 'notifications' | 'activity';

function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError ? err.fields : {};
}

function PersonalDetails({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const { updateUser } = useAuth();
  const { user } = profile;
  const [form, setForm] = useState({ fullName: user.fullName, phone: user.phone ?? '', dateOfBirth: user.dateOfBirth ?? '', pan: user.pan ?? '', address: user.address ?? '' });
  const save = useMutation({
    mutationFn: () => api.patch<{ user: Profile['user'] }>('/profile', { ...form, phone: form.phone || null, dateOfBirth: form.dateOfBirth || null, pan: form.pan || null, address: form.address || null }),
    onSuccess: ({ user: updated }) => {
      toast.success('Profile updated');
      updateUser(updated);
      void queryClient.invalidateQueries({ queryKey: keys.profile });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const errors = fieldErrors(save.error);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <Card>
      <CardHeader title="Personal details" subtitle={`Member since ${formatDate(user.createdAt)}`} />
      <CardBody>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
          <Input label="Full name" value={form.fullName} onChange={set('fullName')} error={errors.fullName} required />
          <Input label="Email" value={user.email} disabled hint="Contact support to change your email" />
          <Input label="Mobile number" prefix="+91" className="pl-11" inputMode="numeric" maxLength={10} value={form.phone} onChange={set('phone')} error={errors.phone} />
          <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} error={errors.dateOfBirth} />
          <Input label="PAN" placeholder="ABCDE1234F" maxLength={10} value={form.pan} onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))} error={errors.pan} />
          <Textarea label="Address" containerClassName="sm:col-span-2" value={form.address} onChange={set('address')} error={errors.address} maxLength={300} />
          <div className="sm:col-span-2">
            <Button type="submit" loading={save.isPending}>Save changes</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function BankAccountForm({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const bank = profile.bankAccount;
  const [form, setForm] = useState({ accountHolder: bank?.accountHolder ?? profile.user.fullName, accountNumber: '', confirmAccountNumber: '', ifsc: bank?.ifsc ?? '', bankName: bank?.bankName ?? '' });
  const save = useMutation({
    mutationFn: () => api.put('/profile/bank-account', { accountHolder: form.accountHolder, accountNumber: form.accountNumber, ifsc: form.ifsc, bankName: form.bankName }),
    onMutate: () => markLocalAction('SECURITY'),
    onSuccess: () => {
      toast.success('Bank account saved');
      setForm((f) => ({ ...f, accountNumber: '', confirmAccountNumber: '' }));
      void queryClient.invalidateQueries({ queryKey: keys.profile });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const errors = fieldErrors(save.error);
  const mismatch = form.confirmAccountNumber.length > 0 && form.accountNumber !== form.confirmAccountNumber;
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: key === 'ifsc' ? e.target.value.toUpperCase() : e.target.value }));
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader title="Linked account" />
        <CardBody>
          {bank ? (
            <>
              <KeyValue label="Bank" value={bank.bankName} />
              <KeyValue label="Account" value={bank.accountNumberMasked} />
              <KeyValue label="Holder" value={bank.accountHolder} />
              <KeyValue label="IFSC" value={bank.ifsc} />
              <p className="mt-2 text-xs text-muted">Updated {formatDateTime(bank.updatedAt)}</p>
            </>
          ) : (
            <p className="text-sm text-muted">No bank account linked yet. Withdrawals are sent to this account.</p>
          )}
        </CardBody>
      </Card>
      <Card className="lg:col-span-3">
        <CardHeader title={bank ? 'Change bank account' : 'Add bank account'} subtitle="Withdrawals are only sent to an account in your name" />
        <CardBody>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!mismatch) save.mutate(); }}>
            <Input label="Account holder name" value={form.accountHolder} onChange={set('accountHolder')} error={errors.accountHolder} required />
            <Input label="Bank name" value={form.bankName} onChange={set('bankName')} error={errors.bankName} required />
            <Input label="Account number" inputMode="numeric" autoComplete="off" value={form.accountNumber} onChange={set('accountNumber')} error={errors.accountNumber} required />
            <Input label="Confirm account number" inputMode="numeric" autoComplete="off" value={form.confirmAccountNumber} onChange={set('confirmAccountNumber')} error={mismatch ? 'Account numbers do not match' : undefined} required />
            <Input label="IFSC" placeholder="HDFC0001234" maxLength={11} value={form.ifsc} onChange={set('ifsc')} error={errors.ifsc} required />
            <div className="flex items-end">
              <Button type="submit" loading={save.isPending} disabled={mismatch || !form.accountNumber}>Save bank account</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function ChangePassword() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const change = useMutation({
    mutationFn: () => api.post<{ revokedSessions: number }>('/profile/password', form),
    onMutate: () => markLocalAction('SECURITY'),
    onSuccess: ({ revokedSessions }) => {
      toast.success('Password changed', { description: revokedSessions ? `${revokedSessions} other session${revokedSessions === 1 ? '' : 's'} signed out.` : undefined });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
  });
  const errors = fieldErrors(change.error);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <Card>
      <CardHeader title="Password" subtitle="Changing your password signs out your other sessions" />
      <CardBody>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
          <Input label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} error={errors.currentPassword ?? (change.error instanceof ApiError && change.error.code === 'INVALID_PASSWORD' ? change.error.message : undefined)} required />
          <Input label="New password" type="password" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} error={errors.newPassword} hint="At least 8 characters with a letter and a number" required />
          <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set('confirmPassword')} error={errors.confirmPassword} required />
          {change.error && !(change.error instanceof ApiError && (Object.keys(change.error.fields).length || change.error.code === 'INVALID_PASSWORD')) && <p className="text-sm text-loss">{errorMessage(change.error)}</p>}
          <Button type="submit" loading={change.isPending} className="self-start">Change password</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function TransactionPin() {
  const { user, refreshUser } = useAuth();
  const [form, setForm] = useState({ password: '', pin: '', confirmPin: '' });
  const save = useMutation({
    mutationFn: () => api.post('/profile/pin', form),
    onMutate: () => markLocalAction('SECURITY'),
    onSuccess: () => {
      toast.success(user?.hasPin ? 'Transaction PIN changed' : 'Transaction PIN set');
      setForm({ password: '', pin: '', confirmPin: '' });
      void refreshUser();
    },
  });
  const errors = fieldErrors(save.error);
  return (
    <Card>
      <CardHeader
        title="Transaction PIN"
        subtitle="Confirms orders, IPO applications and withdrawals"
        action={user?.hasPin ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Not set</Badge>}
      />
      <CardBody>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Input label="Account password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} error={errors.password ?? (save.error instanceof ApiError && save.error.code === 'INVALID_PASSWORD' ? save.error.message : undefined)} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <PinInput label={user?.hasPin ? 'New PIN' : 'PIN'} value={form.pin} onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))} error={errors.pin} />
            <PinInput label="Confirm PIN" value={form.confirmPin} onChange={(e) => setForm((f) => ({ ...f, confirmPin: e.target.value }))} error={errors.confirmPin} />
          </div>
          {save.error && !(save.error instanceof ApiError && (Object.keys(save.error.fields).length || save.error.code === 'INVALID_PASSWORD')) && <p className="text-sm text-loss">{errorMessage(save.error)}</p>}
          <p className="text-xs text-muted">Avoid repeated or sequential digits. Five wrong attempts block PIN use for 30 minutes.</p>
          <Button type="submit" loading={save.isPending} disabled={form.pin.length !== 4 || form.confirmPin.length !== 4} icon={<KeyRound className="size-4" />} className="self-start">
            {user?.hasPin ? 'Change PIN' : 'Set PIN'}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Sessions() {
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const { data } = useQuery({ queryKey: keys.sessions, queryFn: () => api.get<{ sessions: Session[] }>('/auth/sessions'), refetchInterval: 30_000 });
  const revoke = useMutation({
    mutationFn: (session: Session) => api.delete<{ signedOut: boolean }>(`/auth/sessions/${session.id}`),
    onSuccess: (result) => {
      if (result.signedOut) void logout();
      else {
        toast.success('Session signed out');
        void queryClient.invalidateQueries({ queryKey: keys.sessions });
      }
    },
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.post<{ revoked: number }>('/auth/sessions/revoke-others'),
    onSuccess: ({ revoked }) => {
      toast.success(`${revoked} other session${revoked === 1 ? '' : 's'} signed out`);
      void queryClient.invalidateQueries({ queryKey: keys.sessions });
    },
  });
  const others = data?.sessions.filter((s) => !s.current).length ?? 0;
  return (
    <Card>
      <CardHeader
        title="Active sessions"
        subtitle="Devices currently signed in to your account"
        action={<Button size="sm" variant="secondary" disabled={!others} loading={revokeOthers.isPending} icon={<LogOut className="size-4" />} onClick={() => revokeOthers.mutate()}>Sign out others</Button>}
      />
      <ul className="divide-y divide-border">
        {data?.sessions.map((session) => {
          const mobile = /iOS|Android/.test(session.device);
          const Icon = mobile ? Smartphone : LaptopMinimal;
          return (
            <li key={session.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="rounded-lg bg-surface-2 p-2 text-muted"><Icon className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">{session.device} {session.current && <Badge tone="success">This device</Badge>}</p>
                <p className="text-xs text-muted">{session.ip ?? 'Unknown IP'} · Active {relativeTime(session.lastSeenAt)} · Signed in {formatDateTime(session.createdAt)}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(session)}>{session.current ? 'Sign out' : 'Revoke'}</Button>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border px-5 py-3 text-xs text-muted">Sessions end after 2 hours of inactivity or 7 days, whichever is first. This app also signs you out after 30 minutes without interaction.</p>
    </Card>
  );
}

function Notifications({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const [prefs, setPrefs] = useState<NotificationPreferences>(profile.notificationPreferences);
  useEffect(() => setPrefs(profile.notificationPreferences), [profile.notificationPreferences]);
  const save = useMutation({
    mutationFn: (next: NotificationPreferences) => api.put('/profile/notification-preferences', next),
    onSuccess: () => {
      toast.success('Preferences saved');
      void queryClient.invalidateQueries({ queryKey: keys.profile });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const descriptions: Record<keyof NotificationPreferences, string> = {
    ORDER: 'Order executions, rejections, cancellations and expiries',
    IPO: 'IPO openings, application updates, allotment and listing',
    PRICE_ALERT: 'When a price alert you set is triggered',
    FUNDS: 'Deposits, withdrawals and balance adjustments',
    SYSTEM: 'Announcements and trading halts on your holdings',
  };
  return (
    <Card>
      <CardHeader title="Notification preferences" subtitle="Choose which in-app notifications you receive" />
      <ul className="divide-y divide-border">
        {(Object.keys(descriptions) as (keyof NotificationPreferences)[]).map((key) => (
          <li key={key} className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
            <div>
              <p className="text-sm font-medium">{categoryLabel[key]}</p>
              <p className="text-xs text-muted">{descriptions[key]}</p>
            </div>
            <Switch
              checked={prefs[key]}
              label={categoryLabel[key]}
              onChange={(value) => {
                const next = { ...prefs, [key]: value };
                setPrefs(next);
                save.mutate(next);
              }}
            />
          </li>
        ))}
        <li className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-gain" /> Security</p>
            <p className="text-xs text-muted">New sign-ins, password and PIN changes. Always on for your protection.</p>
          </div>
          <Switch checked disabled label="Security notifications" onChange={() => {}} />
        </li>
      </ul>
    </Card>
  );
}

function Activity() {
  const [page, setPage] = useState(1);
  const { data } = useQuery({ queryKey: keys.activity(page), queryFn: () => api.get<Page<ActivityEntry>>(`/profile/activity?page=${page}&pageSize=20`), placeholderData: keepPreviousData });
  return (
    <Card>
      <CardHeader title="Account activity" subtitle="A tamper-evident record of everything that happened in your account" />
      {!data ? (
        <PageLoader />
      ) : (
        <>
          <ul className="divide-y divide-border">
            {data.items.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{actionLabel(entry.action)}</p>
                  <p className="text-xs text-muted">{[detailSummary(entry.details), entry.actorRole === 'SYSTEM' ? 'by system' : entry.actorRole === 'ADMIN' && entry.actorName ? `by admin` : null, entry.ip].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="text-xs text-muted" title={formatDateTime(entry.createdAt)}>{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

export default function ProfilePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'personal';
  const { data: profile, isPending, error, refetch } = useQuery({ queryKey: keys.profile, queryFn: () => api.get<Profile>('/profile') });
  if (isPending) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Profile & settings" description={profile.user.email} />
      <Tabs
        value={tab}
        onChange={(value) => setParams({ tab: value }, { replace: true })}
        items={[
          { value: 'personal', label: 'Personal details' },
          { value: 'bank', label: 'Bank account' },
          { value: 'security', label: 'Security' },
          { value: 'notifications', label: 'Notifications' },
          { value: 'activity', label: 'Activity log' },
        ]}
      />
      {tab === 'personal' && <PersonalDetails profile={profile} />}
      {tab === 'bank' && <BankAccountForm profile={profile} />}
      {tab === 'security' && (
        <div className="grid gap-6 xl:grid-cols-2">
          <TransactionPin />
          <ChangePassword />
          <div className="xl:col-span-2">
            <Sessions />
          </div>
        </div>
      )}
      {tab === 'notifications' && <Notifications profile={profile} />}
      {tab === 'activity' && <Activity />}
    </div>
  );
}
