import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState, PageHeader, Pagination } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { api, qs } from '@/lib/api';
import { formatDate, formatINR, relativeTime } from '@/lib/format';
import type { AdminUser, Page } from '@/lib/types';

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', status: '', role: '', page: 1 });
  const set = (changes: Partial<typeof filters>) => setFilters((f) => ({ ...f, page: 1, ...changes }));
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['admin', 'users', filters],
    queryFn: () => api.get<Page<AdminUser>>(`/admin/users${qs({ ...filters, pageSize: 20 })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader title="Users" description="Search accounts, review activity and take action." />
      <Card>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3">
          <Input aria-label="Search users" placeholder="Name, email or phone" prefix={<Search className="size-4" />} value={filters.q} onChange={(e) => set({ q: e.target.value })} />
          <Select aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
          <Select aria-label="Role" value={filters.role} onChange={(e) => set({ role: e.target.value })}>
            <option value="">All roles</option>
            <option value="USER">Investors</option>
            <option value="ADMIN">Administrators</option>
          </Select>
        </div>
        {isPending ? (
          <PageLoader />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data.items.length === 0 ? (
          <EmptyState title="No users found" />
        ) : (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>User</Th>
                    <Th className="hidden md:table-cell">Phone</Th>
                    <Th>Status</Th>
                    <Th align="right">Cash</Th>
                    <Th align="right" className="hidden lg:table-cell">Holdings</Th>
                    <Th align="right" className="hidden lg:table-cell">Orders</Th>
                    <Th align="right" className="hidden md:table-cell">Last login</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((user) => (
                    <Tr key={user.id} className="cursor-pointer" onClick={() => navigate(`/admin/users/${user.id}`)}>
                      <Td>
                        <p className="font-medium">{user.fullName} {user.role === 'ADMIN' && <Badge tone="primary" className="ml-1">Admin</Badge>}</p>
                        <p className="text-xs text-muted">{user.email} · joined {formatDate(user.createdAt)}</p>
                      </Td>
                      <Td className="hidden text-muted md:table-cell">{user.phone ?? '—'}</Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={user.status === 'ACTIVE' ? 'success' : 'danger'}>{user.status === 'ACTIVE' ? 'Active' : 'Suspended'}</Badge>
                          {user.locked && <Badge tone="warning">Locked</Badge>}
                          {!user.hasPin && <Badge>No PIN</Badge>}
                        </span>
                      </Td>
                      <Td align="right">{formatINR(user.cashBalance)}</Td>
                      <Td align="right" className="hidden lg:table-cell">{user.holdingsCount}</Td>
                      <Td align="right" className="hidden lg:table-cell">{user.ordersCount}</Td>
                      <Td align="right" className="hidden text-xs text-muted md:table-cell">{user.lastLoginAt ? relativeTime(user.lastLoginAt) : 'Never'}</Td>
                    </Tr>
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
