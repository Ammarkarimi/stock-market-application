import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, PageHeader, Pagination } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { actionLabel, detailSummary } from '@/lib/activity';
import { api, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type { AuditLog, Page } from '@/lib/types';

interface Verification {
  valid: boolean;
  checked: number;
  brokenAtId: number | null;
  reason: string | null;
}

const ROLE_TONES = { USER: 'neutral', ADMIN: 'primary', SYSTEM: 'info', ANONYMOUS: 'warning' } as const;

export default function AdminAuditPage() {
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({ action: '', entityType: '', search: '', subjectUserId: params.get('subjectUserId') ?? '', from: '', to: '', page: 1 });
  const [expanded, setExpanded] = useState<number | null>(null);
  const set = (changes: Partial<typeof filters>) => setFilters((f) => ({ ...f, page: 1, ...changes }));
  const query = { ...filters, pageSize: 30 };
  const { data } = useQuery({ queryKey: ['admin', 'audit', query], queryFn: () => api.get<Page<AuditLog>>(`/admin/audit-logs${qs(query)}`), placeholderData: keepPreviousData });
  const { data: actions } = useQuery({ queryKey: ['admin', 'audit-actions'], queryFn: () => api.get<{ actions: string[] }>('/admin/audit-logs/actions') });
  const verify = useMutation({ mutationFn: () => api.get<Verification>('/admin/audit-logs/verify') });

  return (
    <div>
      <PageHeader
        title="Audit trail"
        description="Append-only, hash-chained record of every user, admin and system action."
        actions={<Button size="sm" variant="secondary" icon={<ShieldCheck className="size-4" />} loading={verify.isPending} onClick={() => verify.mutate()}>Verify integrity</Button>}
      />
      {verify.data && (
        <div className={cn('mb-4 flex items-start gap-3 rounded-xl border p-4 text-sm', verify.data.valid ? 'border-gain/30 bg-gain-soft' : 'border-loss/30 bg-loss-soft')} role="status">
          {verify.data.valid ? <ShieldCheck className="size-5 text-gain" /> : <ShieldAlert className="size-5 text-loss" />}
          <div>
            <p className="font-medium">{verify.data.valid ? 'Audit trail intact' : 'Integrity check failed'}</p>
            <p className="text-muted">
              {verify.data.valid
                ? `All ${verify.data.checked.toLocaleString('en-IN')} entries match their hashes and link to the previous entry.`
                : `Entry #${verify.data.brokenAtId}: ${verify.data.reason}. ${verify.data.checked} entries before it are intact.`}
            </p>
          </div>
        </div>
      )}
      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Input aria-label="Search" placeholder="Search details or IP" prefix={<Search className="size-4" />} value={filters.search} onChange={(e) => set({ search: e.target.value })} containerClassName="lg:col-span-2" />
          <Select aria-label="Action" value={filters.action} onChange={(e) => set({ action: e.target.value })}>
            <option value="">All actions</option>
            {actions?.actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </Select>
          <Select aria-label="Entity" value={filters.entityType} onChange={(e) => set({ entityType: e.target.value })}>
            <option value="">All entities</option>
            {['USER', 'SESSION', 'ORDER', 'FUND_TRANSACTION', 'LEDGER_ENTRY', 'IPO', 'IPO_APPLICATION', 'SECURITY', 'WATCHLIST', 'ALERT', 'SETTING', 'BANK_ACCOUNT'].map((e) => <option key={e} value={e}>{e.replaceAll('_', ' ').toLowerCase()}</option>)}
          </Select>
          <Input aria-label="From" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          <Input aria-label="To" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
        {filters.subjectUserId && (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
            Showing activity for user #{filters.subjectUserId}
            <button type="button" className="text-primary hover:underline" onClick={() => set({ subjectUserId: '' })}>Clear</button>
          </div>
        )}
        {!data ? <PageLoader /> : data.items.length === 0 ? <EmptyState title="No matching entries" /> : (
          <>
            <TableWrap>
              <Table>
                <thead><tr><Th>Time</Th><Th>Action</Th><Th>Actor</Th><Th className="hidden md:table-cell">Subject</Th><Th className="hidden lg:table-cell">Source</Th><Th align="right">Hash</Th></tr></thead>
                <tbody>
                  {data.items.map((entry) => (
                    <Fragment key={entry.id}>
                      <Tr className="cursor-pointer" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
                        <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(entry.createdAt)}</Td>
                        <Td>
                          <span className="flex items-center gap-1 font-medium"><ChevronDown className={cn('size-3.5 text-subtle transition-transform', expanded === entry.id && 'rotate-180')} />{actionLabel(entry.action)}</span>
                          {detailSummary(entry.details) && <p className="ml-4.5 max-w-72 truncate text-xs text-muted">{detailSummary(entry.details)}</p>}
                        </Td>
                        <Td>
                          <Badge tone={ROLE_TONES[entry.actorRole as keyof typeof ROLE_TONES] ?? 'neutral'}>{entry.actorRole}</Badge>
                          {entry.actorId && <Link to={`/admin/users/${entry.actorId}`} className="ml-2 text-sm hover:text-primary" onClick={(e) => e.stopPropagation()}>{entry.actorName}</Link>}
                        </Td>
                        <Td className="hidden md:table-cell">{entry.subjectUserId ? <Link to={`/admin/users/${entry.subjectUserId}`} className="hover:text-primary" onClick={(e) => e.stopPropagation()}>{entry.subjectName}</Link> : <span className="text-muted">—</span>}</Td>
                        <Td className="hidden text-xs text-muted lg:table-cell">{entry.ip ?? '—'}</Td>
                        <Td align="right" className="font-mono text-[11px] text-subtle">{entry.hash.slice(0, 10)}…</Td>
                      </Tr>
                      {expanded === entry.id && (
                        <tr>
                          <td colSpan={6} className="border-b border-border bg-surface-2/60 px-4 py-3">
                            <div className="grid gap-3 text-xs md:grid-cols-2">
                              <div>
                                <p className="mb-1 font-semibold text-muted">Details</p>
                                <pre className="max-h-64 overflow-auto rounded-lg bg-surface p-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(entry.details ?? {}, null, 2)}</pre>
                              </div>
                              <div className="flex flex-col gap-1.5 text-muted">
                                <p><span className="font-semibold">Entry</span> #{entry.id}{entry.entityType && ` · ${entry.entityType} ${entry.entityId ?? ''}`}</p>
                                <p><span className="font-semibold">User agent</span> {entry.userAgent ?? '—'}</p>
                                <p className="break-all"><span className="font-semibold">Hash</span> <span className="font-mono">{entry.hash}</span></p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => setFilters((f) => ({ ...f, page }))} />
          </>
        )}
      </Card>
    </div>
  );
}
