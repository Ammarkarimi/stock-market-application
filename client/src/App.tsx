import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/auth/AuthProvider';
import { PublicOnly, RequireAdmin, RequireAuth } from '@/auth/guards';
import { PageLoader } from '@/components/ui/Spinner';
import { queryClient } from '@/lib/queryClient';
import { useTheme } from '@/lib/theme';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const MarketsPage = lazy(() => import('@/pages/MarketsPage'));
const ExplorePage = lazy(() => import('@/pages/ExplorePage'));
const SecurityPage = lazy(() => import('@/pages/SecurityPage'));
const PortfolioPage = lazy(() => import('@/pages/PortfolioPage'));
const OrdersPage = lazy(() => import('@/pages/OrdersPage'));
const WatchlistPage = lazy(() => import('@/pages/WatchlistPage'));
const IposPage = lazy(() => import('@/pages/IposPage'));
const IpoDetailPage = lazy(() => import('@/pages/IpoDetailPage'));
const FundsPage = lazy(() => import('@/pages/FundsPage'));
const StatementsPage = lazy(() => import('@/pages/StatementsPage'));
const AlertsPage = lazy(() => import('@/pages/AlertsPage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const AdminOverviewPage = lazy(() => import('@/pages/admin/AdminOverviewPage'));
const AdminUsersPage = lazy(() => import('@/pages/admin/AdminUsersPage'));
const AdminUserDetailPage = lazy(() => import('@/pages/admin/AdminUserDetailPage'));
const AdminSecuritiesPage = lazy(() => import('@/pages/admin/AdminSecuritiesPage'));
const AdminIposPage = lazy(() => import('@/pages/admin/AdminIposPage'));
const AdminOrdersPage = lazy(() => import('@/pages/admin/AdminOrdersPage'));
const AdminTransactionsPage = lazy(() => import('@/pages/admin/AdminTransactionsPage'));
const AdminAuditPage = lazy(() => import('@/pages/admin/AdminAuditPage'));
const AdminSettingsPage = lazy(() => import('@/pages/admin/AdminSettingsPage'));

const withSuspense = (element: React.ReactNode) => <Suspense fallback={<PageLoader />}>{element}</Suspense>;

const router = createBrowserRouter([
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: withSuspense(<LoginPage />) },
      { path: '/register', element: withSuspense(<RegisterPage />) },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/markets', element: <MarketsPage /> },
      { path: '/explore', element: <ExplorePage /> },
      { path: '/stocks/:symbol', element: <SecurityPage /> },
      { path: '/portfolio', element: <PortfolioPage /> },
      { path: '/orders', element: <OrdersPage /> },
      { path: '/watchlist', element: <WatchlistPage /> },
      { path: '/ipo', element: <IposPage /> },
      { path: '/ipo/:id', element: <IpoDetailPage /> },
      { path: '/funds', element: <FundsPage /> },
      { path: '/statements', element: <StatementsPage /> },
      { path: '/alerts', element: <AlertsPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/profile', element: <ProfilePage /> },
      {
        path: '/admin',
        element: <RequireAdmin />,
        children: [
          { index: true, element: <AdminOverviewPage /> },
          { path: 'users', element: <AdminUsersPage /> },
          { path: 'users/:id', element: <AdminUserDetailPage /> },
          { path: 'securities', element: <AdminSecuritiesPage /> },
          { path: 'ipos', element: <AdminIposPage /> },
          { path: 'orders', element: <AdminOrdersPage /> },
          { path: 'transactions', element: <AdminTransactionsPage /> },
          { path: 'audit', element: <AdminAuditPage /> },
          { path: 'settings', element: <AdminSettingsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

function ThemedToaster() {
  const [theme] = useTheme();
  return <Toaster theme={theme} position="top-right" richColors closeButton toastOptions={{ duration: 5000 }} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <ThemedToaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
