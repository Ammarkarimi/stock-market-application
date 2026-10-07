import { LogOut, Menu as MenuIcon, Moon, ShieldCheck, Sun, UserRound } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Menu, MenuItem } from '@/components/ui/Misc';
import { PageLoader } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';
import { useStreamConnected } from '@/live/priceStore';
import { IdleGuard } from './IdleGuard';
import { Logo } from './Logo';
import { MarketTicker } from './MarketTicker';
import { NotificationBell } from './NotificationBell';
import { SearchBox } from './SearchBox';
import { Sidebar } from './Sidebar';

function LiveIndicator() {
  const connected = useStreamConnected();
  return (
    <span
      className={cn('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium md:inline-flex', connected ? 'bg-gain-soft text-gain' : 'bg-surface-2 text-muted')}
      title={connected ? 'Receiving live prices' : 'Reconnecting to live prices'}
    >
      <span className={cn('size-1.5 rounded-full', connected ? 'animate-pulse bg-gain' : 'bg-subtle')} />
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function AppShell() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-surface lg:block">
        <Sidebar />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-border bg-surface shadow-pop">
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button type="button" className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
            <MenuIcon className="size-5" />
          </button>
          <div className="lg:hidden">
            <Logo compact />
          </div>
          <SearchBox className="max-w-md flex-1" />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <LiveIndicator />
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
            <NotificationBell />
            <Menu
              trigger={({ toggle }) => (
                <button type="button" onClick={toggle} className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface-2" aria-label="Account menu">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-fg">
                    {initials(user?.fullName ?? '?')}
                  </span>
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="border-b border-border px-3 py-2.5">
                    <p className="truncate text-sm font-semibold">{user?.fullName}</p>
                    <p className="truncate text-xs text-muted">{user?.email}</p>
                  </div>
                  <MenuItem icon={<UserRound className="size-4" />} onClick={() => { close(); navigate('/profile'); }}>
                    Profile
                  </MenuItem>
                  <MenuItem icon={<ShieldCheck className="size-4" />} onClick={() => { close(); navigate('/profile?tab=security'); }}>
                    Security & sessions
                  </MenuItem>
                  <MenuItem
                    danger
                    icon={<LogOut className="size-4" />}
                    onClick={() => {
                      close();
                      void logout();
                    }}
                  >
                    Sign out
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>
        <MarketTicker />
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
      <IdleGuard />
    </div>
  );
}
