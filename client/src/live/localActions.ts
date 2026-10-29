import type { NotificationCategory } from '@/lib/types';

/**
 * Remembers actions the user just performed in this tab, so the matching server notification does not
 * pop a second toast on top of the confirmation the UI already showed.
 */
const recent = new Map<NotificationCategory, number>();
// Long enough for the next live poll (every five seconds) to pick the notification up.
const WINDOW_MS = 12_000;

export function markLocalAction(category: NotificationCategory): void {
  recent.set(category, Date.now());
}

export function isRecentLocalAction(category: NotificationCategory): boolean {
  const at = recent.get(category);
  return at !== undefined && Date.now() - at < WINDOW_MS;
}
