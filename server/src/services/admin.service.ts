import { all, get, run, transaction } from '../db/index.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { toPaise, toRupees } from '../lib/money.js';
import { addDays, istDate, istDayStartIso } from '../lib/time.js';
import { pageOf, type Page } from '../lib/validation.js';
import { isExternallyPriced, setPrice } from '../market/engine.js';
import { getQuote, getQuoteBySymbol, reloadQuote, toQuoteDto, type SecurityType } from '../market/quoteStore.js';
import { tickSizeFor } from '../market/seedMarket.js';
import type { Actor } from './actor.js';
import { audit, listAuditLogs } from './audit.service.js';
import { getFundsSummary } from './funds.service.js';
import { ipoStatus, listMyApplications, type IpoRow } from './ipo.service.js';
import { getMarketBreadth, getMarketStatus, invalidateSecurityCache } from './market.service.js';
import { notify, notifyAllUsers } from './notification.service.js';
import { cancelOrder, listOrders } from './order.service.js';
import { getPortfolio } from './portfolio.service.js';
import { getBankAccount } from './profile.service.js';
import { countActiveSessions, listActiveSessions, revokeUserSessions } from './session.service.js';
import { findUserById, toUserDto, type UserDto } from './user.repository.js';

const sum = async (sql: string, ...params: unknown[]) => (await get<{ v: number | null }>(sql, ...params))?.v ?? 0;
const count = async (sql: string, ...params: unknown[]) => (await get<{ n: number }>(sql, ...params))?.n ?? 0;

/** Total market value of every user's holdings at live prices (paise). */
async function totalHoldingsValue(): Promise<number> {
  return (await all<{ security_id: number; qty: number }>('SELECT security_id, SUM(quantity) AS qty FROM holdings GROUP BY security_id')).reduce(
    (total, row) => total + row.qty * (getQuote(row.security_id)?.last ?? 0),
    0,
  );
}

