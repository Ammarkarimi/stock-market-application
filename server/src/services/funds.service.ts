import { afterCommit, all, get, run, transaction } from '../db/index.js';
import { nowIso } from '../lib/clock.js';
import { referenceCode } from '../lib/crypto.js';
import { AppError, badRequest, notFound, unprocessable } from '../lib/errors.js';
import { formatInr, toPaise, toRupees } from '../lib/money.js';
import { istDate, istDayEndIso, istDayStartIso } from '../lib/time.js';
import { pageOf, type Page } from '../lib/validation.js';
import type { Actor } from './actor.js';
import { audit } from './audit.service.js';
import { emitToUser } from './events.js';
import { notify } from './notification.service.js';
import { getBankAccount, verifyTransactionPin } from './profile.service.js';
import { getSetting } from './settings.service.js';

export type LedgerEntryType = 'DEPOSIT' | 'WITHDRAWAL' | 'BUY' | 'SELL' | 'CHARGES' | 'IPO_ALLOTMENT' | 'ADJUSTMENT';
export const LEDGER_ENTRY_TYPES: LedgerEntryType[] = ['DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL', 'CHARGES', 'IPO_ALLOTMENT', 'ADJUSTMENT'];
export const DEPOSIT_METHODS = ['UPI', 'NETBANKING', 'CARD'] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];

interface LedgerRow {
  id: number;
  user_id: number;
  entry_type: LedgerEntryType;
  amount: number;
  balance_after: number;
  reference_type: string | null;
  reference_id: number | null;
  description: string;
  created_at: string;
}

export interface LedgerEntryDto {
  id: number;
  type: LedgerEntryType;
  amount: number;
  credit: number;
  debit: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: number | null;
  description: string;
  createdAt: string;
}

