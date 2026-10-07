import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Menu } from '@/components/ui/Misc';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { keys } from '@/lib/queryClient';
import type { NotificationsPage } from '@/lib/types';
import { categoryIcon } from '@/pages/notificationMeta';

export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: count } = useQuery({
    queryKey: keys.unreadCount,
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });
  const { data: recent } = useQuery({
    queryKey: keys.notifications({ preview: true }),
    queryFn: () => api.get<NotificationsPage>('/notifications?pageSize=6'),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = count?.count ?? 0;

  return (
    <Menu
      className="w-[22rem] max-w-[calc(100vw-2rem)]"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="relative rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="num absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-loss px-1 text-[10px] font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => markAll.mutate()} className="text-xs font-medium text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(recent?.items ?? []).length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</li>}
            {recent?.items.map((n) => {
              const Icon = categoryIcon[n.category];
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      if (!n.isRead) void api.post(`/notifications/${n.id}/read`).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }));
                      navigate(n.link ?? '/notifications');
                    }}
                    className={cn('flex w-full gap-3 px-3 py-2.5 text-left hover:bg-surface-2', !n.isRead && 'bg-primary-soft/40')}
                  >
                    <span className="mt-0.5 rounded-lg bg-surface-2 p-1.5 text-muted">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-fg">{n.title}</span>
                        {!n.isRead && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                      </span>
                      <span className="line-clamp-2 text-xs text-muted">{n.message}</span>
                      <span className="text-[11px] text-subtle">{relativeTime(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              close();
              navigate('/notifications');
            }}
            className="w-full border-t border-border px-3 py-2 text-center text-xs font-medium text-primary hover:bg-surface-2"
          >
            View all notifications
          </button>
        </div>
      )}
    </Menu>
  );
}
