import { config } from '../config.js';
import { all, get, run } from '../db/index.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { describeUserAgent } from '../lib/userAgent.js';
import type { Actor } from './actor.js';
import { findUserById, type UserRow } from './user.repository.js';

export const SESSION_COOKIE = 'ss_session';

export interface SessionRow {
  id: string;
  user_id: number;
  csrf_token: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export interface AuthContext {
  user: UserRow;
  session: SessionRow;
}

export interface SessionDto {
  id: string;
  device: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

const idleMs = () => config.sessionIdleMinutes * 60_000;
const TOUCH_INTERVAL_MS = 30_000;

export async function createSession(userId: number, actor: Actor): Promise<{ token: string; session: SessionRow }> {
  const token = randomToken(32);
  const now = nowIso();
  const session: SessionRow = {
    id: sha256(token),
    user_id: userId,
    csrf_token: randomToken(24),
    ip: actor.ip ?? null,
    user_agent: actor.userAgent ?? null,
    created_at: now,
    last_seen_at: now,
    expires_at: new Date(nowMs() + config.sessionMaxHours * 3_600_000).toISOString(),
    revoked_at: null,
    revoked_reason: null,
  };
  await run(
    `INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    session.id,
    session.user_id,
    session.csrf_token,
    session.ip,
    session.user_agent,
    session.created_at,
    session.last_seen_at,
    session.expires_at,
  );
  return { token, session };
}

function isExpired(session: SessionRow, at: number): boolean {
  return Date.parse(session.expires_at) <= at || Date.parse(session.last_seen_at) + idleMs() <= at;
}

/** Looks up the session for a raw cookie token; expired sessions are revoked on sight. */
export async function resolveSession(token: string | undefined): Promise<AuthContext | null> {
  if (!token || token.length > 200) return null;
  const session = await get<SessionRow>('SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL', sha256(token));
  if (!session) return null;
  const at = nowMs();
  if (isExpired(session, at)) {
    await revokeSession(session.id, 'EXPIRED');
    return null;
  }
  const user = await findUserById(session.user_id);
  if (!user || user.status !== 'ACTIVE') {
    await revokeSession(session.id, user ? 'USER_SUSPENDED' : 'USER_DELETED');
    return null;
  }
  if (at - Date.parse(session.last_seen_at) > TOUCH_INTERVAL_MS) {
    session.last_seen_at = new Date(at).toISOString();
    await run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', session.last_seen_at, session.id);
  }
  return { user, session };
}

export async function revokeSession(sessionId: string, reason: string): Promise<boolean> {
  const changed =
    (await run(
      'UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL',
      nowIso(),
      reason,
      sessionId,
    )).changes > 0;
  // The session's next request (including the browser's live poll) gets a 401 and signs out.
  return changed;
}

/** Revokes every active session of a user, optionally keeping one (the caller's own). */
export async function revokeUserSessions(userId: number, reason: string, exceptSessionId?: string): Promise<number> {
  const sessions = await all<{ id: string }>(
    'SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND id != ?',
    userId,
    exceptSessionId ?? '',
  );
  for (const session of sessions) await revokeSession(session.id, reason);
  return sessions.length;
}

export async function getUserSession(userId: number, sessionId: string): Promise<SessionRow | undefined> {
  return await get<SessionRow>('SELECT * FROM sessions WHERE id = ? AND user_id = ?', sessionId, userId);
}

export async function listActiveSessions(userId: number, currentSessionId?: string): Promise<SessionDto[]> {
  const at = nowMs();
  return (await all<SessionRow>(
    'SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC',
    userId,
  ))
    .filter((session) => !isExpired(session, at))
    .map((session) => ({
      id: session.id,
      device: describeUserAgent(session.user_agent),
      userAgent: session.user_agent,
      ip: session.ip,
      createdAt: session.created_at,
      lastSeenAt: session.last_seen_at,
      expiresAt: session.expires_at,
      current: session.id === currentSessionId,
    }));
}

/** Marks lapsed sessions as expired and drops session rows older than 30 days. */
export async function cleanupSessions(): Promise<void> {
  const at = nowMs();
  const active = await all<SessionRow>('SELECT * FROM sessions WHERE revoked_at IS NULL');
  for (const session of active) if (isExpired(session, at)) await revokeSession(session.id, 'EXPIRED');
  await run('DELETE FROM sessions WHERE revoked_at IS NOT NULL AND revoked_at < ?', new Date(at - 30 * 86_400_000).toISOString());
}

export async function countActiveSessions(): Promise<number> {
  const at = nowMs();
  return (await all<SessionRow>('SELECT * FROM sessions WHERE revoked_at IS NULL')).filter((s) => !isExpired(s, at)).length;
}
