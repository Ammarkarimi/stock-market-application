import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import type { Notification } from '@/lib/types';
import { isRecentLocalAction } from './localActions';
import { applyTicks, setStreamConnected, type TickTuple } from './priceStore';

/** Opens the Server-Sent Events stream while signed in and routes events to caches and toasts. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { user, endSession } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    const source = new EventSource('/api/stream');
    const invalidate = (...queryKeys: readonly unknown[][]) => {
      for (const queryKey of queryKeys) void queryClient.invalidateQueries({ queryKey });
    };
    const on = (event: string, handler: (data: unknown) => void) =>
      source.addEventListener(event, (e) => handler(JSON.parse((e as MessageEvent<string>).data)));

    source.onopen = () => setStreamConnected(true);
    source.onerror = () => {
      setStreamConnected(false);
      // The browser retries automatically; if the session is gone, stop and sign out.
      api.get('/auth/me').catch(() => source.close());
    };

    on('snapshot', (data) => applyTicks((data as { quotes: TickTuple[] }).quotes));
    on('prices', (data) => applyTicks(data as TickTuple[]));
    on('notification', (data) => {
      const notification = data as Notification;
      invalidate(['notifications']);
      if (isRecentLocalAction(notification.category)) return;
      const show = notification.category === 'PRICE_ALERT' || notification.category === 'SECURITY' ? toast.warning : toast.info;
      show(notification.title, {
        description: notification.message,
        action: notification.link ? { label: 'View', onClick: () => navigate(notification.link!) } : undefined,
      });
    });
    on('order', () => invalidate(['orders'], ['trades'], ['portfolio'], ['funds'], ['statement'], ['securities', 'detail']));
    on('portfolio', () => invalidate(['portfolio'], ['securities', 'detail']));
    on('funds', () => invalidate(['funds'], ['statement']));
    on('ipo', () => invalidate(['ipos']));
    on('alert', () => invalidate(['alerts'], ['securities', 'detail']));
    on('watchlist', () => invalidate(['watchlists']));
    on('market-rollover', () => invalidate(['market'], ['securities'], ['portfolio']));
    on('session-revoked', () => {
      source.close();
      endSession('This session was signed out from another device or by an administrator.');
    });

    return () => {
      source.close();
      setStreamConnected(false);
    };
  }, [user?.id, queryClient, navigate, endSession]);

  return <>{children}</>;
}
