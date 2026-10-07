import { get, run, transaction } from '../db/index.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { hashSecret, verifySecret } from '../lib/crypto.js';
import { AppError, badRequest, locked, notFound, unprocessable } from '../lib/errors.js';
import type { Actor } from './actor.js';
import { audit } from './audit.service.js';
import {
  MUTABLE_CATEGORIES,
  notify,
  parsePreferences,
  type NotificationPreferences,
} from './notification.service.js';
import { revokeUserSessions } from './session.service.js';
import { findUserById, maskAccountNumber, toUserDto, type UserDto, type UserRow } from './user.repository.js';

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 30;

function requireUser(userId: number): UserRow {
  const user = findUserById(userId);
  if (!user) throw notFound('User not found');
  return user;
}

export interface ProfileUpdate {
  fullName?: string;
  phone?: string | null;
  dateOfBirth?: string | null;
  pan?: string | null;
  address?: string | null;
}

export function updateProfile(userId: number, update: ProfileUpdate, actor: Actor): UserDto {
  const before = toUserDto(requireUser(userId));
  const columns: Record<string, unknown> = {
    full_name: update.fullName?.trim(),
    phone: update.phone === undefined ? undefined : update.phone?.trim() || null,
    date_of_birth: update.dateOfBirth === undefined ? undefined : update.dateOfBirth || null,
    pan: update.pan === undefined ? undefined : update.pan?.trim().toUpperCase() || null,
    address: update.address === undefined ? undefined : update.address?.trim() || null,
  };
  const keys = Object.keys(columns).filter((key) => columns[key] !== undefined);
  if (keys.length === 0) return before;
  return transaction(() => {
    run(
      `UPDATE users SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...keys.map((key) => columns[key]),
      nowIso(),
      userId,
    );
    const after = toUserDto(requireUser(userId));
    const changed = (Object.keys(after) as (keyof UserDto)[]).filter((key) => before[key] !== after[key]);
    audit({ actor, action: 'PROFILE_UPDATED', subjectUserId: userId, entityType: 'USER', entityId: userId, details: { changed } });
    return after;
  });
}

export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
  actor: Actor,
  currentSessionId: string,
): Promise<{ revokedSessions: number }> {
  const user = requireUser(userId);
  if (!(await verifySecret(currentPassword, user.password_hash))) {
    audit({ actor, action: 'PASSWORD_CHANGE_FAILED', entityType: 'USER', entityId: userId, details: { reason: 'Wrong current password' } });
    throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
  }
  if (currentPassword === newPassword) throw badRequest('New password must be different from the current password');
  const hash = await hashSecret(newPassword);
  return transaction(() => {
    const now = nowIso();
    run('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?', hash, now, now, userId);
    const revokedSessions = revokeUserSessions(userId, 'PASSWORD_CHANGED', currentSessionId);
    audit({ actor, action: 'PASSWORD_CHANGED', entityType: 'USER', entityId: userId, details: { revokedSessions } });
    notify(userId, 'SECURITY', 'Password changed', 'Your password was changed and your other sessions were signed out.');
    return { revokedSessions };
  });
}

/** Sets or changes the 4-digit transaction PIN. Requires the account password. */
export async function setTransactionPin(userId: number, password: string, pin: string, actor: Actor): Promise<void> {
  const user = requireUser(userId);
  if (!(await verifySecret(password, user.password_hash))) {
    audit({ actor, action: 'PIN_CHANGE_FAILED', entityType: 'USER', entityId: userId, details: { reason: 'Wrong password' } });
    throw new AppError(400, 'INVALID_PASSWORD', 'Password is incorrect');
  }
  if (/^(\d)\1{3}$/.test(pin) || ['1234', '4321', '0123', '9876'].includes(pin)) {
    throw badRequest('Choose a less predictable PIN (avoid repeated or sequential digits)');
  }
  const hash = await hashSecret(pin);
  transaction(() => {
    run(
      'UPDATE users SET pin_hash = ?, pin_failed_attempts = 0, pin_locked_until = NULL, updated_at = ? WHERE id = ?',
      hash,
      nowIso(),
      userId,
    );
    const action = user.pin_hash ? 'PIN_CHANGED' : 'PIN_SET';
    audit({ actor, action, entityType: 'USER', entityId: userId });
    notify(
      userId,
      'SECURITY',
      user.pin_hash ? 'Transaction PIN changed' : 'Transaction PIN set',
      'Your transaction PIN is used to confirm orders, IPO bids and withdrawals.',
    );
  });
}

/**
 * Confirms a money-moving action. Throws when the PIN is missing, locked or wrong; repeated failures
 * lock PIN use temporarily.
 */
export async function verifyTransactionPin(userId: number, pin: string | undefined, actor: Actor, purpose: string): Promise<void> {
  const user = requireUser(userId);
  if (!user.pin_hash) {
    throw unprocessable('PIN_NOT_SET', 'Set a transaction PIN in your profile before continuing');
  }
  if (user.pin_locked_until && Date.parse(user.pin_locked_until) > nowMs()) {
    const minutes = Math.ceil((Date.parse(user.pin_locked_until) - nowMs()) / 60_000);
    throw locked(`Transaction PIN is locked after too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
  if (!pin) throw new AppError(400, 'PIN_REQUIRED', 'Transaction PIN is required');
  if (await verifySecret(pin, user.pin_hash)) {
    if (user.pin_failed_attempts > 0) run('UPDATE users SET pin_failed_attempts = 0 WHERE id = ?', userId);
    return;
  }
  const attempts = user.pin_failed_attempts + 1;
  const lockUntil = attempts >= MAX_PIN_ATTEMPTS ? new Date(nowMs() + PIN_LOCK_MINUTES * 60_000).toISOString() : null;
  run(
    'UPDATE users SET pin_failed_attempts = ?, pin_locked_until = ? WHERE id = ?',
    lockUntil ? 0 : attempts,
    lockUntil,
    userId,
  );
  audit({ actor, action: lockUntil ? 'PIN_LOCKED' : 'PIN_FAILED', entityType: 'USER', entityId: userId, details: { purpose, attempts } });
  if (lockUntil) {
    notify(userId, 'SECURITY', 'Transaction PIN locked', `PIN use is blocked for ${PIN_LOCK_MINUTES} minutes after ${MAX_PIN_ATTEMPTS} wrong attempts.`);
    throw locked(`Too many wrong PIN attempts. PIN use is blocked for ${PIN_LOCK_MINUTES} minutes.`);
  }
  const left = MAX_PIN_ATTEMPTS - attempts;
  throw new AppError(403, 'INVALID_PIN', `Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left.`);
}

interface BankAccountRow {
  user_id: number;
  account_holder: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
  created_at: string;
  updated_at: string;
}

export interface BankAccountDto {
  accountHolder: string;
  accountNumberMasked: string;
  ifsc: string;
  bankName: string;
  updatedAt: string;
}

export function getBankAccount(userId: number): BankAccountDto | null {
  const row = get<BankAccountRow>('SELECT * FROM bank_accounts WHERE user_id = ?', userId);
  if (!row) return null;
  return {
    accountHolder: row.account_holder,
    accountNumberMasked: maskAccountNumber(row.account_number),
    ifsc: row.ifsc,
    bankName: row.bank_name,
    updatedAt: row.updated_at,
  };
}

export interface BankAccountInput {
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
}

export function saveBankAccount(userId: number, input: BankAccountInput, actor: Actor): BankAccountDto {
  return transaction(() => {
    const now = nowIso();
    const existing = getBankAccount(userId);
    run(
      `INSERT INTO bank_accounts (user_id, account_holder, account_number, ifsc, bank_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET account_holder = excluded.account_holder,
         account_number = excluded.account_number, ifsc = excluded.ifsc, bank_name = excluded.bank_name,
         updated_at = excluded.updated_at`,
      userId,
      input.accountHolder.trim(),
      input.accountNumber,
      input.ifsc.toUpperCase(),
      input.bankName.trim(),
      now,
      now,
    );
    const saved = getBankAccount(userId)!;
    audit({
      actor,
      action: existing ? 'BANK_ACCOUNT_UPDATED' : 'BANK_ACCOUNT_ADDED',
      subjectUserId: userId,
      entityType: 'BANK_ACCOUNT',
      entityId: userId,
      details: { accountNumber: saved.accountNumberMasked, ifsc: saved.ifsc, bankName: saved.bankName },
    });
    notify(userId, 'SECURITY', 'Bank account updated', `Withdrawals will now go to ${saved.bankName} ${saved.accountNumberMasked}.`);
    return saved;
  });
}

export function getNotificationPreferences(userId: number): NotificationPreferences {
  return parsePreferences(requireUser(userId).notification_prefs);
}

export function updateNotificationPreferences(
  userId: number,
  update: Partial<NotificationPreferences>,
  actor: Actor,
): NotificationPreferences {
  const prefs = getNotificationPreferences(userId);
  for (const category of MUTABLE_CATEGORIES) if (typeof update[category] === 'boolean') prefs[category] = update[category];
  run('UPDATE users SET notification_prefs = ?, updated_at = ? WHERE id = ?', JSON.stringify(prefs), nowIso(), userId);
  audit({ actor, action: 'NOTIFICATION_PREFERENCES_UPDATED', entityType: 'USER', entityId: userId, details: { prefs } });
  return prefs;
}
