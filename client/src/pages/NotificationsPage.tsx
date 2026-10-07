import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, PageHeader, Pagination, Switch } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { api, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, relativeTime } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { NotificationCategory, NotificationsPage as NotificationsResponse } from '@/lib/types';
import { categoryIcon, categoryLabel } from './notificationMeta';

const CATEGORIES: (NotificationCategory | 'ALL')[] = ['ALL', 'ORDER', 'IPO', 'PRICE_ALERT', 'FUNDS', 'SECURITY', 'SYSTEM'];

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [category, setCategory] = useState<NotificationCategory | 'ALL'>('ALL');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const params = { category: category === 'ALL' ? undefined : category, unread: unreadOnly ? 'true' : undefined, page, pageSize: 20 };
  const { data, isPending, error, refetch } = useQuery({
    queryKey: keys.notifications(params),
    queryFn: () => api.get<NotificationsResponse>(`/notifications${qs(params)}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: (id: number) => api.post(`/notifications/${id}/read`), onSuccess: refresh });
  const markAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/notifications/${id}`), onSuccess: refresh });

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Order executions, IPO updates, price alerts, fund movements and security events."
        actions={
          <>
            <ButtonLink to="/profile?tab=notifications" size="sm" icon={<Settings2 className="size-4" />}>Preferences</ButtonLink>
            <Button size="sm" variant="secondary" icon={<CheckCheck className="size-4" />} disabled={!data?.unreadCount} loading={markAll.isPending} onClick={() => markAll.mutate()}>
              Mark all read
            </Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 pr-4">
          <Tabs
            className="flex-1 px-2"
            value={category}
            onChange={(value) => { setCategory(value); setPage(1); }}
            items={CATEGORIES.map((c) => ({ value: c, label: c === 'ALL' ? 'All' : categoryLabel[c] }))}
          />
          <label className="flex items-center gap-2 py-2 text-sm text-muted">
            <Switch checked={unreadOnly} onChange={(v) => { setUnreadOnly(v); setPage(1); }} label="Unread only" /> Unread only
          </label>
        </div>
        {isPending ? (
          <PageLoader />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data.items.length === 0 ? (
          <EmptyState title="Nothing here" description={unreadOnly ? "You've read everything." : 'Notifications will appear as things happen in your account.'} />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {data.items.map((n) => {
                const Icon = categoryIcon[n.category];
                return (
                  <li key={n.id} className={cn('group flex gap-3 px-4 py-3.5 sm:px-5', !n.isRead && 'bg-primary-soft/40')}>
                    <span className="mt-0.5 h-fit rounded-lg bg-surface-2 p-2 text-muted"><Icon className="size-4" /></span>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        if (!n.isRead) markRead.mutate(n.id);
                        if (n.link) navigate(n.link);
                      }}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{n.title}</span>
                        {!n.isRead && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted">{n.message}</span>
                      <span className="mt-1 block text-xs text-subtle" title={formatDateTime(n.createdAt)}>{categoryLabel[n.category]} · {relativeTime(n.createdAt)}</span>
                    </button>
                    <button type="button" aria-label="Delete notification" className="h-fit rounded-md p-1.5 text-subtle opacity-0 hover:bg-loss-soft hover:text-loss group-hover:opacity-100 focus:opacity-100" onClick={() => remove.mutate(n.id)}>
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