export function toLedgerDto(row: LedgerRow): LedgerEntryDto {
  return {
    id: row.id,
    type: row.entry_type,
    amount: toRupees(row.amount),
    credit: row.amount > 0 ? toRupees(row.amount) : 0,
    debit: row.amount < 0 ? toRupees(-row.amount) : 0,
    balanceAfter: toRupees(row.balance_after),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function getCashBalance(userId: number): number {
  const row = get<{ cash_balance: number }>('SELECT cash_balance FROM accounts WHERE user_id = ?', userId);
  if (!row) throw notFound('Account not found');
  return row.cash_balance;
}

export function blockedForOrders(userId: number, excludeOrderId?: number): number {
  return (
    get<{ total: number | null }>(
      `SELECT SUM(blocked_amount) AS total FROM orders
        WHERE user_id = ? AND status = 'OPEN' AND side = 'BUY' AND id != ?`,
      userId,
      excludeOrderId ?? 0,
    )?.total ?? 0
  );
}

export function blockedForIpos(userId: number): number {
  return (
    get<{ total: number | null }>(
      "SELECT SUM(blocked_amount) AS total FROM ipo_applications WHERE user_id = ? AND status = 'APPLIED'",
      userId,
    )?.total ?? 0
  );
}

/** Cash that is not reserved for open buy orders or pending IPO bids (paise). */
export function availableBalance(userId: number, excludeOrderId?: number): number {
  return getCashBalance(userId) - blockedForOrders(userId, excludeOrderId) - blockedForIpos(userId);
}

export interface FundsSummary {
  cashBalance: number;
  availableBalance: number;
  blockedForOrders: number;
  blockedForIpos: number;
  withdrawable: number;
  totalDeposits: number;
  totalWithdrawals: number;
  limits: ReturnType<typeof getSetting<'funds'>>;
}

export function getFundsSummary(userId: number): FundsSummary {
  const cash = getCashBalance(userId);
  const orders = blockedForOrders(userId);
  const ipos = blockedForIpos(userId);
  const totals = get<{ deposits: number | null; withdrawals: number | null }>(
    `SELECT SUM(CASE WHEN txn_type = 'DEPOSIT' THEN amount END) AS deposits,
            SUM(CASE WHEN txn_type = 'WITHDRAWAL' THEN amount END) AS withdrawals
       FROM fund_transactions WHERE user_id = ? AND status = 'COMPLETED'`,
    userId,
  );
  const available = cash - orders - ipos;
  return {
    cashBalance: toRupees(cash),
    availableBalance: toRupees(available),
    blockedForOrders: toRupees(orders),
    blockedForIpos: toRupees(ipos),
    withdrawable: toRupees(Math.max(0, available)),
    totalDeposits: toRupees(totals?.deposits ?? 0),
    totalWithdrawals: toRupees(totals?.withdrawals ?? 0),
    limits: getSetting('funds'),
  };
}

export interface LedgerPosting {
  type: LedgerEntryType;
  /** Signed paise: positive credits the account, negative debits it. */
  amount: number;
  referenceType?: string;
  referenceId?: number;
  description: string;
}

/** Applies a signed amount to the cash balance and records it in the ledger. Must run in a transaction. */
export function postLedger(userId: number, posting: LedgerPosting): LedgerEntryDto {
  if (posting.amount === 0) {
    throw new Error('Ledger postings must have a non-zero amount');
  }
  const balance = getCashBalance(userId) + posting.amount;
  if (balance < 0) throw unprocessable('INSUFFICIENT_FUNDS', 'Insufficient funds');
  const now = nowIso();
  run('UPDATE accounts SET cash_balance = ?, updated_at = ? WHERE user_id = ?', balance, now, userId);
  const result = run(
    `INSERT INTO ledger_entries (user_id, entry_type, amount, balance_after, reference_type, reference_id, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    posting.type,
    posting.amount,
    balance,
    posting.referenceType ?? null,
    posting.referenceId ?? null,
    posting.description,
    now,
  );
  afterCommit(() => emitToUser(userId, 'funds'));
  return toLedgerDto({
    id: Number(result.lastInsertRowid),
    user_id: userId,
    entry_type: posting.type,
    amount: posting.amount,
    balance_after: balance,
    reference_type: posting.referenceType ?? null,
    reference_id: posting.referenceId ?? null,
    description: posting.description,
    created_at: now,
  });
}

interface FundTransactionRow {
  id: number;
  user_id: number;
  txn_type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  method: string;
  status: 'COMPLETED' | 'FAILED';
  reference: string;
  bank_account: string | null;
  created_at: string;
}

export interface FundTransactionDto {
  id: number;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  method: string;
  status: 'COMPLETED' | 'FAILED';
  reference: string;
  bankAccount: string | null;
  createdAt: string;
}

function toFundTransactionDto(row: FundTransactionRow): FundTransactionDto {
  return {
    id: row.id,
    type: row.txn_type,
    amount: toRupees(row.amount),
    method: row.method,
    status: row.status,
    reference: row.reference,
    bankAccount: row.bank_account,
    createdAt: row.created_at,
  };
}

const METHOD_LABELS: Record<string, string> = { UPI: 'UPI', NETBANKING: 'net banking', CARD: 'debit card', BANK_TRANSFER: 'bank transfer' };

function checkLimits(amount: number, min: number, max: number, label: string): void {
  if (amount < toPaise(min)) throw badRequest(`Minimum ${label} amount is ${formatInr(toPaise(min))}`);
  if (amount > toPaise(max)) throw badRequest(`Maximum ${label} amount per transaction is ${formatInr(toPaise(max))}`);
}

export function deposit(userId: number, amount: number, method: DepositMethod, actor: Actor): FundTransactionDto {
  const limits = getSetting('funds');
  checkLimits(amount, limits.minDeposit, limits.maxDeposit, 'deposit');
  return transaction(() => {
    const now = nowIso();
    const reference = referenceCode('DEP', istDate());
    const result = run(
      `INSERT INTO fund_transactions (user_id, txn_type, amount, method, status, reference, created_at)
       VALUES (?, 'DEPOSIT', ?, ?, 'COMPLETED', ?, ?)`,
      userId,
      amount,
      method,
      reference,
      now,
    );
    const id = Number(result.lastInsertRowid);
    postLedger(userId, {
      type: 'DEPOSIT',
      amount,
      referenceType: 'FUND_TRANSACTION',
      referenceId: id,
      description: `Funds added via ${METHOD_LABELS[method]} (${reference})`,
    });
    notify(userId, 'FUNDS', 'Funds added', `${formatInr(amount)} was added to your account via ${METHOD_LABELS[method]}.`, '/funds');
    audit({ actor, action: 'FUNDS_DEPOSITED', subjectUserId: userId, entityType: 'FUND_TRANSACTION', entityId: id, details: { amount: toRupees(amount), method, reference } });
    return toFundTransactionDto(get<FundTransactionRow>('SELECT * FROM fund_transactions WHERE id = ?', id)!);
  });
}

export async function withdraw(userId: number, amount: number, pin: string | undefined, actor: Actor): Promise<FundTransactionDto> {
  const bank = getBankAccount(userId);
  if (!bank) throw unprocessable('BANK_ACCOUNT_REQUIRED', 'Add a bank account in your profile before withdrawing');
  const limits = getSetting('funds');
  checkLimits(amount, limits.minWithdrawal, limits.maxWithdrawal, 'withdrawal');
  await verifyTransactionPin(userId, pin, actor, 'WITHDRAWAL');
  return transaction(() => {
    const available = availableBalance(userId);
    if (amount > available) {
      throw new AppError(422, 'INSUFFICIENT_FUNDS', `You can withdraw at most ${formatInr(Math.max(0, available))}`);
    }
    const now = nowIso();
    const reference = referenceCode('WDL', istDate());
    const destination = `${bank.bankName} ${bank.accountNumberMasked}`;
    const result = run(
      `INSERT INTO fund_transactions (user_id, txn_type, amount, method, status, reference, bank_account, created_at)
       VALUES (?, 'WITHDRAWAL', ?, 'BANK_TRANSFER', 'COMPLETED', ?, ?, ?)`,
      userId,
      amount,
      reference,
      destination,
      now,
    );
    const id = Number(result.lastInsertRowid);
    postLedger(userId, {
      type: 'WITHDRAWAL',
      amount: -amount,
      referenceType: 'FUND_TRANSACTION',
      referenceId: id,
      description: `Withdrawal to ${destination} (${reference})`,
    });
    notify(userId, 'FUNDS', 'Withdrawal processed', `${formatInr(amount)} was sent to ${destination}.`, '/funds');
    audit({ actor, action: 'FUNDS_WITHDRAWN', subjectUserId: userId, entityType: 'FUND_TRANSACTION', entityId: id, details: { amount: toRupees(amount), destination, reference } });
    return toFundTransactionDto(get<FundTransactionRow>('SELECT * FROM fund_transactions WHERE id = ?', id)!);
  });
}

/** Admin credit or debit with a mandatory reason. */
export function adjustFunds(userId: number, amount: number, reason: string, actor: Actor): LedgerEntryDto {
  if (amount === 0) throw badRequest('Amount must not be zero');
  return transaction(() => {
    if (amount < 0 && -amount > availableBalance(userId)) {
      throw unprocessable('INSUFFICIENT_FUNDS', 'Debit exceeds the user’s available balance');
    }
    const entry = postLedger(userId, {
      type: 'ADJUSTMENT',
      amount,
      referenceType: 'ADMIN',
      referenceId: actor.userId ?? undefined,
      description: `${amount > 0 ? 'Credit' : 'Debit'} adjustment: ${reason}`,
    });
    notify(
      userId,
      'FUNDS',
      amount > 0 ? 'Account credited' : 'Account debited',
      `${formatInr(Math.abs(amount))} was ${amount > 0 ? 'credited to' : 'debited from'} your account. Reason: ${reason}`,
      '/statements',
    );
    audit({ actor, action: 'FUNDS_ADJUSTED', subjectUserId: userId, entityType: 'LEDGER_ENTRY', entityId: entry.id, details: { amount: toRupees(amount), reason } });
    return entry;
  });
}

export function listFundTransactions(
  userId: number,
  query: { type?: 'DEPOSIT' | 'WITHDRAWAL'; page: number; pageSize: number },
): Page<FundTransactionDto> {
  const where = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (query.type) (where.push('txn_type = ?'), params.push(query.type));
  const clause = where.join(' AND ');
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM fund_transactions WHERE ${clause}`, ...params)!.n;
  const rows = all<FundTransactionRow>(
    `SELECT * FROM fund_transactions WHERE ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params,
    query.pageSize,
    (query.page - 1) * query.pageSize,
  );
  return pageOf(rows.map(toFundTransactionDto), total, query.page, query.pageSize);
}

export interface LedgerQuery {
  userId?: number;
  type?: LedgerEntryType;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

function ledgerWhere(query: LedgerQuery): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.userId) (where.push('l.user_id = ?'), params.push(query.userId));
  if (query.type) (where.push('l.entry_type = ?'), params.push(query.type));
  if (query.from) (where.push('l.created_at >= ?'), params.push(istDayStartIso(query.from)));
  if (query.to) (where.push('l.created_at <= ?'), params.push(istDayEndIso(query.to)));
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listLedger(query: LedgerQuery): Page<LedgerEntryDto & { userId: number; userName: string; userEmail: string }> {
  const { clause, params } = ledgerWhere(query);
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM ledger_entries l ${clause}`, ...params)!.n;
  const rows = all<LedgerRow & { full_name: string; email: string }>(
    `SELECT l.*, u.full_name, u.email FROM ledger_entries l JOIN users u ON u.id = l.user_id ${clause}
      ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    ...params,
    query.pageSize,
    (query.page - 1) * query.pageSize,
  );
  return pageOf(
    rows.map((row) => ({ ...toLedgerDto(row), userId: row.user_id, userName: row.full_name, userEmail: row.email })),
    total,
    query.page,
    query.pageSize,
  );
}

/** Account statement for a period: opening/closing balance, totals and every entry in order. */
export function getStatement(userId: number, from: string, to: string, type?: LedgerEntryType) {
  const opening =
    get<{ balance_after: number }>(
      'SELECT balance_after FROM ledger_entries WHERE user_id = ? AND created_at < ? ORDER BY id DESC LIMIT 1',
      userId,
      istDayStartIso(from),
    )?.balance_after ?? 0;
  const rows = all<LedgerRow>(
    `SELECT * FROM ledger_entries WHERE user_id = ? AND created_at >= ? AND created_at <= ? ORDER BY id`,
    userId,
    istDayStartIso(from),
    istDayEndIso(to),
  );
  const closing = rows.length ? rows[rows.length - 1]!.balance_after : opening;
  const filtered = type ? rows.filter((row) => row.entry_type === type) : rows;
  const credits = rows.filter((r) => r.amount > 0).reduce((sum, r) => sum + r.amount, 0);
  const debits = rows.filter((r) => r.amount < 0).reduce((sum, r) => sum - r.amount, 0);
  const byType: Record<string, number> = {};
  for (const row of rows) byType[row.entry_type] = (byType[row.entry_type] ?? 0) + row.amount;
  return {
    from,
    to,
    openingBalance: toRupees(opening),
    closingBalance: toRupees(closing),
    totalCredits: toRupees(credits),
    totalDebits: toRupees(debits),
    totalsByType: Object.fromEntries(Object.entries(byType).map(([key, value]) => [key, toRupees(value)])),
    entries: filtered.map(toLedgerDto),
  };
}
