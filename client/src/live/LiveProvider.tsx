import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { api, ApiError, qs } from '@/lib/api';
import type { Notification } from '@/lib/types';
import { isRecentLocalAction } from './localActions';
import { applyTicks, setStreamConnected, type TickTuple } from './priceStore';

const POLL_MS = 5_000;

interface LiveUpdate {
  tradingDate: string;
  quotes: TickTuple[];
  notifications: Notification[];
  latestNotificationId: number;
  events: Record<string, number>;
  eventVersion: number;
}

/** Polls /api/live while signed in and routes prices, notifications and changes to caches and toasts. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let inFlight = false;
    let cursor: { notificationsAfter: number; eventsAfter: number; tradingDate: string } | null = null;

    const invalidate = (...queryKeys: readonly unknown[][]) => {
      for (const queryKey of queryKeys) void queryClient.invalidateQueries({ queryKey });
    };
    const handlers: Record<string, () => void> = {
      order: () =>
        invalidate(['orders'], ['trades'], ['portfolio'], ['funds'], ['statement'], ['securities', 'detail']),
      portfolio: () => invalidate(['portfolio'], ['securities', 'detail']),
      funds: () => invalidate(['funds'], ['statement']),
      ipo: () => invalidate(['ipos']),
      alert: () => invalidate(['alerts'], ['securities', 'detail']),
      watchlist: () => invalidate(['watchlists']),
    };

    const show = (notification: Notification) => {
      if (isRecentLocalAction(notification.category)) return;
      const toastFn =
        notification.category === 'PRICE_ALERT' || notification.category === 'SECURITY'
          ? toast.warning
          : toast.info;
      toastFn(notification.title, {
        description: notification.message,
        action: notification.link
          ? { label: 'View', onClick: () => navigate(notification.link!) }
          : undefined,
      });
    };

    const apply = (update: LiveUpdate) => {
      applyTicks(update.quotes);
      if (cursor) {
        if (update.notifications.length > 0) {
          invalidate(['notifications']);
          update.notifications.forEach(show);
        }
        for (const type of Object.keys(update.events)) handlers[type]?.();
        if (update.tradingDate !== cursor.tradingDate) invalidate(['market'], ['securities'], ['portfolio']);
      }
      cursor = {
        notificationsAfter: update.latestNotificationId,
        eventsAfter: Math.max(update.eventVersion, ...Object.values(update.events)),
        tradingDate: update.tradingDate,
      };
    };

    const poll = async () => {
      timer = undefined;
      inFlight = true;
      controller = new AbortController();
      try {
        const query = cursor
          ? qs({ notificationsAfter: cursor.notificationsAfter, eventsAfter: cursor.eventsAfter })
          : '';
        apply(await api.get<LiveUpdate>(`/live${query}`, controller.signal));
        setStreamConnected(true);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setStreamConnected(false);
        // A 401 has already signed the user out (see onUnauthorized in the auth provider).
        if (err instanceof ApiError && err.status === 401) return;
      } finally {
        inFlight = false;
      }
      schedule();
    };

    // A hidden tab stops polling, so an idle tab lets the server and database sleep.
    const schedule = (delay = POLL_MS) => {
      if (stopped || document.hidden) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void poll(), delay);
    };

    // Coming back to the tab catches up straight away.
    const onVisibility = () => {
      if (!document.hidden && !inFlight && !timer) schedule(0);
    };
    document.addEventListener('visibilitychange', onVisibility);
    void poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      setStreamConnected(false);
    };
  }, [user?.id, queryClient, navigate]);

  return <>{children}</>;
}
