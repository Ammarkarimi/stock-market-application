import { ShieldCheck } from 'lucide-react';
import { NavLink } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';
import { Logo } from './Logo';
import { adminNav, mainNav, type NavItem } from './nav';

function NavGroup({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )
            }
          >
            <Icon className="size-[18px] shrink-0" />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Logo />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin" aria-label="Main">
        <NavGroup items={mainNav} onNavigate={onNavigate} />
        {user?.role === 'ADMIN' && (
          <div className="mt-6">
            <p className="mb-2 flex items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">
              <ShieldCheck className="size-3.5" /> Administration
            </p>
            <NavGroup items={adminNav} onNavigate={onNavigate} />
          </div>
        )}
      </nav>
      <p className="border-t border-border px-5 py-3 text-[11px] leading-snug text-subtle">
        Simulated market data for demonstration. Not investment advice.
      </p>
    </div>
  );
}
