import { titleCase } from './format';

/** Human-readable labels for audit trail actions. */
const LABELS: Record<string, string> = {
  USER_REGISTERED: 'Account created',
  LOGIN_SUCCESS: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in attempt',
  LOGIN_BLOCKED: 'Sign-in blocked',
  ACCOUNT_LOCKED: 'Account temporarily locked',
  LOGOUT: 'Signed out',
  SESSION_REVOKED: 'Session signed out',
  OTHER_SESSIONS_REVOKED: 'Other sessions signed out',
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_CHANGE_FAILED: 'Password change failed',
  PIN_SET: 'Transaction PIN set',
  PIN_CHANGED: 'Transaction PIN changed',
  PIN_CHANGE_FAILED: 'PIN change failed',
  PIN_FAILED: 'Wrong transaction PIN',
  PIN_LOCKED: 'Transaction PIN locked',
  PROFILE_UPDATED: 'Profile updated',
  BANK_ACCOUNT_ADDED: 'Bank account added',
  BANK_ACCOUNT_UPDATED: 'Bank account updated',
  NOTIFICATION_PREFERENCES_UPDATED: 'Notification preferences updated',
  FUNDS_DEPOSITED: 'Money added',
  FUNDS_WITHDRAWN: 'Money withdrawn',
  FUNDS_ADJUSTED: 'Balance adjusted by admin',
  ORDER_PLACED: 'Order placed',
  ORDER_MODIFIED: 'Order modified',
  ORDER_EXECUTED: 'Order executed',
  ORDER_CANCELLED: 'Order cancelled',
  ORDER_REJECTED: 'Order rejected',
  ORDER_EXPIRED: 'Order expired',
  WATCHLIST_CREATED: 'Watchlist created',
  WATCHLIST_RENAMED: 'Watchlist renamed',
  WATCHLIST_DELETED: 'Watchlist deleted',
  WATCHLIST_ITEM_ADDED: 'Added to watchlist',
  WATCHLIST_ITEM_REMOVED: 'Removed from watchlist',
  ALERT_CREATED: 'Price alert created',
  ALERT_UPDATED: 'Price alert updated',
  ALERT_DELETED: 'Price alert deleted',
  ALERT_TRIGGERED: 'Price alert triggered',
  IPO_APPLIED: 'Applied for IPO',
  IPO_APPLICATION_CANCELLED: 'IPO application cancelled',
  IPO_ALLOTMENT_RESULT: 'IPO allotment result',
  STATEMENT_DOWNLOADED: 'Statement downloaded',
  USER_SUSPENDED: 'Account suspended',
  USER_REACTIVATED: 'Account reactivated',
  USER_UNLOCKED: 'Account unlocked',
  USER_ROLE_CHANGED: 'Role changed',
  USER_SESSIONS_REVOKED: 'Signed out everywhere by admin',
};

export function actionLabel(action: string): string {
  return LABELS[action] ?? titleCase(action);
}

/** Short summary of an audit entry's details, e.g. "BUY 10 TCS". */
export function detailSummary(details: Record<string, unknown> | null): string {
  if (!details) return '';
  const d = details as Record<string, string | number | boolean | null | undefined>;
  const parts: string[] = [];
  if (d.side && d.symbol) parts.push(`${d.side} ${d.quantity ?? ''} ${d.symbol}`.replace(/\s+/g, ' '));
  else if (d.symbol) parts.push(String(d.symbol));
  if (d.ipo) parts.push(String(d.ipo));
  if (d.amount !== undefined && d.amount !== null) parts.push(`₹${Number(d.amount).toLocaleString('en-IN')}`);
  if (d.price !== undefined && d.price !== null) parts.push(`@ ₹${Number(d.price).toLocaleString('en-IN')}`);
  if (d.reason) parts.push(String(d.reason));
  if (d.device) parts.push(String(d.device));
  if (d.name) parts.push(String(d.name));
  if (d.method) parts.push(String(d.method));
  return parts.join(' · ');
}
