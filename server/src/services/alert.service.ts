import { afterCommit, all, get, run, transaction } from '../db/index.js';
import { nowIso } from '../lib/clock.js';
import { badRequest, notFound, unprocessable } from '../lib/errors.js';
import { formatInr, toRupees, toRupeesOrNull } from '../lib/money.js';
import { getQuote, getQuoteBySymbol, type LiveQuote } from '../market/quoteStore.js';
import { SYSTEM_ACTOR, type Actor } from './actor.js';
import { audit } from './audit.service.js';
import { emitToUser } from './events.js';
import { notify } from './notification.service.js';

export const MAX_ACTIVE_ALERTS = 50;
export type AlertCondition = 'ABOVE' | 'BELOW';
export type AlertStatus = 'ACTIVE' | 'TRIGGERED' | 'DISABLED';

interface AlertRow {
  id: number;
  user_id: number;
  security_id: number;
  condition: AlertCondition;
  target_price: number;
  status: AlertStatus;
  note: string | null;
  triggered_price: number | null;
  triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertDto {
  id: number;
  symbol: string;
  name: string;
  condition: AlertCondition;
  targetPrice: number;
  status: AlertStatus;
  note: string | null;
  lastPrice: number | null;
  /** Percentage move still needed to reach the target. */
  distancePercent: number | null;
  triggeredPrice: number | null;
  triggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDto(row: AlertRow): AlertDto {
  const quote = getQuote(row.security_id)!;
  return {
    id: row.id,
    symbol: quote.symbol,
    name: quote.name,
    condition: row.condition,
    targetPrice: toRupees(row.target_price),
    status: row.status,
    note: row.note,
    lastPrice: toRupees(quote.last),
    distancePercent: Math.round(((row.target_price - quote.last) / quote.last) * 10000) / 100,
    triggeredPrice: toRupeesOrNull(row.triggered_price),
    triggeredAt: row.triggered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireAlert(userId: number, id: number): AlertRow {
  const row = get<AlertRow>('SELECT * FROM price_alerts WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Alert not found');
  return row;
}

/** An alert must be set on the side of the current price that it waits for. */
function validateTarget(quote: LiveQuote, condition: AlertCondition, target: number): void {
  if (condition === 'ABOVE' && target <= quote.last) {
    throw badRequest(`For an "above" alert the target must be higher than the current price ${formatInr(quote.last)}`);
  }
  if (condition === 'BELOW' && target >= quote.last) {
    throw badRequest(`For a "below" alert the target must be lower than the current price ${formatInr(quote.last)}`);
  }
}

function ensureCapacity(userId: number): void {
  const active = get<{ n: number }>("SELECT COUNT(*) AS n FROM price_alerts WHERE user_id = ? AND status = 'ACTIVE'", userId)!.n;
  if (active >= MAX_ACTIVE_ALERTS) throw unprocessable('LIMIT_REACHED', `You can have at most ${MAX_ACTIVE_ALERTS} active alerts`);
}

export function listAlerts(userId: number, query: { status?: AlertStatus; symbol?: string } = {}): AlertDto[] {
  const where = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (query.status) (where.push('status = ?'), params.push(query.status));
  if (query.symbol) {
    const quote = getQuoteBySymbol(query.symbol);
    if (!quote) return [];
    where.push('security_id = ?');
    params.push(quote.securityId);
  }
  return all<AlertRow>(`SELECT * FROM price_alerts WHERE ${where.join(' AND ')} ORDER BY status = 'ACTIVE' DESC, id DESC`, ...params).map(toDto);
}

export interface AlertInput {
  symbol: string;
  condition: AlertCondition;
  /** Paise. */
  targetPrice: number;
  note?: string | null;
}

export function createAlert(userId: number, input: AlertInput, actor: Actor): AlertDto {
  const quote = getQuoteBySymbol(input.symbol);
  if (!quote) throw notFound(`Security ${input.symbol.toUpperCase()} not found`);
  validateTarget(quote, input.condition, input.targetPrice);
  return transaction(() => {
    ensureCapacity(userId);
    const now = nowIso();
    const id = Number(
      run(
        `INSERT INTO price_alerts (user_id, security_id, condition, target_price, status, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        userId,
        quote.securityId,
        input.condition,
        input.targetPrice,
        input.note?.trim() || null,
        now,
        now,
      ).lastInsertRowid,
    );
    audit({ actor, action: 'ALERT_CREATED', subjectUserId: userId, entityType: 'ALERT', entityId: id, details: { symbol: quote.symbol, condition: input.condition, targetPrice: toRupees(input.targetPrice) } });
    afterCommit(() => emitToUser(userId, 'alert'));
    return toDto(requireAlert(userId, id));
  });
}

export interface AlertUpdate {
  status?: 'ACTIVE' | 'DISABLED';
  condition?: AlertCondition;
  targetPrice?: number;
  note?: string | null;
}

/** Edits an alert. Setting status ACTIVE re-arms a triggered or disabled alert. */
export function updateAlert(userId: number, id: number, update: AlertUpdate, actor: Actor): AlertDto {
  return transaction(() => {
    const row = requireAlert(userId, id);
    const quote = getQuote(row.security_id)!;
    const condition = update.condition ?? row.condition;
    const target = update.targetPrice ?? row.target_price;
    const status = update.status ?? (row.status === 'TRIGGERED' && (update.targetPrice || update.condition) ? 'ACTIVE' : row.status);
    if (status === 'ACTIVE') {
      validateTarget(quote, condition, target);
      if (row.status !== 'ACTIVE') ensureCapacity(userId);
    }
    run(
      `UPDATE price_alerts SET condition = ?, target_price = ?, status = ?, note = ?, updated_at = ?,
         triggered_price = CASE WHEN ? = 'ACTIVE' THEN NULL ELSE triggered_price END,
         triggered_at = CASE WHEN ? = 'ACTIVE' THEN NULL ELSE triggered_at END
       WHERE id = ?`,
      condition,
      target,
      status,
      update.note === undefined ? row.note : update.note?.trim() || null,
      nowIso(),
      status,
      status,
      id,
    );
    audit({ actor, action: 'ALERT_UPDATED', subjectUserId: userId, entityType: 'ALERT', entityId: id, details: { status, condition, targetPrice: toRupees(target) } });
    afterCommit(() => emitToUser(userId, 'alert'));
    return toDto(requireAlert(userId, id));
  });
}

export function deleteAlert(userId: number, id: number, actor: Actor): void {
  transaction(() => {
    const row = requireAlert(userId, id);
    run('DELETE FROM price_alerts WHERE id = ?', id);
    audit({ actor, action: 'ALERT_DELETED', subjectUserId: userId, entityType: 'ALERT', entityId: id, details: { symbol: getQuote(row.security_id)?.symbol } });
    afterCommit(() => emitToUser(userId, 'alert'));
  });
}

/** Triggers alerts whose condition is met by the latest prices. Registered as a market tick listener. */
export function checkAlerts(changed: LiveQuote[]): number {
  if (changed.length === 0) return 0;
  const ids = new Set(changed.map((q) => q.securityId));
  const active = all<AlertRow>("SELECT * FROM price_alerts WHERE status = 'ACTIVE'").filter((a) => ids.has(a.security_id));
  let triggered = 0;
  for (const alert of active) {
    const quote = getQuote(alert.security_id);
    if (!quote) continue;
    const hit = alert.condition === 'ABOVE' ? quote.last >= alert.target_price : quote.last <= alert.target_price;
    if (!hit) continue;
    transaction(() => {
      const now = nowIso();
      run(
        "UPDATE price_alerts SET status = 'TRIGGERED', triggered_price = ?, triggered_at = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'",
        quote.last,
        now,
        now,
        alert.id,
      );
      const direction = alert.condition === 'ABOVE' ? 'risen above' : 'fallen below';
      notify(
        alert.user_id,
        'PRICE_ALERT',
        `${quote.symbol} price alert`,
        `${quote.symbol} has ${direction} ${formatInr(alert.target_price)}. Current price: ${formatInr(quote.last)}.${alert.note ? ` Note: ${alert.note}` : ''}`,
        `/stocks/${encodeURIComponent(quote.symbol)}`,
      );
      audit({ actor: SYSTEM_ACTOR, action: 'ALERT_TRIGGERED', subjectUserId: alert.user_id, entityType: 'ALERT', entityId: alert.id, details: { symbol: quote.symbol, price: toRupees(quote.last) } });
      afterCommit(() => emitToUser(alert.user_id, 'alert'));
    });
    triggered++;
  }
  return triggered;
}
