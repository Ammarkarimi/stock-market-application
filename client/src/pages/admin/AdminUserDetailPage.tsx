import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CircleDollarSign, LockOpen, LogOut, ShieldCheck, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { ApplicationStatusBadge, OrderStatusBadge } from '@/components/trade/OrderStatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input, Textarea } from '@/components/ui/Field';
import { EmptyState, ErrorState, KeyValue } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { Segmented } from '@/components/ui/Tabs';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { actionLabel, detailSummary } from '@/lib/activity';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatINR, formatNumber, formatPercent, relativeTime, trendClass } from '@/lib/format';
import type { AdminUserDetail } from '@/lib/types';

type Dialog = 'suspend' | 'reactivate' | 'unlock' | 'signout' | 'role' | 'funds' | null;

function FundsAdjustment({ userId, onClose }: { userId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const adjust = useMutation({
    mutationFn: () => api.post(`/admin/users/${userId}/funds-adjustment`, { direction, amount: Number(amount), reason }),
    onSuccess: () => {
      toast.success(direction === 'CREDIT' ? 'Account credited' : 'Account debited');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      busy={adjust.isPending}
      title="Adjust funds"
      description="Creates a ledger entry and notifies the user. Recorded in the audit trail."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={direction === 'CREDIT' ? 'primary' : 'danger'} loading={adjust.isPending} disabled={!(Number(amount) > 0) || reason.trim().length < 3} onClick={() => adjust.mutate()}>
            {direction === 'CREDIT' ? 'Credit' : 'Debit'} {Number(amount) > 0 ? formatINR(Number(amount)) : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented value={direction} onChange={setDirection} size="md" aria-label="Direction" options={[{ value: 'CREDIT', label: 'Credit' }, { value: 'DEBIT', label: 'Debit' }]} />
        <Input label="Amount" type="number" prefix="₹" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Goodwill credit for delayed refund" />
      </div>
    </Modal>
  );
}

export default function AdminUserDetailPage() {
  const { id } = useParams();
  const userId = Number(id);
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const { data, isPending, error, refetch } = useQuery({ queryKey: ['admin', 'user', userId], queryFn: () => api.get<AdminUserDetail>(`/admin/users/${userId}`) });

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(`/admin/users/${userId}/${path}`, body),
    onSuccess: (_result, { path }) => {
      toast.success({ status: 'User status updated', unlock: 'Account unlocked', 'revoke-sessions': 'User signed out everywhere', role: 'Role updated' }[path] ?? 'Done');
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (isPending) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const { user, funds, portfolio, security } = data;
  const isSelf = me?.id === user.id;
  const locked = Boolean((security.lockedUntil && new Date(security.lockedUntil) > new Date()) || (security.pinLockedUntil && new Date(security.pinLockedUntil) > new Date()));

  return (
    <div className="flex flex-col gap-6">
      <Link to="/admin/users" className="flex w-fit items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> All users</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{user.fullName}</h1>
            <Badge tone={user.status === 'ACTIVE' ? 'success' : 'danger'}>{user.status === 'ACTIVE' ? 'Active' : 'Suspended'}</Badge>
            {user.role === 'ADMIN' && <Badge tone="primary">Admin</Badge>}
            {locked && <Badge tone="warning">Locked</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">{user.email} · {user.phone ?? 'no phone'} · joined {formatDate(user.createdAt)} · last login {user.lastLoginAt ? relativeTime(user.lastLoginAt) : 'never'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<CircleDollarSign className="size-4" />} onClick={() => setDialog('funds')}>Adjust funds</Button>
          <Button size="sm" variant="secondary" icon={<LockOpen className="size-4" />} disabled={!locked} onClick={() => setDialog('unlock')}>Unlock</Button>
          <Button size="sm" variant="secondary" icon={<LogOut className="size-4" />} disabled={!data.sessions.length} onClick={() => setDialog('signout')}>Sign out everywhere</Button>
          <Button size="sm" variant="secondary" icon={<ShieldCheck className="size-4" />} disabled={isSelf} onClick={() => setDialog('role')}>{user.role === 'ADMIN' ? 'Remove admin' : 'Make admin'}</Button>
          {user.status === 'ACTIVE' ? (
            <Button size="sm" variant="danger" icon={<Ban className="size-4" />} disabled={isSelf} onClick={() => setDialog('suspend')}>Suspend</Button>
          ) : (
            <Button size="sm" icon={<UserCheck className="size-4" />} onClick={() => setDialog('reactivate')}>Reactivate</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cash balance" value={formatINR(funds.cashBalance)} sub={<span className="text-muted">Available {formatINR(funds.availableBalance)}</span>} />
        <Stat label="Holdings value" value={formatINR(portfolio.summary.currentValue)} sub={<span className={trendClass(portfolio.summary.totalPnl)}>{formatINR(portfolio.summary.totalPnl, { sign: true })} ({formatPercent(portfolio.summary.totalPnlPercent)})</span>} />
        <Stat label="Deposited / withdrawn" value={formatINR(funds.totalDeposits, { decimals: 0 })} sub={<span className="text-muted">Withdrawn {formatINR(funds.totalWithdrawals, { decimals: 0 })}</span>} />
        <Stat label="Security" value={user.hasPin ? 'PIN set' : 'No PIN'} sub={<span className="text-muted">{security.failedLoginAttempts} failed logins · password changed {security.passwordChangedAt ? relativeTime(security.passwordChangedAt) : '—'}</span>} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Holdings" subtitle={`${portfolio.summary.holdingsCount} securities · invested ${formatINR(portfolio.summary.invested)}`} />
          {portfolio.holdings.length === 0 ? (
            <EmptyState title="No holdings" />
          ) : (
            <TableWrap>
              <Table>
                <thead><tr><Th>Security</Th><Th align="right">Qty</Th><Th align="right">Avg.</Th><Th align="right">Value</Th><Th align="right">P&L</Th></tr></thead>
                <tbody>
                  {portfolio.holdings.map((h) => (
                    <Tr key={h.symbol}>
                      <Td className="font-medium">{h.symbol}</Td>
                      <Td align="right">{formatNumber(h.quantity)}</Td>
                      <Td align="right">{formatINR(h.averagePrice)}</Td>
                      <Td align="right">{formatINR(h.currentValue)}</Td>
                      <Td align="right" className={trendClass(h.pnl)}>{formatINR(h.pnl, { sign: true })}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
        <Card>
          <CardHeader title="Profile & bank" />
          <CardBody className="py-3">
            <KeyValue label="Date of birth" value={user.dateOfBirth ? formatDate(user.dateOfBirth) : '—'} />
            <KeyValue label="PAN" value={user.pan ?? '—'} />
            <KeyValue label="Address" value={<span className="block max-w-48 truncate" title={user.address ?? ''}>{user.address ?? '—'}</span>} />
            <KeyValue label="Bank" value={data.bankAccount ? `${data.bankAccount.bankName} ${data.bankAccount.accountNumberMasked}` : 'Not linked'} />
            <KeyValue label="Blocked funds" value={formatINR(funds.blockedForOrders + funds.blockedForIpos)} />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent orders" action={<Link to={`/admin/orders?userId=${user.id}`} className="text-xs font-medium text-primary hover:underline">All orders</Link>} />
          {data.orders.length === 0 ? <EmptyState title="No orders" /> : (
            <ul className="divide-y divide-border">
              {data.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span><span className={o.side === 'BUY' ? 'font-bold text-gain' : 'font-bold text-loss'}>{o.side}</span> {o.quantity} {o.symbol} <span className="text-xs text-muted">· {relativeTime(o.createdAt)}</span></span>
                  <OrderStatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="IPO applications" />
          {data.ipoApplications.length === 0 ? <EmptyState title="No applications" /> : (
            <ul className="divide-y divide-border">
              {data.ipoApplications.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span>{a.companyName} <span className="text-xs text-muted">· {a.lots} lot{a.lots === 1 ? '' : 's'} · {formatINR(a.amount, { decimals: 0 })}</span></span>
                  <ApplicationStatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Active sessions" />
          {data.sessions.length === 0 ? <EmptyState title="Not signed in anywhere" /> : (
            <ul className="divide-y divide-border">
              {data.sessions.map((s) => (
                <li key={s.id} className="px-4 py-2.5 text-sm sm:px-5">
                  <p className="font-medium">{s.device}</p>
                  <p className="text-xs text-muted">{s.ip} · active {relativeTime(s.lastSeenAt)} · since {formatDateTime(s.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Activity" action={<Link to={`/admin/audit?subjectUserId=${user.id}`} className="text-xs font-medium text-primary hover:underline">Full audit trail</Link>} />
          <ul className="divide-y divide-border">
            {data.activity.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                <span className="min-w-0">
                  <span className="font-medium">{actionLabel(entry.action)}</span>
                  {detailSummary(entry.details) && <span className="block truncate text-xs text-muted">{detailSummary(entry.details)}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{relativeTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {dialog === 'funds' && <FundsAdjustment userId={user.id} onClose={() => setDialog(null)} />}
      <ConfirmDialog open={dialog === 'suspend'} title={`Suspend ${user.fullName}?`} description="They will be signed out everywhere, open orders will be cancelled and they won't be able to sign in until reactivated." confirmLabel="Suspend account" variant="danger" requireReason loading={action.isPending} onConfirm={(reason) => action.mutate({ path: 'status', body: { status: 'SUSPENDED', reason } })} onClose={() => setDialog(null)} />
      <ConfirmDialog open={dialog === 'reactivate'} title={`Reactivate ${user.fullName}?`} confirmLabel="Reactivate" requireReason loading={action.isPending} onConfirm={(reason) => action.mutate({ path: 'status', body: { status: 'ACTIVE', reason } })} onClose={() => setDialog(null)} />
      <ConfirmDialog open={dialog === 'unlock'} title="Unlock account?" description="Clears failed sign-in and PIN attempt locks." confirmLabel="Unlock" loading={action.isPending} onConfirm={() => action.mutate({ path: 'unlock' })} onClose={() => setDialog(null)} />
      <ConfirmDialog open={dialog === 'signout'} title="Sign out everywhere?" description={`Ends all ${data.sessions.length} active session(s) for this user.`} confirmLabel="Sign out" variant="danger" loading={action.isPending} onConfirm={() => action.mutate({ path: 'revoke-sessions' })} onClose={() => setDialog(null)} />
      <ConfirmDialog open={dialog === 'role'} title={user.role === 'ADMIN' ? 'Remove administrator access?' : 'Grant administrator access?'} description="The user's sessions are ended so the new role takes effect at next sign-in." confirmLabel="Change role" loading={action.isPending} onConfirm={() => action.mutate({ path: 'role', body: { role: user.role === 'ADMIN' ? 'USER' : 'ADMIN' } })} onClose={() => setDialog(null)} />
    </div>
  );
}
