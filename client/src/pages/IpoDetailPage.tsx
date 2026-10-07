import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Minus, Plus, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { IpoTimeline, SubscriptionBars } from '@/components/market/IpoWidgets';
import { ApplicationStatusBadge, IpoStatusBadge } from '@/components/trade/OrderStatusBadge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, PinInput } from '@/components/ui/Field';
import { ErrorState, KeyValue } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { api, ApiError, errorMessage, symbolPath } from '@/lib/api';
import { formatDate, formatINR, formatNumber, formatPercent, trendClass } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { FundsSummary, Ipo, IpoApplication } from '@/lib/types';
import { markLocalAction } from '@/live/localActions';

function ApplyPanel({ ipo }: { ipo: Ipo }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [lots, setLots] = useState(ipo.minLots);
  const [cutoff, setCutoff] = useState(true);
  const [bid, setBid] = useState(String(ipo.priceBand.high));
  const [confirming, setConfirming] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const { data: funds } = useQuery({ queryKey: keys.funds, queryFn: () => api.get<FundsSummary>('/funds') });

  const bidPrice = cutoff ? ipo.priceBand.high : Number(bid);
  const quantity = lots * ipo.lotSize;
  const amount = quantity * bidPrice;
  const bidValid = cutoff || (Number.isInteger(bidPrice) && bidPrice >= ipo.priceBand.low && bidPrice <= ipo.priceBand.high);
  const enoughFunds = funds ? funds.availableBalance >= amount : true;

  const apply = useMutation({
    mutationFn: () => api.post<{ application: IpoApplication }>(`/ipos/${ipo.id}/apply`, { lots, cutoff, bidPrice: cutoff ? null : bidPrice, pin }),
    onMutate: () => markLocalAction('IPO'),
    onSuccess: () => {
      toast.success('Application submitted', { description: `${formatINR(amount, { decimals: 0 })} is blocked until allotment on ${formatDate(ipo.dates.allotment)}.` });
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['ipos'] });
      void queryClient.invalidateQueries({ queryKey: ['funds'] });
    },
    onError: (err) => setPinError(err instanceof ApiError ? err.message : errorMessage(err)),
  });

  return (
    <Card>
      <CardHeader title="Apply" subtitle={`Lot of ${ipo.lotSize} shares · up to ${ipo.maxLots} lots`} />
      <CardBody className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Lots</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" aria-label="Fewer lots" disabled={lots <= ipo.minLots} onClick={() => setLots((l) => l - 1)}><Minus className="size-4" /></Button>
            <span className="num w-12 text-center text-lg font-semibold">{lots}</span>
            <Button variant="secondary" size="sm" aria-label="More lots" disabled={lots >= ipo.maxLots} onClick={() => setLots((l) => l + 1)}><Plus className="size-4" /></Button>
            <span className="num ml-2 text-sm text-muted">{formatNumber(quantity)} shares</span>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={cutoff} onChange={(e) => setCutoff(e.target.checked)} />
          Bid at cut-off price (₹{ipo.priceBand.high})
        </label>
        {!cutoff && (
          <Input
            label="Bid price"
            type="number"
            step={1}
            prefix="₹"
            value={bid}
            onChange={(e) => setBid(e.target.value)}
            error={bidValid ? undefined : `Enter a whole-rupee price between ₹${ipo.priceBand.low} and ₹${ipo.priceBand.high}`}
            hint="Bids below the final issue price are not allotted"
          />
        )}
        <div className="rounded-xl border border-border bg-surface-2/60 px-4 py-2">
          <KeyValue label="Amount to block" value={<span className="font-semibold">{formatINR(amount, { decimals: 0 })}</span>} />
          <KeyValue label="Available funds" value={formatINR(funds?.availableBalance)} className="text-xs" />
        </div>
        {!enoughFunds && (
          <p className="text-sm text-loss">
            Not enough funds. <Link to="/funds" className="font-medium underline">Add money</Link>
          </p>
        )}
        <Button size="lg" disabled={!bidValid || !enoughFunds} onClick={() => { setPin(''); setPinError(null); setConfirming(true); }}>
          Review application
        </Button>
      </CardBody>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        busy={apply.isPending}
        title={`Apply for ${ipo.companyName}`}
        description="Confirm your bid with your transaction PIN."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={apply.isPending}>Back</Button>
            <Button loading={apply.isPending} disabled={pin.length !== 4 || !user?.hasPin} onClick={() => apply.mutate()}>Confirm & apply</Button>
          </>
        }
      >
        <div className="rounded-xl border border-border bg-surface-2/60 px-4 py-2">
          <KeyValue label="Quantity" value={`${lots} lot${lots === 1 ? '' : 's'} · ${formatNumber(quantity)} shares`} />
          <KeyValue label="Bid price" value={cutoff ? `Cut-off (₹${ipo.priceBand.high})` : formatINR(bidPrice, { decimals: 0 })} />
          <KeyValue className="border-t border-border font-semibold" label="Amount blocked" value={formatINR(amount, { decimals: 0 })} />
        </div>
        <div className="mt-4">
          {user?.hasPin ? (
            <PinInput autoFocus value={pin} onChange={(e) => setPin(e.target.value)} error={pinError ?? undefined} />
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <p className="font-medium">Set a transaction PIN first</p>
                <ButtonLink to="/profile?tab=security" size="sm" variant="secondary" className="mt-2">Set PIN</ButtonLink>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </Card>
  );
}

