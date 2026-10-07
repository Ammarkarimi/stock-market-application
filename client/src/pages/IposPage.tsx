import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Rocket } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ApplicationStatusBadge, IpoStatusBadge } from '@/components/trade/OrderStatusBadge';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatINR, formatNumber, formatPercent, formatShortDate, trendClass } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { Ipo, IpoApplication } from '@/lib/types';
import { markLocalAction } from '@/live/localActions';

type Tab = 'open' | 'upcoming' | 'closed' | 'applications';

function IpoCard({ ipo }: { ipo: Ipo }) {
  const listed = ipo.status === 'LISTED';
  return (
    <Card className="flex flex-col p-5 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/ipo/${ipo.id}`} className="font-semibold hover:text-primary">{ipo.companyName}</Link>
          <p className="text-xs text-muted">{ipo.symbol} · {ipo.industry ?? ipo.sector}</p>
        </div>
        <IpoStatusBadge status={ipo.status} />
      </div>
      <div className="num mt-4 grid grid-cols-2 gap-3 text-sm">
        {listed ? (
          <>
            <div><p className="text-xs text-muted">Issue price</p><p className="font-medium">{formatINR(ipo.issuePrice, { decimals: 0 })}</p></div>
            <div><p className="text-xs text-muted">Listing price</p><p className="font-medium">{formatINR(ipo.listingPrice)} <span className={trendClass(ipo.listingGainPercent)}>({formatPercent(ipo.listingGainPercent)})</span></p></div>
            <div><p className="text-xs text-muted">Current price</p><p className="font-medium">{formatINR(ipo.currentPrice)}</p></div>
            <div><p className="text-xs text-muted">Listed on</p><p className="font-medium">{formatDate(ipo.dates.listing)}</p></div>
          </>
        ) : (
          <>
            <div><p className="text-xs text-muted">Price band</p><p className="font-medium">₹{ipo.priceBand.low}–{ipo.priceBand.high}</p></div>
            <div><p className="text-xs text-muted">Min. investment</p><p className="font-medium">{formatINR(ipo.minInvestment, { decimals: 0 })}</p></div>
            <div><p className="text-xs text-muted">Lot size</p><p className="font-medium">{ipo.lotSize} shares</p></div>
            <div><p className="text-xs text-muted">Issue size</p><p className="font-medium">₹{formatNumber(ipo.issueSizeCr)} Cr</p></div>
          </>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
        <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" /> {formatShortDate(ipo.dates.open)} – {formatShortDate(ipo.dates.close)}</span>
        {ipo.status === 'OPEN' || ipo.status === 'CLOSED' || ipo.status === 'ALLOTTED' ? <span className="num">Subscribed <strong className="text-fg">{ipo.subscription.total.toFixed(2)}x</strong></span> : null}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {ipo.myApplication && <ApplicationStatusBadge status={ipo.myApplication.status} />}
        <ButtonLink to={`/ipo/${ipo.id}`} size="sm" variant={ipo.status === 'OPEN' && !ipo.myApplication ? 'primary' : 'secondary'} className="ml-auto">
          {ipo.status === 'OPEN' && (!ipo.myApplication || ipo.myApplication.status === 'CANCELLED') ? 'Apply now' : 'View details'}
        </ButtonLink>
      </div>
    </Card>
  );
}

function Applications() {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState<IpoApplication | null>(null);
  const { data, isPending, error, refetch } = useQuery({ queryKey: keys.ipoApplications, queryFn: () => api.get<{ applications: IpoApplication[] }>('/ipos/applications') });
  const cancel = useMutation({
    mutationFn: (id: number) => api.post(`/ipos/applications/${id}/cancel`),
    onMutate: () => markLocalAction('IPO'),
    onSuccess: () => {
      toast.success('Application cancelled', { description: 'Blocked funds have been released.' });
      setCancelling(null);
      void queryClient.invalidateQueries({ queryKey: ['ipos'] });
      void queryClient.invalidateQueries({ queryKey: ['funds'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (isPending) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (data.applications.length === 0) return <EmptyState icon={<Rocket className="size-6" />} title="No IPO applications yet" description="Applications you submit and their allotment results appear here." />;
  return (
    <>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>IPO</Th>
              <Th align="right">Bid</Th>
              <Th align="right">Amount</Th>
              <Th>Status</Th>
              <Th align="right" className="hidden md:table-cell">Allotted</Th>
              <Th align="right" className="hidden lg:table-cell">Debited / released</Th>
              <Th align="right"><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody>
            {data.applications.map((app) => (
              <Tr key={app.id}>
                <Td>
                  <Link to={`/ipo/${app.ipoId}`} className="font-semibold hover:text-primary">{app.companyName}</Link>
                  <p className="text-xs text-muted">{app.applicationNo} · {formatDate(app.createdAt)}</p>
                </Td>
                <Td align="right">
                  {app.lots} lot{app.lots === 1 ? '' : 's'} · {formatNumber(app.quantity)} sh
                  <p className="text-xs text-muted">{app.isCutoff ? 'Cut-off' : formatINR(app.bidPrice, { decimals: 0 })}</p>
                </Td>
                <Td align="right">{formatINR(app.amount, { decimals: 0 })}</Td>
                <Td>
                  <ApplicationStatusBadge status={app.status} />
                  {app.status === 'APPLIED' && <p className="mt-1 text-xs text-muted">Allotment on {formatShortDate(app.allotmentDate)}</p>}
                  {app.status === 'ALLOTTED' && <p className="mt-1 text-xs text-muted">{app.sharesCreditedAt ? 'Shares credited' : `Credit on ${formatShortDate(app.listingDate)}`}</p>}
                  {app.statusReason && app.status !== 'APPLIED' && <p className="mt-1 max-w-56 text-xs text-muted">{app.statusReason}</p>}
                </Td>
                <Td align="right" className="hidden md:table-cell">{app.allottedQuantity ? formatNumber(app.allottedQuantity) : '—'}</Td>
                <Td align="right" className="hidden lg:table-cell text-muted">
                  {app.status === 'APPLIED' ? 'Blocked' : `${formatINR(app.amountDebited, { decimals: 0 })} / ${formatINR(app.amountRefunded, { decimals: 0 })}`}
                </Td>
                <Td align="right">
                  {app.status === 'APPLIED' && app.ipoStatus === 'OPEN' && (
                    <button type="button" className="rounded-md px-2 py-1 text-xs font-medium text-loss hover:bg-loss-soft" onClick={() => setCancelling(app)}>Cancel</button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Cancel this application?"
        description={cancelling && `Your bid for ${cancelling.companyName} will be withdrawn and ${formatINR(cancelling.amount, { decimals: 0 })} released. You can apply again while the IPO is open.`}
        confirmLabel="Cancel application"
        variant="danger"
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
        onClose={() => setCancelling(null)}
      />
    </>
  );
}

export default function IposPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'open';
  const { data, isPending, error, refetch } = useQuery({ queryKey: keys.ipos('all'), queryFn: () => api.get<{ ipos: Ipo[] }>('/ipos?status=all'), refetchInterval: 30_000 });
  const groups = {
    open: data?.ipos.filter((i) => i.status === 'OPEN') ?? [],
    upcoming: data?.ipos.filter((i) => i.status === 'UPCOMING') ?? [],
    closed: [...(data?.ipos.filter((i) => ['CLOSED', 'ALLOTTED', 'LISTED', 'WITHDRAWN'].includes(i.status)) ?? [])].reverse(),
  };
  const applied = data?.ipos.filter((i) => i.myApplication).length;

  return (
    <div>
      <PageHeader title="IPOs" description="Apply for new issues, follow subscription and check allotment." />
      <Card>
        <Tabs
          className="px-2"
          value={tab}
          onChange={(value) => setParams({ tab: value }, { replace: true })}
          items={[
            { value: 'open', label: 'Open', count: groups.open.length },
            { value: 'upcoming', label: 'Upcoming', count: groups.upcoming.length },
            { value: 'closed', label: 'Closed & listed', count: groups.closed.length },
            { value: 'applications', label: 'My applications', count: applied },
          ]}
        />
        {tab === 'applications' ? (
          <Applications />
        ) : isPending ? (
          <PageLoader />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : groups[tab].length === 0 ? (
          <EmptyState icon={<Rocket className="size-6" />} title={tab === 'open' ? 'No IPOs are open right now' : tab === 'upcoming' ? 'No upcoming IPOs announced' : 'No completed IPOs'} />
        ) : (
          <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
            {groups[tab].map((ipo) => <IpoCard key={ipo.id} ipo={ipo} />)}
          </div>
        )}
      </Card>
      {tab !== 'applications' && <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><Badge>Info</Badge> Retail investors can bid up to ₹2,00,000 per IPO. Funds are blocked when you apply and released if you are not allotted.</p>}
    </div>
  );
}