export async function getAdminOverview() {
  const today = istDate();
  const todayStart = istDayStartIso(today);
  const weekStart = istDayStartIso(addDays(today, -6));
  const ipos = await all<IpoRow>('SELECT * FROM ipos');

  const daily = [];
  for (let i = 13; i >= 0; i--) {
    const date = addDays(today, -i);
    const start = istDayStartIso(date);
    const end = istDayStartIso(addDays(date, 1));
    daily.push({
      date,
      trades: (await count('SELECT COUNT(*) AS n FROM trades WHERE executed_at >= ? AND executed_at < ?', start, end)),
      turnover: toRupees((await sum('SELECT SUM(value) AS v FROM trades WHERE executed_at >= ? AND executed_at < ?', start, end))),
      newUsers: (await count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?', start, end)),
    });
  }

  return {
    users: {
      total: (await count('SELECT COUNT(*) AS n FROM users')),
      active: (await count("SELECT COUNT(*) AS n FROM users WHERE status = 'ACTIVE'")),
      suspended: (await count("SELECT COUNT(*) AS n FROM users WHERE status = 'SUSPENDED'")),
      admins: (await count("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN'")),
      newToday: (await count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', todayStart)),
      newThisWeek: (await count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', weekStart)),
    },
    sessions: { active: (await countActiveSessions()) },
    orders: {
      today: (await count('SELECT COUNT(*) AS n FROM orders WHERE created_at >= ?', todayStart)),
      executedToday: (await count("SELECT COUNT(*) AS n FROM orders WHERE status = 'EXECUTED' AND executed_at >= ?", todayStart)),
      rejectedToday: (await count("SELECT COUNT(*) AS n FROM orders WHERE status = 'REJECTED' AND created_at >= ?", todayStart)),
      open: (await count("SELECT COUNT(*) AS n FROM orders WHERE status = 'OPEN'")),
    },
    trading: {
      tradesToday: (await count('SELECT COUNT(*) AS n FROM trades WHERE executed_at >= ?', todayStart)),
      turnoverToday: toRupees((await sum('SELECT SUM(value) AS v FROM trades WHERE executed_at >= ?', todayStart))),
      chargesToday: toRupees((await sum('SELECT SUM(total_charges) AS v FROM trades WHERE executed_at >= ?', todayStart))),
      chargesTotal: toRupees((await sum('SELECT SUM(total_charges) AS v FROM trades'))),
    },
    funds: {
      totalCash: toRupees((await sum('SELECT SUM(cash_balance) AS v FROM accounts'))),
      holdingsValue: toRupees((await totalHoldingsValue())),
      depositsToday: toRupees((await sum("SELECT SUM(amount) AS v FROM fund_transactions WHERE txn_type = 'DEPOSIT' AND created_at >= ?", todayStart))),
      withdrawalsToday: toRupees((await sum("SELECT SUM(amount) AS v FROM fund_transactions WHERE txn_type = 'WITHDRAWAL' AND created_at >= ?", todayStart))),
      blockedForOrders: toRupees((await sum("SELECT SUM(blocked_amount) AS v FROM orders WHERE status = 'OPEN'"))),
      blockedForIpos: toRupees((await sum("SELECT SUM(blocked_amount) AS v FROM ipo_applications WHERE status = 'APPLIED'"))),
    },
    ipos: {
      upcoming: ipos.filter((ipo) => ipoStatus(ipo) === 'UPCOMING').length,
      open: ipos.filter((ipo) => ipoStatus(ipo) === 'OPEN').length,
      awaitingAllotment: ipos.filter((ipo) => ipoStatus(ipo) === 'CLOSED').length,
      pendingApplications: (await count("SELECT COUNT(*) AS n FROM ipo_applications WHERE status = 'APPLIED'")),
    },
    market: { status: getMarketStatus(), breadth: getMarketBreadth() },
    daily,
    recentActivity: (await listAuditLogs({ page: 1, pageSize: 12 })).items,
  };
}

export interface AdminUserListItem extends UserDto {
  cashBalance: number;
  holdingsCount: number;
  ordersCount: number;
  locked: boolean;
}

export async function listUsers(query: { q?: string; status?: 'ACTIVE' | 'SUSPENDED'; role?: 'USER' | 'ADMIN'; page: number; pageSize: number }): Promise<Page<AdminUserListItem>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.q) {
    where.push('(u.email LIKE ? OR u.full_name LIKE ? OR u.phone LIKE ?)');
    const like = `%${query.q}%`;
    params.push(like, like, like);
  }
  if (query.status) (where.push('u.status = ?'), params.push(query.status));
  if (query.role) (where.push('u.role = ?'), params.push(query.role));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await count(`SELECT COUNT(*) AS n FROM users u ${clause}`, ...params);
  const rows = await all<Parameters<typeof toUserDto>[0] & { cash_balance: number; holdings_count: number; orders_count: number }>(
    `SELECT u.*, a.cash_balance,
            (SELECT COUNT(*) FROM holdings h WHERE h.user_id = u.id AND h.quantity > 0) AS holdings_count,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders_count
       FROM users u LEFT JOIN accounts a ON a.user_id = u.id ${clause}
      ORDER BY u.id DESC LIMIT ? OFFSET ?`,
    ...params,
    query.pageSize,
    (query.page - 1) * query.pageSize,
  );
  const now = nowMs();
  return pageOf(
    rows.map((row) => ({
      ...toUserDto(row),
      cashBalance: toRupees(row.cash_balance ?? 0),
      holdingsCount: row.holdings_count,
      ordersCount: row.orders_count,
      locked: Boolean(row.locked_until && Date.parse(row.locked_until) > now),
    })),
    total,
    query.page,
    query.pageSize,
  );
}

async function requireUser(userId: number) {
  const user = await findUserById(userId);
  if (!user) throw notFound('User not found');
  return user;
}

export async function getUserDetail(userId: number) {
  const user = await requireUser(userId);
  const portfolio = await getPortfolio(userId);
  return {
    user: toUserDto(user),
    security: {
      failedLoginAttempts: user.failed_login_attempts,
      lockedUntil: user.locked_until,
      pinLockedUntil: user.pin_locked_until,
      passwordChangedAt: user.password_changed_at,
    },
    bankAccount: (await getBankAccount(userId)),
    funds: (await getFundsSummary(userId)),
    portfolio: { summary: portfolio.summary, holdings: portfolio.holdings },
    orders: (await listOrders({ userId, page: 1, pageSize: 10 })).items,
    ipoApplications: (await listMyApplications(userId)),
    sessions: (await listActiveSessions(userId)),
    activity: (await listAuditLogs({ subjectUserId: userId, page: 1, pageSize: 20 })).items,
  };
}

export function setUserStatus(userId: number, status: 'ACTIVE' | 'SUSPENDED', reason: string, actor: Actor) {
  if (userId === actor.userId) throw badRequest('You cannot change the status of your own account');
  return transaction(async () => {
    const user = await requireUser(userId);
    if (user.status === status) throw conflict(`User is already ${status.toLowerCase()}`);
    await run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), userId);
    let cancelledOrders = 0;
    let revokedSessions = 0;
    if (status === 'SUSPENDED') {
      revokedSessions = await revokeUserSessions(userId, 'USER_SUSPENDED');
      for (const order of await all<{ id: number }>("SELECT id FROM orders WHERE user_id = ? AND status = 'OPEN'", userId)) {
        await cancelOrder(order.id, null, actor, 'Cancelled because the account was suspended');
        cancelledOrders++;
      }
    }
    await notify(
      userId,
      'SECURITY',
      status === 'SUSPENDED' ? 'Account suspended' : 'Account reactivated',
      status === 'SUSPENDED' ? `Your account was suspended. Reason: ${reason}` : 'Your account has been reactivated. You can sign in again.',
    );
    await audit({
      actor,
      action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
      subjectUserId: userId,
      entityType: 'USER',
      entityId: userId,
      details: { reason, revokedSessions, cancelledOrders },
    });
    return toUserDto((await requireUser(userId)));
  });
}

