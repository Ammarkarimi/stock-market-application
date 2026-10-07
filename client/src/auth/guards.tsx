import { Navigate, Outlet, useLocation } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { TradeProvider } from '@/components/trade/TradeProvider';
import { PageLoader } from '@/components/ui/Spinner';
import { LiveProvider } from '@/live/LiveProvider';
import { useAuth } from './AuthProvider';

function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <PageLoader label="Loading StockSphere…" />
    </div>
  );
}

/** Signed-in area: app shell plus the live price/notification stream. */
export function RequireAuth() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
  return (
    <LiveProvider>
      <TradeProvider>
        <AppShell />
      </TradeProvider>
    </LiveProvider>
  );
}

export function RequireAdmin() {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Login and registration pages redirect signed-in users back into the app. */
export function PublicOnly() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }
  return <Outlet />;
}
