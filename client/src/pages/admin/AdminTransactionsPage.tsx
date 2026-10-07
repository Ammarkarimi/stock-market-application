import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, PageHeader, Pagination } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatINR, titleCase } from '@/lib/format';
import type { FundTransaction, LedgerEntry, Page } from '@/lib/types';

function Ledger() {
  const [filters, setFilters] = useState({ type: '', userId: '', from: '', to: '', page: 1 });
  const set = (changes: Partial<typeof filters>) => setFilters((f) => ({ ...f, page: 1, ...changes }));
  const query = { ...filters, pageSize: 25 };
  const { data } = useQuery({ queryKey: ['admin', 'ledger', query], queryFn: () => api.get<Page<LedgerEntry>>(`/admin/ledger${qs(query)}`), placeholderData: keepPreviousData });
  return (
    <>
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select aria-label="Entry type" value={filters.type} onChange={(e) => set({ type: e.target.value })}>
          <option value="">All entry types</option>
          {['DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL', 'CHARGES', 'IPO_ALLOTMENT', 'ADJUSTMENT'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </Select>
        <Input aria-label="User ID" placeholder="User ID" value={filters.userId} onChange={(e) => set({ userId: e.target.value.replace(/\D/g, '') })} />
        <Input aria-label="From" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        <Input aria-label="To" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
      </div>
      {!data ? <PageLoader /> : data.items.length === 0 ? <EmptyState title="No ledger entries" /> : (
        <>
          <TableWrap>
            <Table>
              <thead><tr><Th>Date</Th><Th>Investor</Th><Th>Description</Th><Th className="hidden md:table-cell">Type</Th><Th align="right">Amount</Th><Th align="right" className="hidden lg:table-cell">Balance</Th></tr></thead>
              <tbody>
                {data.items.map((entry) => (
                  <Tr key={entry.id}>
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(entry.createdAt)}</Td>
                    <Td><Link to={`/admin/users/${entry.userId}`} className="hover:text-primary">{entry.userName}</Link></Td>
                    <Td className="max-w-sm">{entry.description}</Td>
                    <Td className="hidden md:table-cell"><Badge>{titleCase(entry.type)}</Badge></Td>
                    <Td align="right" className={cn('font-medium', entry.amount > 0 ? 'text-gain' : 'text-loss')}>{formatINR(entry.amount, { sign: true })}</Td>
                    <Td align="right" className="hidden lg:table-cell">{formatINR(entry.balanceAfter)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => setFilters((f) => ({ ...f, page }))} />
        </>
      )}
    </>
  );
}

function FundTransactions() {
  const [filters, setFilters] = useState({ type: '', userId: '', page: 1 });
  const query = { ...filters, pageSize: 25 };
  const { data } = useQuery({ queryKey: ['admin', 'fund-transactions', query], queryFn: () => api.get<Page<FundTransaction>>(`/admin/fund-transactions${qs(query)}`), placeholderData: keepPreviousData });
  return (
    <>
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3">
        <Select aria-label="Type" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value, page: 1 })}>
          <option value="">Deposits & withdrawals</option>
          <option value="DEPOSIT">Deposits</option>
          <option value="WITHDRAWAL">Withdrawals</option>
        </Select>
        <Input aria-label="User ID" placeholder="User ID" value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value.replace(/\D/g, ''), page: 1 })} />
      </div>
      {!data ? <PageLoader /> : data.items.length === 0 ? <EmptyState title="No fund transactions" /> : (
        <>
          <TableWrap>
            <Table>
              <thead><tr><Th>Date</Th><Th>Investor</Th><Th>Type</Th><Th className="hidden md:table-cell">Method</Th><Th className="hidden lg:table-cell">Reference</Th><Th align="right">Amount</Th></tr></thead>
              <tbody>
                {data.items.map((txn) => (
                  <Tr key={txn.id}>
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(txn.createdAt)}</Td>
                    <Td><Link to={`/admin/users/${txn.userId}`} className="hover:text-primary">{txn.userName}</Link><p className="text-xs text-muted">{txn.userEmail}</p></Td>
                    <Td><Badge tone={txn.type === 'DEPOSIT' ? 'success' : 'warning'}>{titleCase(txn.type)}</Badge></Td>
                    <Td className="hidden text-muted md:table-cell">{titleCase(txn.method)}{txn.bankAccount ? ` · ${txn.bankAccount}` : ''}</Td>
                    <Td className="hidden font-mono text-xs text-muted lg:table-cell">{txn.reference}</Td>
                    <Td align="right" className="font-medium">{formatINR(txn.amount)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(page) => setFilters((f) => ({ ...f, page }))} />
        </>
      )}
    </>
  );
}

export default function AdminTransactionsPage() {
  const [tab, setTab] = useState<'ledger' | 'funds'>('ledger');
  return (
    <div>
      <PageHeader title="Transactions" description="Platform-wide ledger and money movements." />
      <Card>
        <Tabs className="px-2" value={tab} onChange={setTab} items={[{ value: 'ledger', label: 'Ledger' }, { value: 'funds', label: 'Deposits & withdrawals' }]} />
        {tab === 'ledger' ? <Ledger /> : <FundTransactions />}
      </Card>
    </div>
  );
}