export function setUserRole(userId: number, role: 'USER' | 'ADMIN', actor: Actor) {
  if (userId === actor.userId) throw badRequest('You cannot change your own role');
  return transaction(async () => {
    const user = await requireUser(userId);
    if (user.role === role) throw conflict(`User already has the ${role.toLowerCase()} role`);
    await run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', role, nowIso(), userId);
    await revokeUserSessions(userId, 'ROLE_CHANGED');
    await audit({ actor, action: 'USER_ROLE_CHANGED', subjectUserId: userId, entityType: 'USER', entityId: userId, details: { from: user.role, to: role } });
    return toUserDto((await requireUser(userId)));
  });
}

export function unlockUser(userId: number, actor: Actor) {
  return transaction(async () => {
    await requireUser(userId);
    await run(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, pin_failed_attempts = 0, pin_locked_until = NULL,
         updated_at = ? WHERE id = ?`,
      nowIso(),
      userId,
    );
    await audit({ actor, action: 'USER_UNLOCKED', subjectUserId: userId, entityType: 'USER', entityId: userId });
    return toUserDto((await requireUser(userId)));
  });
}

export async function signOutUserEverywhere(userId: number, actor: Actor): Promise<number> {
  await requireUser(userId);
  const revoked = await revokeUserSessions(userId, 'REVOKED_BY_ADMIN');
  await audit({ actor, action: 'USER_SESSIONS_REVOKED', subjectUserId: userId, entityType: 'USER', entityId: userId, details: { revoked } });
  return revoked;
}

interface SecurityRow {
  id: number;
  symbol: string;
  security_type: SecurityType;
  trading_status: 'ACTIVE' | 'HALTED';
}

async function requireSecurity(symbol: string): Promise<SecurityRow> {
  const row = await get<SecurityRow>('SELECT id, symbol, security_type, trading_status FROM securities WHERE symbol = ?', symbol);
  if (!row) throw notFound(`Security ${symbol.toUpperCase()} not found`);
  return row;
}

export interface SecurityInput {
  symbol: string;
  name: string;
  type: Exclude<SecurityType, 'INDEX'>;
  sector?: string | null;
  industry?: string | null;
  description?: string | null;
  foundedYear?: number | null;
  headquarters?: string | null;
  /** Rupees. */
  price: number;
  faceValue?: number | null;
  sharesOutstanding?: number | null;
  eps?: number | null;
  bookValue?: number | null;
  dividendPerShare?: number | null;
  roe?: number | null;
  debtToEquity?: number | null;
  beta?: number | null;
  revenueCr?: number | null;
  netProfitCr?: number | null;
  expenseRatio?: number | null;
  circuitPct?: number;
  volatility?: number;
  avgVolume?: number;
}

const paiseOrNull = (value: number | null | undefined) => (value === null || value === undefined ? value : toPaise(value));

function securityColumns(input: Partial<SecurityInput>): Record<string, unknown> {
  return {
    name: input.name,
    sector: input.sector,
    industry: input.industry,
    description: input.description,
    founded_year: input.foundedYear,
    headquarters: input.headquarters,
    face_value: paiseOrNull(input.faceValue),
    shares_outstanding: input.sharesOutstanding,
    eps: paiseOrNull(input.eps),
    book_value: paiseOrNull(input.bookValue),
    dividend_per_share: paiseOrNull(input.dividendPerShare),
    roe: input.roe,
    debt_to_equity: input.debtToEquity,
    beta: input.beta,
    revenue_cr: input.revenueCr,
    net_profit_cr: input.netProfitCr,
    expense_ratio: input.expenseRatio,
    circuit_pct: input.circuitPct,
    volatility: input.volatility,
    avg_volume: input.avgVolume,
  };
}

export async function createSecurity(input: SecurityInput, actor: Actor) {
  if ((await get('SELECT 1 FROM securities WHERE symbol = ?', input.symbol)) || (await get('SELECT 1 FROM ipos WHERE symbol = ? AND listed_at IS NULL', input.symbol))) {
    throw conflict(`Symbol ${input.symbol} is already in use`);
  }
  return transaction(async () => {
    const now = nowIso();
    const tick = tickSizeFor(input.price);
    const price = Math.round(toPaise(input.price) / tick) * tick;
    const columns = Object.fromEntries(
      Object.entries({
        ...securityColumns(input),
        symbol: input.symbol,
        security_type: input.type,
        exchange: 'NSE',
        tick_size: tick,
        listing_date: istDate(),
        circuit_pct: input.circuitPct ?? 20,
        volatility: input.volatility ?? 0.3,
        avg_volume: input.avgVolume ?? 100_000,
        created_at: now,
        updated_at: now,
      }).filter(([, value]) => value !== undefined),
    );
    const keys = Object.keys(columns);
    const id = Number(
      (await run(`INSERT INTO securities (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...keys.map((k) => columns[k])))
        .lastInsertRowid,
    );
    await run(
      `INSERT INTO quotes (security_id, last_price, prev_close, open, high, low, volume, turnover, trading_date, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      id,
      price,
      price,
      price,
      price,
      price,
      getQuoteBySymbol('NIFTY50')?.tradingDate ?? istDate(),
      now,
    );
    await audit({ actor, action: 'SECURITY_CREATED', subjectUserId: null, entityType: 'SECURITY', entityId: id, details: { symbol: input.symbol, name: input.name, price: input.price } });
    await invalidateSecurityCache();
    return toQuoteDto((await reloadQuote(id))!);
  });
}

export async function updateSecurity(symbol: string, input: Partial<SecurityInput>, actor: Actor) {
  const security = await requireSecurity(symbol);
  const columns = Object.fromEntries(Object.entries(securityColumns(input)).filter(([, value]) => value !== undefined));
  const keys = Object.keys(columns);
  if (keys.length === 0) throw badRequest('Nothing to update');
  return transaction(async () => {
    await run(
      `UPDATE securities SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...keys.map((key) => columns[key]),
      nowIso(),
      security.id,
    );
    await audit({ actor, action: 'SECURITY_UPDATED', subjectUserId: null, entityType: 'SECURITY', entityId: security.id, details: { symbol: security.symbol, fields: keys } });
    await invalidateSecurityCache();
    return toQuoteDto((await reloadQuote(security.id))!);
  });
}