function MyApplication({ application, ipo }: { application: IpoApplication; ipo: Ipo }) {
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api.post(`/ipos/applications/${application.id}/cancel`),
    onMutate: () => markLocalAction('IPO'),
    onSuccess: () => {
      toast.success('Application cancelled');
      void queryClient.invalidateQueries({ queryKey: ['ipos'] });
      void queryClient.invalidateQueries({ queryKey: ['funds'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Card>
      <CardHeader title="Your application" action={<ApplicationStatusBadge status={application.status} />} />
      <CardBody className="py-3">
        {application.status === 'ALLOTTED' && (
          <p className="mb-2 flex items-center gap-2 rounded-lg bg-gain-soft px-3 py-2 text-sm text-gain">
            <CheckCircle2 className="size-4" /> {formatNumber(application.allottedQuantity)} shares allotted at {formatINR(application.allotmentPrice, { decimals: 0 })}
          </p>
        )}
        <KeyValue label="Application no." value={<span className="break-all font-mono text-xs">{application.applicationNo}</span>} />
        <KeyValue label="Bid" value={`${application.lots} lot${application.lots === 1 ? '' : 's'} @ ${application.isCutoff ? 'cut-off' : formatINR(application.bidPrice, { decimals: 0 })}`} />
        <KeyValue label={application.status === 'APPLIED' ? 'Amount blocked' : 'Amount'} value={formatINR(application.amount, { decimals: 0 })} />
        {(application.status === 'ALLOTTED' || application.status === 'NOT_ALLOTTED') && (
          <>
            <KeyValue label="Debited" value={formatINR(application.amountDebited, { decimals: 0 })} />
            <KeyValue label="Released" value={formatINR(application.amountRefunded, { decimals: 0 })} />
          </>
        )}
        {application.statusReason && <p className="mt-2 text-xs text-muted">{application.statusReason}</p>}
        {application.status === 'ALLOTTED' && !application.sharesCreditedAt && <p className="mt-2 text-xs text-muted">Shares will be credited to your holdings on {formatDate(ipo.dates.listing)}.</p>}
        {application.status === 'APPLIED' && ipo.status === 'OPEN' && (
          <Button variant="secondary" size="sm" className="mt-3 w-full" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel application</Button>
        )}
      </CardBody>
    </Card>
  );
}

export default function IpoDetailPage() {
  const { id } = useParams();
  const ipoId = Number(id);
  const { data, isPending, error, refetch } = useQuery({ queryKey: keys.ipo(ipoId), queryFn: () => api.get<{ ipo: Ipo }>(`/ipos/${ipoId}`), refetchInterval: 30_000 });
  if (isPending) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const { ipo } = data;
  const application = ipo.myApplication;
  const canApply = ipo.status === 'OPEN' && (!application || application.status === 'CANCELLED');
  const maxRevenue = Math.max(1, ...ipo.financials.map((f) => f.revenueCr));

  return (
    <div className="flex flex-col gap-6">
      <Link to="/ipo" className="flex w-fit items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> All IPOs</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{ipo.companyName}</h1>
            <IpoStatusBadge status={ipo.status} />
          </div>
          <p className="mt-1 text-sm text-muted">{ipo.symbol} · {ipo.issueType === 'SME' ? 'SME' : 'Mainboard'} IPO · {ipo.sector} · {ipo.industry}</p>
        </div>
        {ipo.status === 'LISTED' && <ButtonLink to={`/stocks/${symbolPath(ipo.symbol)}`} variant="primary">Trade {ipo.symbol}</ButtonLink>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted">Price band</p><p className="num mt-1 text-lg font-semibold">₹{ipo.priceBand.low} – ₹{ipo.priceBand.high}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Lot size</p><p className="num mt-1 text-lg font-semibold">{ipo.lotSize} shares</p><p className="num text-xs text-muted">Min. {formatINR(ipo.minInvestment, { decimals: 0 })}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Issue size</p><p className="num mt-1 text-lg font-semibold">₹{formatNumber(ipo.issueSizeCr)} Cr</p><p className="num text-xs text-muted">Fresh ₹{formatNumber(ipo.freshIssueCr)} Cr · OFS ₹{formatNumber(ipo.ofsCr)} Cr</p></Card>
        {ipo.status === 'LISTED' ? (
          <Card className="p-4">
            <p className="text-xs text-muted">Listing gain</p>
            <p className={`num mt-1 text-lg font-semibold ${trendClass(ipo.listingGainPercent)}`}>{formatPercent(ipo.listingGainPercent)}</p>
            <p className="num text-xs text-muted">Issue {formatINR(ipo.issuePrice, { decimals: 0 })} → listed {formatINR(ipo.listingPrice)}</p>
          </Card>
        ) : (
          <Card className="p-4"><p className="text-xs text-muted">Subscription</p><p className="num mt-1 text-lg font-semibold">{ipo.subscription.total.toFixed(2)}x</p><p className="text-xs text-muted">{ipo.status === 'UPCOMING' ? 'Opens ' + formatDate(ipo.dates.open) : 'Overall'}</p></Card>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card>
            <CardHeader title="Timeline" />
            <CardBody><IpoTimeline ipo={ipo} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="About the company" />
            <CardBody className="flex flex-col gap-4 text-sm">
              <p className="leading-relaxed text-muted">{ipo.description}</p>
              <div className="grid gap-x-8 sm:grid-cols-2">
                <KeyValue label="Registrar" value={ipo.registrar ?? '—'} />
                <KeyValue label="Lead managers" value={ipo.leadManagers.join(', ') || '—'} />
                <KeyValue label="Max. lots (retail)" value={ipo.maxLots} />
                <KeyValue label="Max. investment" value={formatINR(ipo.maxInvestment, { decimals: 0 })} />
              </div>
            </CardBody>
          </Card>
          {ipo.financials.length > 0 && (
            <Card>
              <CardHeader title="Financials" subtitle="₹ crore, as stated in the offer document (illustrative)" />
              <CardBody>
                <div className="flex h-40 items-end gap-6">
                  {ipo.financials.map((f) => (
                    <div key={f.year} className="flex flex-1 flex-col items-center gap-2">
                      <div className="flex h-32 w-full items-end justify-center gap-1">
                        <div className="w-1/4 max-w-7 rounded-t bg-primary/80" style={{ height: `${(f.revenueCr / maxRevenue) * 100}%` }} title={`Revenue ₹${f.revenueCr} Cr`} />
                        <div className="w-1/4 max-w-7 rounded-t bg-gain" style={{ height: `${Math.max(1, (Math.max(0, f.profitCr) / maxRevenue) * 100)}%` }} title={`Profit ₹${f.profitCr} Cr`} />
                      </div>
                      <span className="text-xs text-muted">{f.year}</span>
                    </div>
                  ))}
                </div>
                <table className="num mt-4 w-full text-sm">
                  <thead><tr className="text-xs text-muted"><th className="py-1.5 text-left font-medium">₹ Cr</th>{ipo.financials.map((f) => <th key={f.year} className="py-1.5 text-right font-medium">{f.year}</th>)}</tr></thead>
                  <tbody>
                    {(['revenueCr', 'profitCr', 'assetsCr'] as const).map((field) => (
                      <tr key={field} className="border-t border-border">
                        <td className="py-1.5 text-muted">{field === 'revenueCr' ? 'Revenue' : field === 'profitCr' ? 'Net profit' : 'Total assets'}</td>
                        {ipo.financials.map((f) => <td key={f.year} className={`py-1.5 text-right ${f[field] < 0 ? 'text-loss' : ''}`}>{formatNumber(f[field])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {canApply && <ApplyPanel ipo={ipo} />}
          {application && application.status !== 'CANCELLED' && <MyApplication application={application} ipo={ipo} />}
          {ipo.status !== 'UPCOMING' && (
            <Card>
              <CardHeader title="Subscription status" subtitle={ipo.status === 'OPEN' ? 'Updates live during the bidding window' : 'Final figures'} />
              <CardBody><SubscriptionBars ipo={ipo} /></CardBody>
            </Card>
          )}
          {ipo.status === 'UPCOMING' && (
            <Card>
              <CardBody className="text-sm text-muted">Bidding opens on <span className="font-medium text-fg">{formatDate(ipo.dates.open)}</span>. You'll get a notification when it opens.</CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
