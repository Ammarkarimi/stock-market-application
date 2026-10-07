import {
  ArrowLeftRight,
  BellRing,
  Briefcase,
  Building2,
  ClipboardList,
  Compass,
  FileText,
  Gauge,
  LayoutDashboard,
  LineChart,
  Rocket,
  ScrollText,
  Settings,
  Star,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const mainNav: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/markets', label: 'Markets', icon: LineChart },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/orders', label: 'Orders', icon: ClipboardList },
  { to: '/watchlist', label: 'Watchlist', icon: Star },
  { to: '/ipo', label: 'IPOs', icon: Rocket },
  { to: '/funds', label: 'Funds', icon: Wallet },
  { to: '/statements', label: 'Statements', icon: FileText },
  { to: '/alerts', label: 'Price alerts', icon: BellRing },
  { to: '/profile', label: 'Profile', icon: UserRound },
];

export const adminNav: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: Gauge, end: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/securities', label: 'Securities', icon: Building2 },
  { to: '/admin/ipos', label: 'IPOs', icon: Rocket },
  { to: '/admin/orders', label: 'Orders', icon: ClipboardList },
  { to: '/admin/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/admin/audit', label: 'Audit trail', icon: ScrollText },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];