/** Halts or resumes trading; holders are notified. */
export async function setTradingStatus(symbol: string, status: 'ACTIVE' | 'HALTED', reason: string, actor: Actor) {
  const security = await requireSecurity(symbol);
  if (security.security_type === 'INDEX') throw badRequest('Indices are not traded');
  if (security.trading_status === status) throw conflict(`Trading is already ${status === 'ACTIVE' ? 'active' : 'halted'}`);
  return transaction(async () => {
    await run('UPDATE securities SET trading_status = ?, updated_at = ? WHERE id = ?', status, nowIso(), security.id);
    const holders = await all<{ user_id: number }>('SELECT user_id FROM holdings WHERE security_id = ? AND quantity > 0', security.id);
    for (const holder of holders) {
      await notify(
        holder.user_id,
        'SYSTEM',
        status === 'HALTED' ? `Trading halted in ${security.symbol}` : `Trading resumed in ${security.symbol}`,
        status === 'HALTED' ? `Trading in ${security.symbol} has been suspended. Reason: ${reason}` : `${security.symbol} is trading normally again.`,
        `/stocks/${encodeURIComponent(security.symbol)}`,
      );
    }
    await audit({
      actor,
      action: status === 'HALTED' ? 'TRADING_HALTED' : 'TRADING_RESUMED',
      subjectUserId: null,
      entityType: 'SECURITY',
      entityId: security.id,
      details: { symbol: security.symbol, reason, holdersNotified: holders.length },
    });
    return toQuoteDto((await reloadQuote(security.id))!);
  });
}

