import { run, transaction } from '../db/index.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { hashSecret, verifySecret } from '../lib/crypto.js';
import { AppError, conflict, forbidden, locked, unauthorized } from '../lib/errors.js';
import { describeUserAgent } from '../lib/userAgent.js';
import type { Actor } from './actor.js';
import { audit } from './audit.service.js';
import { notify } from './notification.service.js';
import { createSession, revokeSession, type SessionRow } from './session.service.js';
import { findUserByEmail, findUserById, type UserRow } from './user.repository.js';

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;

export interface NewUserInput {
  fullName: string;
  email: string;
  phone?: string | null;
  password: string;
  role?: 'USER' | 'ADMIN';
}

/** Inserts a user with an empty cash account and a default watchlist. Returns the new user id. */
export async function createUser(input: NewUserInput): Promise<number> {
  const email = input.email.trim().toLowerCase();
  if (findUserByEmail(email)) throw conflict('An account with this email already exists');
  const passwordHash = await hashSecret(input.password);
  return transaction(() => {
    const now = nowIso();
    const result = run(
      `INSERT INTO users (email, password_hash, full_name, phone, role, password_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      email,
      passwordHash,
      input.fullName.trim(),
      input.phone?.trim() || null,
      input.role ?? 'USER',
      now,
      now,
      now,
    );
    const userId = Number(result.lastInsertRowid);
    run('INSERT INTO accounts (user_id, cash_balance, updated_at) VALUES (?, 0, ?)', userId, now);
    run('INSERT INTO watchlists (user_id, name, created_at) VALUES (?, ?, ?)', userId, 'My Watchlist', now);
    return userId;
  });
}

export interface AuthResult {
  user: UserRow;
  token: string;
  session: SessionRow;
}

export async function register(input: NewUserInput, actor: Actor): Promise<AuthResult> {
  const userId = await createUser({ ...input, role: 'USER' });
  return transaction(() => {
    const { token, session } = createSession(userId, actor);
    const user = findUserById(userId)!;
    audit({
      actor: { ...actor, userId, role: 'USER' },
      action: 'USER_REGISTERED',
      entityType: 'USER',
      entityId: userId,
      details: { email: user.email },
    });
    notify(
      userId,
      'SYSTEM',
      'Welcome to StockSphere',
      'Your account is ready. Add money and set a transaction PIN to start investing.',
      '/funds',
    );
    return { user, token, session };
  });
}

export async function login(email: string, password: string, actor: Actor): Promise<AuthResult> {
  const user = findUserByEmail(email);
  if (user?.locked_until && Date.parse(user.locked_until) > nowMs()) {
    audit({
      actor: { ...actor, role: 'ANONYMOUS' },
      action: 'LOGIN_BLOCKED',
      subjectUserId: user.id,
      entityType: 'USER',
      entityId: user.id,
      details: { reason: 'Account locked' },
    });
    const minutes = Math.ceil((Date.parse(user.locked_until) - nowMs()) / 60_000);
    throw locked(`Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  const valid = await verifySecret(password, user?.password_hash);
  if (!user || !valid) {
    if (user) {
      const attempts = user.failed_login_attempts + 1;
      const lockUntil =
        attempts >= MAX_LOGIN_ATTEMPTS ? new Date(nowMs() + LOGIN_LOCK_MINUTES * 60_000).toISOString() : null;
      run(
        'UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?',
        lockUntil ? 0 : attempts,
        lockUntil,
        nowIso(),
        user.id,
      );
      audit({
        actor: { ...actor, role: 'ANONYMOUS' },
        action: lockUntil ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        subjectUserId: user.id,
        entityType: 'USER',
        entityId: user.id,
        details: { attempts },
      });
      if (lockUntil) {
        notify(
          user.id,
          'SECURITY',
          'Account temporarily locked',
          `Your account was locked for ${LOGIN_LOCK_MINUTES} minutes after ${MAX_LOGIN_ATTEMPTS} failed login attempts.`,
        );
      }
    } else {
      audit({
        actor: { ...actor, role: 'ANONYMOUS' },
        action: 'LOGIN_FAILED',
        subjectUserId: null,
        details: { email: email.trim().toLowerCase(), reason: 'Unknown email' },
      });
    }
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (user.status !== 'ACTIVE') {
    audit({
      actor: { ...actor, userId: user.id, role: user.role },
      action: 'LOGIN_BLOCKED',
      entityType: 'USER',
      entityId: user.id,
      details: { reason: 'Account suspended' },
    });
    throw forbidden('Your account has been suspended. Please contact support.');
  }

  return transaction(() => {
    const now = nowIso();
    run(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
      now,
      now,
      user.id,
    );
    const { token, session } = createSession(user.id, actor);
    const device = describeUserAgent(actor.userAgent);
    audit({
      actor: { ...actor, userId: user.id, role: user.role },
      action: 'LOGIN_SUCCESS',
      entityType: 'SESSION',
      entityId: session.id.slice(0, 12),
      details: { device },
    });
    notify(
      user.id,
      'SECURITY',
      'New login to your account',
      `Signed in from ${device}${actor.ip ? ` (IP ${actor.ip})` : ''}. If this wasn't you, change your password and sign out other sessions.`,
      '/profile?tab=security',
    );
    return { user: findUserById(user.id)!, token, session };
  });
}

export function logout(session: SessionRow | undefined, actor: Actor): void {
  if (!session) throw unauthorized();
  revokeSession(session.id, 'LOGOUT');
  audit({ actor, action: 'LOGOUT', entityType: 'SESSION', entityId: session.id.slice(0, 12) });
}
