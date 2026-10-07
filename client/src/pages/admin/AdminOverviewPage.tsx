import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, ClipboardList, Rocket, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { BreadthBar } from '@/components/market/MarketWidgets';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/Card';
import { ErrorState, PageHeader } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { actionLabel, detailSummary } from '@/lib/activity';
import { api } from '@/lib/api';
import { formatCompact, formatINR, formatNumber, formatShortDate, relativeTime } from '@/lib/format';
import type { AdminOverview } from '@/lib/types';

function ActivityChart({ daily }: { daily: AdminOverview['daily'] }) {
  const maxTurnover = Math.max(1, ...daily.map((d) => d.turnover));
  return (
    <div>
      <div className="flex h-44 items-end gap-1.5">
        {daily.map((day) => (
          <div key={day.date} className="group relative flex h-full flex-1 flex-col items-center justify-end">
            <div className="w-full rounded-t bg-primary/75 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(2, (day.turnover / maxTurnover) * 100)}%` }} />
            <div className="pointer-events-none absolute bottom-full mb-1 hidden whitespace-nowrap rounded-md bg-fg px-2 py-1 text-[11px] text-bg group-hover:block">
              {formatShortDate(day.date)}: {day.trades} trades · ₹{formatCompact(day.turnover)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>{formatShortDate(daily[0]?.date)}</span>
        <span>{formatShortDate(daily[daily.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

export default function AdminOverviewPage() {
  const { data, isPending, error, refetch } = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<AdminOverview>('/admin/overview'), refetchInterval: 30_000 });
  if (isPending) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const totalTrades = data.daily.reduce((s, d) => s + d.trades, 0);
  const totalTurnover = data.daily.reduce((s, d) => s + d.turnover, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Admin overview" description="Platform health, activity and money at a glance." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Users" icon={<Users className="size-4" />} value={formatNumber(data.users.total)} sub={<span className="text-muted">{data.users.active} active · {data.users.suspended} suspended · {data.users.newThisWeek} new this week</span>} />
        <Stat label="Active sessions" icon={<Activity className="size-4" />} value={formatNumber(data.sessions.active)} sub={<span className="text-muted">{data.users.admins} administrator{data.users.admins === 1 ? '' : 's'}</span>} />
        <Stat label="Orders today" icon={<ClipboardList className="size-4" />} value={formatNumber(data.orders.today)} sub={<span className="text-muted">{data.orders.executedToday} executed · {data.orders.rejectedToday} rejected · {data.orders.open} open</span>} />
        <Stat label="Turnover today" value={formatINR(data.trading.turnoverToday, { decimals: 0 })} sub={<span className="text-muted">{data.trading.tradesToday} trades · charges {formatINR(data.trading.chargesToday)}</span>} />
        <Stat label="Client cash" icon={<Wallet className="size-4" />} value={formatINR(data.funds.totalCash, { decimals: 0 })} sub={<span className="text-muted">Blocked {formatINR(data.funds.blockedForOrders + data.funds.blockedForIpos, { decimals: 0 })}</span>} />
        <Stat label="Client holdings" value={formatINR(data.funds.holdingsValue, { decimals: 0 })} sub={<span className="text-muted">At live market prices</span>} />
        <Stat label="Money in / out today" value={<span><span className="text-gain">+{formatINR(data.funds.depositsToday, { decimals: 0 })}</span></span>} sub={<span className="text-loss">−{formatINR(data.funds.withdrawalsToday, { decimals: 0 })} withdrawn</span>} />
        <Stat label="IPOs" icon={<Rocket className="size-4" />} value={`${data.ipos.open} open`} sub={<span className="text-muted">{data.ipos.upcoming} upcoming · {data.ipos.awaitingAllotment} awaiting allotment · {data.ipos.pendingApplications} pending bids</span>} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Trading activity" subtitle={`Last 14 days · ${formatNumber(totalTrades)} trades · ₹${formatCompact(totalTurnover)} turnover · ₹${formatCompact(data.trading.chargesTotal)} lifetime charges`} />
          <CardBody>
            <ActivityChart daily={data.daily} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Market" subtitle={data.market.status.session} />
          <CardBody className="flex flex-col gap-4">
            <BreadthBar breadth={data.market.breadth} />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Link to="/admin/securities" className="rounded-lg border border-border p-3 hover:border-primary/40">Manage securities</Link>
              <Link to="/admin/ipos" className="rounded-lg border border-border p-3 hover:border-primary/40">Manage IPOs</Link>
              <Link to="/admin/settings" className="rounded-lg border border-border p-3 hover:border-primary/40">Charges & limits</Link>
              <Link to="/admin/settings#announcement" className="rounded-lg border border-border p-3 hover:border-primary/40">Send announcement</Link>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent activity" action={<Link to="/admin/audit" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">Audit trail <ArrowRight className="size-3" /></Link>} />
        <ul className="divide-y divide-border">
          {data.recentActivity.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
              <span className="min-w-0">
                <span className="font-medium">{actionLabel(entry.action)}</span>
                <span className="text-muted"> · {entry.actorRole === 'SYSTEM' ? 'System' : (entry.actorName ?? 'Anonymous')}{entry.subjectName && entry.subjectName !== entry.actorName ? ` → ${entry.subjectName}` : ''}</span>
                {detailSummary(entry.details) && <span className="block truncate text-xs text-muted">{detailSummary(entry.details)}</span>}
              </span>
              <span className="text-xs text-muted">{relativeTime(entry.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