/** Moves a security to a specific price (useful for demonstrating limit orders and alerts). */
export async function setSecurityPrice(symbol: string, price: number, actor: Actor) {
  const security = await requireSecurity(symbol);
  if (security.security_type === 'INDEX') throw badRequest('Index values are derived from their constituents');
  if (isExternallyPriced(security.id)) throw badRequest(`${security.symbol} is priced by the live market feed`);
  const quote = await setPrice(security.id, toPaise(price));
  await audit({ actor, action: 'SECURITY_PRICE_SET', subjectUserId: null, entityType: 'SECURITY', entityId: security.id, details: { symbol: security.symbol, requested: price, applied: toRupees(quote.last) } });
  return toQuoteDto(quote);
}

export async function sendAnnouncement(title: string, message: string, link: string | null, actor: Actor) {
  const delivered = await transaction(() => notifyAllUsers('SYSTEM', title, message, link));
  await audit({ actor, action: 'ANNOUNCEMENT_SENT', subjectUserId: null, entityType: 'ANNOUNCEMENT', details: { title, delivered } });
  return { delivered };
}

export async function listAllFundTransactions(query: { userId?: number; type?: 'DEPOSIT' | 'WITHDRAWAL'; page: number; pageSize: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.userId) (where.push('f.user_id = ?'), params.push(query.userId));
  if (query.type) (where.push('f.txn_type = ?'), params.push(query.type));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await count(`SELECT COUNT(*) AS n FROM fund_transactions f ${clause}`, ...params);
  const rows = await all<{ id: number; user_id: number; txn_type: string; amount: number; method: string; status: string; reference: string; bank_account: string | null; created_at: string; full_name: string; email: string }>(
    `SELECT f.*, u.full_name, u.email FROM fund_transactions f JOIN users u ON u.id = f.user_id ${clause} ORDER BY f.id DESC LIMIT ? OFFSET ?`,
    ...params,
    query.pageSize,
    (query.page - 1) * query.pageSize,
  );
  return pageOf(
    rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.full_name,
      userEmail: row.email,
      type: row.txn_type,
      amount: toRupees(row.amount),
      method: row.method,
      status: row.status,
      reference: row.reference,
      bankAccount: row.bank_account,
      createdAt: row.created_at,
    })),
    total,
    query.page,
    query.pageSize,
  );
}
