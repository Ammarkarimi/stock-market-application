import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status > 0 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

/** Query keys shared by pages and the live event stream. */
export const keys = {
  me: ['me'] as const,
  profile: ['profile'] as const,
  sessions: ['sessions'] as const,
  activity: (page: number) => ['activity', page] as const,
  marketOverview: ['market', 'overview'] as const,
  indices: ['market', 'indices'] as const,
  movers: (kind: string, limit: number) => ['market', 'movers', kind, limit] as const,
  sectors: ['market', 'sectors'] as const,
  securities: (params: object) => ['securities', 'list', params] as const,
  security: (symbol: string) => ['securities', 'detail', symbol] as const,
  history: (symbol: string, range: string) => ['securities', 'history', symbol, range] as const,
  constituents: (symbol: string) => ['securities', 'constituents', symbol] as const,
  search: (q: string) => ['securities', 'search', q] as const,
  portfolio: ['portfolio'] as const,
  performance: (range: string) => ['portfolio', 'performance', range] as const,
  orders: (params: object) => ['orders', params] as const,
  order: (id: number) => ['orders', 'detail', id] as const,
  trades: (params: object) => ['trades', params] as const,
  funds: ['funds'] as const,
  fundTransactions: (params: object) => ['funds', 'transactions', params] as const,
  statement: (params: object) => ['statement', params] as const,
  watchlists: ['watchlists'] as const,
  alerts: (params: object) => ['alerts', params] as const,
  notifications: (params: object) => ['notifications', params] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  ipos: (status: string) => ['ipos', status] as const,
  ipo: (id: number) => ['ipos', 'detail', id] as const,
  ipoApplications: ['ipos', 'applications'] as const,
};
