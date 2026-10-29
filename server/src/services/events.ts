import { all, get, run, transaction } from '../db/index.js';

export type UserEventType = 'order' | 'funds' | 'portfolio' | 'ipo' | 'alert' | 'watchlist';

/**
 * Records that something changed for a user. Browsers polling /api/live compare versions and refresh the
 * matching screens; versions come from one sequence, so they only ever grow.
 */
export async function emitToUser(userId: number, type: UserEventType): Promise<void> {
  // Under the write lock, versions become visible in the order they were drawn, so a poll never skips one.
  await transaction(() =>
    run(
      `INSERT INTO user_events (user_id, event_type, version) VALUES (?, ?, nextval('user_event_version'))
       ON CONFLICT (user_id, event_type) DO UPDATE SET version = excluded.version`,
      userId,
      type,
    ),
  );
}

/** The user's event types that changed after `since`, with their latest versions. */
export async function userEventsSince(userId: number, since: number): Promise<Record<string, number>> {
  const rows = await all<{ event_type: string; version: number }>(
    'SELECT event_type, version FROM user_events WHERE user_id = ? AND version > ?',
    userId,
    since,
  );
  return Object.fromEntries(rows.map((r) => [r.event_type, r.version]));
}

export async function latestUserEventVersion(userId: number): Promise<number> {
  return (await get<{ v: number | null }>('SELECT MAX(version) AS v FROM user_events WHERE user_id = ?', userId))?.v ?? 0;
}
