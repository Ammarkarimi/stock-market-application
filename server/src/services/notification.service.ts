import { afterCommit, all, get, run } from '../db/index.js';
import { nowIso } from '../lib/clock.js';
import { notFound } from '../lib/errors.js';
import { pageOf, type Page } from '../lib/validation.js';
import { emitToUser } from './events.js';

export const NOTIFICATION_CATEGORIES = ['ORDER', 'IPO', 'PRICE_ALERT', 'FUNDS', 'SECURITY', 'SYSTEM'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Categories a user may mute. Security notifications are always delivered. */
export const MUTABLE_CATEGORIES = ['ORDER', 'IPO', 'PRICE_ALERT', 'FUNDS', 'SYSTEM'] as const;
export type NotificationPreferences = Record<(typeof MUTABLE_CATEGORIES)[number], boolean>;

interface NotificationRow {
  id: number;
  user_id: number;
  category: NotificationCategory;
  title: string;
  message: string;
  link: string | null;
  is_read: number;
  created_at: string;
}

export interface NotificationDto {
  id: number;
  category: NotificationCategory;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    message: row.message,
    link: row.link,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}

export function parsePreferences(raw: string | null | undefined): NotificationPreferences {
  const stored = raw ? (JSON.parse(raw) as Partial<NotificationPreferences>) : {};
  const prefs = {} as NotificationPreferences;
  for (const category of MUTABLE_CATEGORIES) prefs[category] = stored[category] !== false;
  return prefs;
}

/**
 * Creates an in-app notification (unless the user muted the category) and pushes it over the live
 * stream once the surrounding transaction commits.
 */
export function notify(
  userId: number,
  category: NotificationCategory,
  title: string,
  message: string,
  link: string | null = null,
): NotificationDto | null {
  if (category !== 'SECURITY') {
    const prefs = parsePreferences(
      get<{ notification_prefs: string }>('SELECT notification_prefs FROM users WHERE id = ?', userId)
        ?.notification_prefs,
    );
    if (!prefs[category]) return null;
  }
  const createdAt = nowIso();
  const result = run(
    `INSERT INTO notifications (user_id, category, title, message, link, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    userId,
    category,
    title,
    message,
    link,
    createdAt,
  );
  const dto: NotificationDto = {
    id: Number(result.lastInsertRowid),
    category,
    title,
    message,
    link,
    isRead: false,
    createdAt,
  };
  afterCommit(() => emitToUser(userId, 'notification', dto));
  return dto;
}

export function listNotifications(
  userId: number,
  query: { category?: NotificationCategory; unreadOnly?: boolean; page: number; pageSize: number },
): Page<NotificationDto> & { unreadCount: number } {
  const where = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (query.category) (where.push('category = ?'), params.push(query.category));
  if (query.unreadOnly) where.push('is_read = 0');
  const clause = where.join(' AND ');
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE ${clause}`, ...params)?.n ?? 0;
  const rows = all<NotificationRow>(
    `SELECT * FROM notifications WHERE ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params,
    query.pageSize,
    (query.page - 1) * query.pageSize,
  );
  return { ...pageOf(rows.map(toDto), total, query.page, query.pageSize), unreadCount: unreadCount(userId) };
}

export function unreadCount(userId: number): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', userId)?.n ?? 0;
}

export function markRead(userId: number, id: number): void {
  const result = run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', id, userId);
  if (result.changes === 0) throw notFound('Notification not found');
}

export function markAllRead(userId: number): number {
  return run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', userId).changes;
}

export function deleteNotification(userId: number, id: number): void {
  const result = run('DELETE FROM notifications WHERE id = ? AND user_id = ?', id, userId);
  if (result.changes === 0) throw notFound('Notification not found');
}

/** Sends a notification to every active user (admin announcements, new IPOs). */
export function notifyAllUsers(
  category: NotificationCategory,
  title: string,
  message: string,
  link: string | null = null,
): number {
  const users = all<{ id: number }>("SELECT id FROM users WHERE status = 'ACTIVE'");
  let delivered = 0;
  for (const user of users) if (notify(user.id, category, title, message, link)) delivered++;
  return delivered;
}
