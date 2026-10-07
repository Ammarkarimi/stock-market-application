import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Building2, CreditCard, Landmark, Smartphone, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/Card';
import { Input, PinInput } from '@/components/ui/Field';
import { EmptyState, KeyValue, PageHeader, Pagination } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, ApiError, errorMessage, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatINR } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { FundsSummary, FundTransaction, Page, Profile } from '@/lib/types';
import { markLocalAction } from '@/live/localActions';

const METHODS = [
  { value: 'UPI', label: 'UPI', icon: Smartphone, hint: 'Instant' },
  { value: 'NETBANKING', label: 'Net banking', icon: Landmark, hint: 'All major banks' },
  { value: 'CARD', label: 'Debit card', icon: CreditCard, hint: 'Visa, RuPay, Mastercard' },
] as const;
const QUICK_AMOUNTS = [1000, 5000, 10000, 25000, 50000];
const METHOD_LABEL: Record<string, string> = { UPI: 'UPI', NETBANKING: 'Net banking', CARD: 'Debit card', BANK_TRANSFER: 'Bank transfer' };

function invalidateFunds(queryClient: ReturnType<typeof useQueryClient>) {
  for (const queryKey of [['funds'], ['statement']]) void queryClient.invalidateQueries({ queryKey });
}

function AddMoney({ funds }: { funds: FundsSummary }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<(typeof METHODS)[number]['value']>('UPI');
  const value = Number(amount);
  const { minDeposit, maxDeposit } = funds.limits;
  const invalid = !value || value < minDeposit || value > maxDeposit;
  const deposit = useMutation({
    mutationFn: () => api.post<{ transaction: FundTransaction }>('/funds/deposit', { amount: value, method }),
    onMutate: () => markLocalAction('FUNDS'),
    onSuccess: ({ transaction }) => {
      toast.success(`${formatINR(transaction.amount)} added`, { description: `Reference ${transaction.reference}` });
      setAmount('');
      invalidateFunds(queryClient);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Card>
      <CardHeader title="Add money" subtitle="Funds are available to trade instantly" />
      <CardBody className="flex flex-col gap-4">
        <Input
          label="Amount"
          type="number"
          prefix="₹"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          hint={`Between ${formatINR(minDeposit, { decimals: 0 })} and ${formatINR(maxDeposit, { decimals: 0 })} per transaction`}
          error={amount && invalid ? `Enter an amount between ${formatINR(minDeposit, { decimals: 0 })} and ${formatINR(maxDeposit, { decimals: 0 })}` : undefined}
        />
        <div className="flex flex-wrap gap-2">
          {QUICK_AMOUNTS.map((q) => (
            <button key={q} type="button" onClick={() => setAmount(String((Number(amount) || 0) + q))} className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:border-primary hover:text-primary">
              +{formatINR(q, { decimals: 0 })}
            </button>
          ))}
        </div>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Payment method</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {METHODS.map(({ value: m, label, icon: Icon, hint }) => (
              <label key={m} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors', method === m ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-2')}>
                <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="sr-only" />
                <Icon className={cn('size-5', method === m ? 'text-primary' : 'text-muted')} />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-[11px] text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button size="lg" disabled={invalid} loading={deposit.isPending} onClick={() => deposit.mutate()}>
          Add {value ? formatINR(value) : 'money'}
        </Button>
        <p className="text-xs text-subtle">Payments are simulated in this demo; no real money moves.</p>
      </CardBody>
    </Card>
  );
}

function Withdraw({ funds }: { funds: FundsSummary }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const { data: profile, isPending } = useQuery({ queryKey: keys.profile, queryFn: () => api.get<Profile>('/profile') });
  const value = Number(amount);
  const { minWithdrawal } = funds.limits;
  const invalid = !value || value < minWithdrawal || value > funds.withdrawable;
  const withdraw = useMutation({
    mutationFn: () => api.post<{ transaction: FundTransaction }>('/funds/withdraw', { amount: value, pin }),
    onMutate: () => markLocalAction('FUNDS'),
    onSuccess: ({ transaction }) => {
      toast.success('Withdrawal processed', { description: `${formatINR(transaction.amount)} sent to ${transaction.bankAccount}` });
      setConfirming(false);
      setAmount('');
      invalidateFunds(queryClient);
    },
    onError: (err) => setPinError(err instanceof ApiError ? err.message : errorMessage(err)),
  });
  const bank = profile?.bankAccount;

  return (
    <Card>
      <CardHeader title="Withdraw" subtitle="Transfer available funds to your bank account" />
      <CardBody className="flex flex-col gap-4">
        {isPending ? (
          <Skeleton className="h-16" />
        ) : bank ? (
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <Building2 className="size-5 text-muted" />
            <div className="text-sm">
              <p className="font-medium">{bank.bankName} {bank.accountNumberMasked}</p>
              <p className="text-xs text-muted">{bank.accountHolder} · {bank.ifsc}</p>
            </div>
            <Link to="/profile?tab=bank" className="ml-auto text-xs font-medium text-primary hover:underline">Change</Link>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border-strong p-4 text-sm">
            <p className="font-medium">No bank account linked</p>
            <p className="mt-0.5 text-muted">Add a bank account to withdraw money.</p>
            <ButtonLink to="/profile?tab=bank" size="sm" variant="secondary" className="mt-3">Add bank account</ButtonLink>
          </div>
        )}
        <Input
          label="Amount"
          type="number"
          prefix="₹"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={!bank}
          hint={`Withdrawable: ${formatINR(funds.withdrawable)}`}
          error={amount && invalid ? (value > funds.withdrawable ? `You can withdraw at most ${formatINR(funds.withdrawable)}` : `Minimum withdrawal is ${formatINR(minWithdrawal, { decimals: 0 })}`) : undefined}
          suffix={<button type="button" disabled={!bank} className="px-1 text-xs font-semibold text-primary" onClick={() => setAmount(String(Math.floor(funds.withdrawable * 100) / 100))}>MAX</button>}
        />
        <Button size="lg" variant="secondary" disabled={!bank || invalid} onClick={() => { setPin(''); setPinError(null); setConfirming(true); }}>
          Withdraw {value ? formatINR(value) : ''}
        </Button>
      </CardBody>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        busy={withdraw.isPending}
        title="Confirm withdrawal"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={withdraw.isPending}>Back</Button>
            <Button loading={withdraw.isPending} disabled={pin.length !== 4 || !user?.hasPin} onClick={() => withdraw.mutate()}>Withdraw</Button>
          </>
        }
      >
        <div className="rounded-xl border border-border bg-surface-2/60 px-4 py-2">
          <KeyValue label="Amount" value={formatINR(value)} />
          <KeyValue label="To" value={bank ? `${bank.bankName} ${bank.accountNumberMasked}` : '—'} />
        </div>
        <div className="mt-4">
          {user?.hasPin ? <PinInput autoFocus value={pin} onChange={(e) => setPin(e.target.value)} error={pinError ?? undefined} /> : <p className="text-sm text-warning">Set a transaction PIN in <Link className="underline" to="/profile?tab=security">your profile</Link> to withdraw.</p>}
        </div>
      </Modal>
    </Card>
  );
}

function Transactions() {
  const [type, setType] = useState<'' | 'DEPOSIT' | 'WITHDRAWAL'>('');
  const [page, setPage] = useState(1);
  const params = { type, page, pageSize: 10 };
  const { data } = useQuery({ queryKey: keys.fundTransactions(params), queryFn: () => api.get<Page<FundTransaction>>(`/funds/transactions${qs(params)}`), placeholderData: keepPreviousData });
  return (
    <Card>
      <CardHeader title="Fund transactions" action={<Link to="/statements" className="text-xs font-medium text-primary hover:underline">Full statement</Link>} />
      <Tabs className="px-2" value={type} onChange={(v) => { setType(v); setPage(1); }} items={[{ value: '', label: 'All' }, { value: 'DEPOSIT', label: 'Deposits' }, { value: 'WITHDRAWAL', label: 'Withdrawals' }]} />
      {!data ? (
        <Skeleton className="m-4 h-40" />
      ) : data.items.length === 0 ? (
        <EmptyState icon={<Wallet className="size-6" />} title="No transactions yet" />
      ) : (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Transaction</Th>
                  <Th className="hidden md:table-cell">Reference</Th>
                  <Th>Status</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((txn) => (
                  <Tr key={txn.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <span className={cn('rounded-full p-1.5', txn.type === 'DEPOSIT' ? 'bg-gain-soft text-gain' : 'bg-loss-soft text-loss')}>
                          {txn.type === 'DEPOSIT' ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                        </span>
                        <div>
                          <p className="font-medium">{txn.type === 'DEPOSIT' ? `Added via ${METHOD_LABEL[txn.method] ?? txn.method}` : `Withdrawn to ${txn.bankAccount}`}</p>
                          <p className="text-xs text-muted">{formatDateTime(txn.createdAt)}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="hidden font-mono text-xs text-muted md:table-cell">{txn.reference}</Td>
                    <Td><Badge tone={txn.status === 'COMPLETED' ? 'success' : 'danger'}>{txn.status === 'COMPLETED' ? 'Completed' : 'Failed'}</Badge></Td>
                    <Td align="right" className={cn('font-semibold', txn.type === 'DEPOSIT' ? 'text-gain' : 'text-fg')}>
                      {txn.type === 'DEPOSIT' ? '+' : '−'}{formatINR(txn.amount)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

export default function FundsPage() {
  const { data: funds } = useQuery({ queryKey: keys.funds, queryFn: () => api.get<FundsSummary>('/funds') });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Funds" description="Add money, withdraw to your bank and see your balances." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Account balance" value={funds ? formatINR(funds.cashBalance) : <Skeleton className="h-7 w-28" />} sub={funds && <span className="text-muted">Deposited {formatINR(funds.totalDeposits, { decimals: 0 })}</span>} />
        <Stat label="Available to trade" value={funds ? <span className="text-gain">{formatINR(funds.availableBalance)}</span> : <Skeleton className="h-7 w-28" />} />
        <Stat
          label="Blocked"
          value={funds ? formatINR(funds.blockedForOrders + funds.blockedForIpos) : <Skeleton className="h-7 w-24" />}
          sub={funds && <span className="text-muted">Orders {formatINR(funds.blockedForOrders, { decimals: 0 })} · IPOs {formatINR(funds.blockedForIpos, { decimals: 0 })}</span>}
        />
        <Stat label="Withdrawable" value={funds ? formatINR(funds.withdrawable) : <Skeleton className="h-7 w-28" />} sub={funds && <span className="text-muted">Withdrawn {formatINR(funds.totalWithdrawals, { decimals: 0 })}</span>} />
      </div>
      {funds && (
        <div className="grid gap-6 lg:grid-cols-2">
          <AddMoney funds={funds} />
          <Withdraw funds={funds} />
        </div>
      )}
      <Transactions />
    </div>
  );
}
