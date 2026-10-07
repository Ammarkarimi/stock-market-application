import { get } from '../db/index.js';

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  date_of_birth: string | null;
  pan: string | null;
  address: string | null;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  pin_hash: string | null;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  notification_prefs: string;
  last_login_at: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserDto {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  dateOfBirth: string | null;
  pan: string | null;
  address: string | null;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  hasPin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export function findUserById(id: number): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}

export function findUserByEmail(email: string): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE email = ?', email.trim().toLowerCase());
}

export function toUserDto(user: UserRow): UserDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    dateOfBirth: user.date_of_birth,
    pan: user.pan,
    address: user.address,
    role: user.role,
    status: user.status,
    hasPin: Boolean(user.pin_hash),
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

/** Masks all but the last four characters, e.g. XXXXXX7890. */
export function maskAccountNumber(accountNumber: string): string {
  return accountNumber.length <= 4 ? accountNumber : 'X'.repeat(accountNumber.length - 4) + accountNumber.slice(-4);
}
