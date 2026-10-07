import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { LiveChange, LivePrice } from '@/components/market/LivePrice';
import { useTrade } from '@/components/trade/TradeProvider';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState, PageHeader, Pagination } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, qs, symbolPath } from '@/lib/api';
import { formatCompact, formatCrores } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { Page, SecurityListItem } from '@/lib/types';

const TYPES = [
  { value: '', label: 'All types' },
  { value: 'STOCK', label: 'Stocks' },
  { value: 'ETF', label: 'ETFs' },
  { value: 'REIT', label: 'REITs' },
  { value: 'INVIT', label: 'InvITs' },
  { value: 'INDEX', label: 'Indices' },
];

const SORTS = [
  { value: 'marketCap:desc', label: 'Market cap (high to low)' },
  { value: 'changePercent:desc', label: 'Change % (high to low)' },
  { value: 'changePercent:asc', label: 'Change % (low to high)' },
  { value: 'volume:desc', label: 'Volume (high to low)' },
  { value: 'price:desc', label: 'Price (high to low)' },
  { value: 'price:asc', label: 'Price (low to high)' },
  { value: 'symbol:asc', label: 'Symbol (A–Z)' },
];

export default function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { openOrder } = useTrade();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const sector = params.get('sector') ?? '';
  const sortValue = params.get('sort') ?? (q ? '' : 'marketCap:desc');
  const page = Number(params.get('page') ?? 1);
  const [sort, order] = sortValue ? sortValue.split(':') : [undefined, undefined];

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const { data: sectors } = useQuery({ queryKey: ['securities', 'sectors'], queryFn: () => api.get<{ sectors: string[] }>('/securities/sectors'), staleTime: Infinity });
  const query = { q, type, sector, sort, order, page, pageSize: 25 };
  const list = useQuery({
    queryKey: keys.securities(query),
    queryFn: () => api.get<Page<SecurityListItem>>(`/securities${qs(query)}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader title="Explore" description="Search and filter stocks, ETFs, REITs, InvITs and indices." />
      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input aria-label="Search" placeholder="Symbol or company name" prefix={<Search className="size-4" />} defaultValue={q} onChange={(e) => update({ q: e.target.value.trim() })} />
          <Select aria-label="Security type" value={type} onChange={(e) => update({ type: e.target.value, sector: e.target.value && e.target.value !== 'STOCK' ? '' : sector })}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Sector" value={sector} onChange={(e) => update({ sector: e.target.value })} disabled={Boolean(type) && type !== 'STOCK'}>
            <option value="">All sectors</option>
            {sectors?.sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select aria-label="Sort by" value={sortValue} onChange={(e) => update({ sort: e.target.value })}>
            {q && <option value="">Best match</option>}
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        {list.isPending ? (
          <PageLoader />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState title="No matching securities" description="Try a different name, symbol or filter." />
        ) : (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Security</Th>
                    <Th className="hidden md:table-cell">Sector</Th>
                    <Th align="right">Price</Th>
                    <Th align="right">Change</Th>
                    <Th align="right" className="hidden sm:table-cell">Volume</Th>
                    <Th align="right" className="hidden lg:table-cell">Market cap</Th>
                    <Th align="right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((item) => (
                    <Tr key={item.symbol} className="cursor-pointer" onClick={() => navigate(`/stocks/${symbolPath(item.symbol)}`)}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Link to={`/stocks/${symbolPath(item.symbol)}`} className="font-semibold hover:text-primary" onClick={(e) => e.stopPropagation()}>{item.symbol}</Link>
                          {item.type !== 'STOCK' && <Badge tone={item.type === 'INDEX' ? 'info' : 'primary'}>{item.type}</Badge>}
                          {item.tradingStatus === 'HALTED' && <Badge tone="warning">Halted</Badge>}
                        </div>
                        <p className="max-w-64 truncate text-xs text-muted">{item.name}</p>
                      </Td>
                      <Td className="hidden text-muted md:table-cell">{item.sector}</Td>
                      <Td align="right">
                        <LivePrice symbol={item.symbol} fallback={item.lastPrice} />
                      </Td>
                      <Td align="right">
                        <LiveChange symbol={item.symbol} change={item.change} percent={item.changePercent} showAbsolute={false} className="font-medium" />
                      </Td>
                      <Td align="right" className="hidden text-muted sm:table-cell">{item.volume ? formatCompact(item.volume) : '—'}</Td>
                      <Td align="right" className="hidden text-muted lg:table-cell">{formatCrores(item.marketCapCr)}</Td>
                      <Td align="right">
                        {item.isTradable && (
                          <span className="inline-flex gap-1">
                            <button type="button" className="rounded-md bg-gain-soft px-2 py-1 text-xs font-semibold text-gain hover:opacity-80" onClick={(e) => { e.stopPropagation(); openOrder({ symbol: item.symbol, side: 'BUY' }); }}>
                              Buy
                            </button>
                            <button type="button" className="rounded-md bg-loss-soft px-2 py-1 text-xs font-semibold text-loss hover:opacity-80" onClick={(e) => { e.stopPropagation(); openOrder({ symbol: item.symbol, side: 'SELL' }); }}>
                              Sell
                            </button>
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => update({ page: String(p) })} />
          </>
        )}
      </Card>
    </div>
  );
}
