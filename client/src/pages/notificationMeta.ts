import { BellRing, Megaphone, Receipt, Rocket, ShieldAlert, Wallet, type LucideIcon } from 'lucide-react';
import type { NotificationCategory } from '@/lib/types';

export const categoryIcon: Record<NotificationCategory, LucideIcon> = {
  ORDER: Receipt,
  IPO: Rocket,
  PRICE_ALERT: BellRing,
  FUNDS: Wallet,
  SECURITY: ShieldAlert,
  SYSTEM: Megaphone,
};

export const categoryLabel: Record<NotificationCategory, string> = {
  ORDER: 'Orders',
  IPO: 'IPOs',
  PRICE_ALERT: 'Price alerts',
  FUNDS: 'Funds',
  SECURITY: 'Security',
  SYSTEM: 'Announcements',
};
