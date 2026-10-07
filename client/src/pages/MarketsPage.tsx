import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BreadthBar, IndexCard, MoversTable, SectorHeatmap } from '@/components/market/MarketWidgets';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorState, PageHeader } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { api } from '@/lib/api';
import { formatDate, formatPercent } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { MarketOverview, SecurityListItem } from '@/lib/types';

type MoverKind = 'gainers' | 'losers' | 'active' | 'value';

export default function MarketsPage() {
  const [kind, setKind] = useState<MoverKind>('gainers');
  const overview = useQuery({ queryKey: keys.marketOverview, queryFn: () => api.get<MarketOverview>('/market/overview'), refetchInterval: 30_000 });
  const movers = useQuery({
    queryKey: keys.movers(kind, 15),
    queryFn: () => api.get<{ items: SecurityListItem[] }>(`/market/movers?kind=${kind}&limit=15`),
    refetchInterval: 15_000,
  });

  if (overview.isPending) return <PageLoader />;
  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const data = overview.data;
  const best = data.sectors[0];
  const worst = data.sectors[data.sectors.length - 1];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Markets" description={`${formatDate(data.status.tradingDate)} · ${data.status.session}`} />

      <section aria-label="Indices" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.indices.map((index) => (
          <IndexCard key={index.symbol} index={index} />
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Top movers" subtitle="Stocks ranked by today's move and trading activity" />
          <Tabs
            className="px-2"
            value={kind}
            onChange={setKind}
            items={[
              { value: 'gainers', label: 'Top gainers' },
              { value: 'losers', label: 'Top losers' },
              { value: 'active', label: 'Most active (volume)' },
              { value: 'value', label: 'Most active (value)' },
            ]}
          />
          {movers.data ? (
            <MoversTable items={movers.data.items} metric={kind === 'active' ? 'volume' : kind === 'value' ? 'value' : 'change'} />
          ) : (
            <PageLoader />
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Market breadth" subtitle="Advancing vs declining securities" />
            <CardBody>
              <BreadthBar breadth={data.breadth} />
              <p className="mt-4 text-sm text-muted">
                {data.breadth.advances >= data.breadth.declines ? 'Buyers have the upper hand today' : 'Sellers are in control today'} with an advance/decline ratio of{' '}
                <span className="num font-semibold text-fg">{(data.breadth.advances / Math.max(1, data.breadth.declines)).toFixed(2)}</span>.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Trends" />
            <CardBody className="flex flex-col gap-3 text-sm">
              {best && (
                <p>
                  <span className="text-muted">Strongest sector:</span> <span className="font-semibold">{best.sector}</span>{' '}
                  <span className="num text-gain">{formatPercent(best.changePercent)}</span>
                  {best.topGainer && <span className="text-muted"> led by {best.topGainer}</span>}
                </p>
              )}
              {worst && worst !== best && (
                <p>
                  <span className="text-muted">Weakest sector:</span> <span className="font-semibold">{worst.sector}</span>{' '}
                  <span className={worst.changePercent < 0 ? 'num text-loss' : 'num text-gain'}>{formatPercent(worst.changePercent)}</span>
                  {worst.topLoser && <span className="text-muted"> dragged by {worst.topLoser}</span>}
                </p>
              )}
              {data.gainers[0] && (
                <p>
                  <span className="text-muted">Top gainer:</span> <span className="font-semibold">{data.gainers[0].symbol}</span>{' '}
                  <span className="num text-gain">{formatPercent(data.gainers[0].changePercent)}</span>
                </p>
              )}
              {data.losers[0] && (
                <p>
                  <span className="text-muted">Top loser:</span> <span className="font-semibold">{data.losers[0].symbol}</span>{' '}
                  <span className="num text-loss">{formatPercent(data.losers[0].changePercent)}</span>
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Sector performance" subtitle="Market-cap weighted change by sector" />
        <CardBody>
          <SectorHeatmap sectors={data.sectors} />
        </CardBody>
      </Card>
    </div>
  );
}
