import { afterCommit, all, get, run, transaction } from '../db/index.js';
import { nowIso } from '../lib/clock.js';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';
import { formatInr, toRupees, toRupeesOrNull } from '../lib/money.js';
import { istDayEndIso, istDayStartIso } from '../lib/time.js';
import { pageOf, type Page } from '../lib/validation.js';
import { currentTradingDate, recordTradeVolume } from '../market/engine.js';
import { circuitLimits, getQuote, getQuoteBySymbol, type LiveQuote } from '../market/quoteStore.js';
import { SYSTEM_ACTOR, type Actor } from './actor.js';
import { audit, listAuditLogs } from './audit.service.js';
import { calculateCharges, chargesToRupees, type ChargeBreakdown } from './charges.js';
import { emitToUser } from './events.js';
import { availableBalance, postLedger } from './funds.service.js';
import { notify } from './notification.service.js';
import { verifyTransactionPin } from './profile.service.js';
import { getSetting } from './settings.service.js';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderValidity = 'DAY' | 'IOC';
export type OrderStatus = 'OPEN' | 'EXECUTED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
export const ORDER_STATUSES: OrderStatus[] = ['OPEN', 'EXECUTED', 'CANCELLED', 'REJECTED', 'EXPIRED'];

interface OrderRow {
  id: number;
  user_id: number;
  security_id: number;
  side: OrderSide;
  order_type: OrderType;
  validity: OrderValidity;
  quantity: number;
  limit_price: number | null;
  status: OrderStatus;
  status_reason: string | null;
  filled_quantity: number;
  average_price: number | null;
  blocked_amount: number;
  trading_date: string;
  created_at: string;
  updated_at: string;
  executed_at: string | null;
  cancelled_at: string | null;
}

interface TradeRow {
  id: number;
  order_id: number | null;
  source: 'ORDER' | 'IPO';
  user_id: number;
  security_id: number;
  side: OrderSide;
  quantity: number;
  price: number;
  value: number;
  brokerage: number;
  stt: number;
  exchange_charges: number;
  sebi_fees: number;
  stamp_duty: number;
  gst: number;
  total_charges: number;
  net_amount: number;
  realized_pnl: number | null;
  trading_date: string;
  executed_at: string;
}

export interface OrderDto {
  id: number;
  symbol: string;
  name: string;
  side: OrderSide;
  orderType: OrderType;
  validity: OrderValidity;
  quantity: number;
  limitPrice: number | null;
  status: OrderStatus;
  statusReason: string | null;
  filledQuantity: number;
  averagePrice: number | null;
  blockedAmount: number;
  lastPrice: number | null;
  tradingDate: string;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
  cancelledAt: string | null;
}

export interface TradeDto {
  id: number;
  orderId: number | null;
  source: 'ORDER' | 'IPO';
  symbol: string;
  name: string;
  side: OrderSide;
  quantity: number;
  price: number;
  value: number;
  charges: Record<keyof ChargeBreakdown, number>;
  netAmount: number;
  realizedPnl: number | null;
  tradingDate: string;
  executedAt: string;
}

type OrderJoinRow = OrderRow & { symbol: string; name: string };
type TradeJoinRow = TradeRow & { symbol: string; name: string };

function toOrderDto(row: OrderJoinRow): OrderDto {
  const quote = getQuote(row.security_id);
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    side: row.side,
    orderType: row.order_type,
    validity: row.validity,
    quantity: row.quantity,
    limitPrice: toRupeesOrNull(row.limit_price),
    status: row.status,
    statusReason: row.status_reason,
    filledQuantity: row.filled_quantity,
    averagePrice: toRupeesOrNull(row.average_price),
    blockedAmount: toRupees(row.blocked_amount),
    lastPrice: quote ? toRupees(quote.last) : null,
    tradingDate: row.trading_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    executedAt: row.executed_at,
    cancelledAt: row.cancelled_at,
  };
}

export function toTradeDto(row: TradeJoinRow): TradeDto {
  return {
    id: row.id,
    orderId: row.order_id,
    source: row.source,
    symbol: row.symbol,
    name: row.name,
    side: row.side,
    quantity: row.quantity,
    price: toRupees(row.price),
    value: toRupees(row.value),
    charges: chargesToRupees({
      brokerage: row.brokerage,
      stt: row.stt,
      exchangeCharges: row.exchange_charges,
      sebiFees: row.sebi_fees,
      stampDuty: row.stamp_duty,
      gst: row.gst,
      total: row.total_charges,
    }),
    netAmount: toRupees(row.net_amount),
    realizedPnl: toRupeesOrNull(row.realized_pnl),
    tradingDate: row.trading_date,
    executedAt: row.executed_at,
  };
}

function loadOrder(orderId: number): OrderJoinRow | undefined {
  return get<OrderJoinRow>(
    'SELECT o.*, s.symbol, s.name FROM orders o JOIN securities s ON s.id = o.security_id WHERE o.id = ?',
    orderId,
  );
}

function orderDtoById(orderId: number): OrderDto {
  return toOrderDto(loadOrder(orderId)!);
}

const sideVerb = (side: OrderSide) => (side === 'BUY' ? 'Buy' : 'Sell');

/** Shares a user holds that are not reserved by open sell orders. */
export function freeQuantity(userId: number, securityId: number, excludeOrderId?: number): number {
  const held =
    get<{ quantity: number }>('SELECT quantity FROM holdings WHERE user_id = ? AND security_id = ?', userId, securityId)
      ?.quantity ?? 0;
  const reserved =
    get<{ q: number | null }>(
      `SELECT SUM(quantity) AS q FROM orders
        WHERE user_id = ? AND security_id = ? AND side = 'SELL' AND status = 'OPEN' AND id != ?`,
      userId,
      securityId,
      excludeOrderId ?? 0,
    )?.q ?? 0;
  return held - reserved;
}

export interface OrderInput {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  /** Limit price in paise (required for LIMIT orders). */
  limitPrice?: number | null;
  validity?: OrderValidity;
}

interface ValidatedOrder {
  quote: LiveQuote;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPrice: number | null;
  validity: OrderValidity;
}

function tradableQuote(symbol: string): LiveQuote {
  const quote = getQuoteBySymbol(symbol);
  if (!quote) throw notFound(`Security ${symbol.toUpperCase()} not found`);
  if (!quote.isTradable) throw badRequest(`${quote.symbol} is an index and cannot be traded`);
  return quote;
}

/** Structural validation; violations are input errors (400) and never create an order. */
function validateInput(input: OrderInput): ValidatedOrder {
  const quote = tradableQuote(input.symbol);
  const maxQuantity = getSetting('trading').maxOrderQuantity;
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw badRequest('Quantity must be a whole number of at least 1');
  if (input.quantity > maxQuantity) throw badRequest(`Quantity cannot exceed ${maxQuantity.toLocaleString('en-IN')} per order`);
  let limitPrice: number | null = null;
  if (input.orderType === 'LIMIT') {
    if (!input.limitPrice || input.limitPrice <= 0) throw badRequest('Limit price is required for limit orders');
    if (input.limitPrice % quote.tickSize !== 0) {
      throw badRequest(`Limit price must be a multiple of the tick size ${formatInr(quote.tickSize)}`);
    }
    limitPrice = input.limitPrice;
  }
  return {
    quote,
    side: input.side,
    orderType: input.orderType,
    quantity: input.quantity,
    limitPrice,
    validity: input.orderType === 'MARKET' ? 'DAY' : (input.validity ?? 'DAY'),
  };
}

function isMarketable(order: { side: OrderSide; orderType: OrderType; limitPrice: number | null }, quote: LiveQuote): boolean {
  if (order.orderType === 'MARKET') return true;
  return order.side === 'BUY' ? order.limitPrice! >= quote.last : order.limitPrice! <= quote.last;
}

export interface OrderPreview {
  symbol: string;
  name: string;
  side: OrderSide;
  orderType: OrderType;
  validity: OrderValidity;
  quantity: number;
  price: number;
  lastPrice: number;
  value: number;
  charges: Record<keyof ChargeBreakdown, number>;
  totalAmount: number;
  availableBalance: number;
  freeQuantity: number;
  marketable: boolean;
  circuit: { lower: number; upper: number };
  canPlace: boolean;
  issues: string[];
}

/** Estimates value, charges and funds impact without placing anything. */
export function previewOrder(userId: number, input: OrderInput): OrderPreview {
  const order = validateInput(input);
  const { quote } = order;
  const marketable = isMarketable(order, quote);
  const price = order.orderType === 'MARKET' || marketable ? quote.last : order.limitPrice!;
  const value = order.quantity * price;
  const charges = calculateCharges(order.side, value);
  const total = order.side === 'BUY' ? value + charges.total : value - charges.total;
  const available = availableBalance(userId);
  const free = freeQuantity(userId, quote.securityId);
  const circuit = circuitLimits(quote);
  const issues: string[] = [];
  if (quote.tradingStatus !== 'ACTIVE') issues.push(`Trading in ${quote.symbol} is currently halted`);
  if (order.limitPrice !== null && (order.limitPrice < circuit.lower || order.limitPrice > circuit.upper)) {
    issues.push(`Limit price must be between ${formatInr(circuit.lower)} and ${formatInr(circuit.upper)}`);
  }
  if (order.side === 'BUY' && total > available) {
    issues.push(`Insufficient funds: ${formatInr(total)} required, ${formatInr(Math.max(0, available))} available`);
  }
  if (order.side === 'SELL' && order.quantity > free) {
    issues.push(`You can sell at most ${Math.max(0, free)} share${free === 1 ? '' : 's'} of ${quote.symbol}`);
  }
  if (order.validity === 'IOC' && !marketable) issues.push('IOC order would be cancelled: the limit price is not marketable');
  return {
    symbol: quote.symbol,
    name: quote.name,
    side: order.side,
    orderType: order.orderType,
    validity: order.validity,
    quantity: order.quantity,
    price: toRupees(price),
    lastPrice: toRupees(quote.last),
    value: toRupees(value),
    charges: chargesToRupees(charges),
    totalAmount: toRupees(total),
    availableBalance: toRupees(available),
    freeQuantity: free,
    marketable,
    circuit: { lower: toRupees(circuit.lower), upper: toRupees(circuit.upper) },
    canPlace: issues.length === 0,
    issues,
  };
}

function emitOrderUpdate(userId: number, orderId: number): void {
  afterCommit(() => {
    emitToUser(userId, 'order', { id: orderId });
    emitToUser(userId, 'portfolio');
  });
}

function rejectOrder(order: OrderRow, symbol: string, reason: string, actor: Actor): void {
  const now = nowIso();
  run(
    "UPDATE orders SET status = 'REJECTED', status_reason = ?, blocked_amount = 0, updated_at = ? WHERE id = ?",
    reason,
    now,
    order.id,
  );
  notify(order.user_id, 'ORDER', 'Order rejected', `${sideVerb(order.side)} ${order.quantity} ${symbol}: ${reason}`, '/orders?tab=history');
  audit({ actor, action: 'ORDER_REJECTED', subjectUserId: order.user_id, entityType: 'ORDER', entityId: order.id, details: { reason } });
  emitOrderUpdate(order.user_id, order.id);
}

/**
 * Executes an order in full at the given price: moves cash through the ledger, updates holdings and
 * records the trade. Must run inside a transaction. Returns false (and rejects the order) when funds
 * or shares are no longer sufficient.
 */
function executeOrder(order: OrderRow, quote: LiveQuote, price: number, actor: Actor, historical?: ExecutionContext): boolean {
  const value = order.quantity * price;
  const charges = calculateCharges(order.side, value);
  const tradingDate = historical?.tradingDate ?? currentTradingDate();
  const now = nowIso();
  let realizedPnl: number | null = null;
  let netAmount: number;

  if (order.side === 'BUY') {
    netAmount = value + charges.total;
    if (availableBalance(order.user_id, order.id) < netAmount) {
      rejectOrder(order, quote.symbol, `Insufficient funds: ${formatInr(netAmount)} required`, actor);
      return false;
    }
    run(
      `INSERT INTO holdings (user_id, security_id, quantity, invested, realized_pnl, first_bought_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(user_id, security_id) DO UPDATE SET quantity = quantity + excluded.quantity,
         invested = invested + excluded.invested, updated_at = excluded.updated_at,
         first_bought_at = CASE WHEN holdings.quantity = 0 THEN excluded.first_bought_at ELSE holdings.first_bought_at END`,
      order.user_id,
      order.security_id,
      order.quantity,
      value,
      now,
      now,
    );
  } else {
    netAmount = value - charges.total;
    const holding = get<{ quantity: number; invested: number }>(
      'SELECT quantity, invested FROM holdings WHERE user_id = ? AND security_id = ?',
      order.user_id,
      order.security_id,
    );
    if (!holding || holding.quantity < order.quantity) {
      rejectOrder(order, quote.symbol, 'Insufficient holdings', actor);
      return false;
    }
    const costRemoved = Math.round((holding.invested * order.quantity) / holding.quantity);
    realizedPnl = value - costRemoved;
    run(
      `UPDATE holdings SET quantity = quantity - ?, invested = invested - ?, realized_pnl = realized_pnl + ?, updated_at = ?
        WHERE user_id = ? AND security_id = ?`,
      order.quantity,
      costRemoved,
      realizedPnl,
      now,
      order.user_id,
      order.security_id,
    );
  }

  // Release the order's own reservation before moving cash.
  run('UPDATE orders SET blocked_amount = 0 WHERE id = ?', order.id);
  const priceText = formatInr(price);
  if (order.side === 'BUY') {
    postLedger(order.user_id, { type: 'BUY', amount: -value, referenceType: 'ORDER', referenceId: order.id, description: `Bought ${order.quantity} ${quote.symbol} @ ${priceText}` });
  } else {
    postLedger(order.user_id, { type: 'SELL', amount: value, referenceType: 'ORDER', referenceId: order.id, description: `Sold ${order.quantity} ${quote.symbol} @ ${priceText}` });
  }
  if (charges.total > 0) {
    postLedger(order.user_id, { type: 'CHARGES', amount: -charges.total, referenceType: 'ORDER', referenceId: order.id, description: `Brokerage & charges for order #${order.id}` });
  }

  const trade = run(
    `INSERT INTO trades (order_id, source, user_id, security_id, side, quantity, price, value, brokerage, stt, exchange_charges,
       sebi_fees, stamp_duty, gst, total_charges, net_amount, realized_pnl, trading_date, executed_at)
     VALUES (?, 'ORDER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    order.id,
    order.user_id,
    order.security_id,
    order.side,
    order.quantity,
    price,
    value,
    charges.brokerage,
    charges.stt,
    charges.exchangeCharges,
    charges.sebiFees,
    charges.stampDuty,
    charges.gst,
    charges.total,
    netAmount,
    realizedPnl,
    tradingDate,
    now,
  );
  run(
    `UPDATE orders SET status = 'EXECUTED', status_reason = NULL, filled_quantity = quantity, average_price = ?,
       blocked_amount = 0, executed_at = ?, updated_at = ? WHERE id = ?`,
    price,
    now,
    now,
    order.id,
  );
  if (!historical) recordTradeVolume(order.security_id, order.quantity, price);

  const verb = order.side === 'BUY' ? 'Bought' : 'Sold';
  const pnlText = realizedPnl !== null ? ` Realized P&L: ${formatInr(realizedPnl)}.` : '';
  notify(
    order.user_id,
    'ORDER',
    'Order executed',
    `${verb} ${order.quantity} ${quote.symbol} at ${priceText}. ${order.side === 'BUY' ? 'Total debit' : 'Net credit'}: ${formatInr(netAmount)}.${pnlText}`,
    `/orders?tab=history`,
  );
  audit({
    actor,
    action: 'ORDER_EXECUTED',
    subjectUserId: order.user_id,
    entityType: 'ORDER',
    entityId: order.id,
    details: { symbol: quote.symbol, side: order.side, quantity: order.quantity, price: toRupees(price), charges: toRupees(charges.total), tradeId: Number(trade.lastInsertRowid) },
  });
  emitOrderUpdate(order.user_id, order.id);
  return true;
}

/**
 * Replays an execution at a past price and trading date. Only used to seed realistic demo history;
 * live orders always execute against the current market.
 */
export interface ExecutionContext {
  tradingDate: string;
  /** Paise. */
  price: number;
}

/** Decides what happens to a freshly placed (or modified) order against the current market. */
function processNewOrder(order: OrderRow, quote: LiveQuote, actor: Actor, historical?: ExecutionContext): void {
  if (quote.tradingStatus !== 'ACTIVE') {
    rejectOrder(order, quote.symbol, `Trading in ${quote.symbol} is halted`, actor);
    return;
  }
  const { lower, upper } = circuitLimits(quote);
  if (order.limit_price !== null && (order.limit_price < lower || order.limit_price > upper)) {
    rejectOrder(order, quote.symbol, `Limit price outside the circuit range ${formatInr(lower)} – ${formatInr(upper)}`, actor);
    return;
  }
  if (historical) {
    executeOrder(order, quote, historical.price, actor, historical);
    return;
  }
  const marketable = isMarketable({ side: order.side, orderType: order.order_type, limitPrice: order.limit_price }, quote);
  if (marketable) {
    executeOrder(order, quote, quote.last, actor);
    return;
  }
  if (order.validity === 'IOC') {
    const now = nowIso();
    run(
      "UPDATE orders SET status = 'CANCELLED', status_reason = ?, cancelled_at = ?, updated_at = ? WHERE id = ?",
      'IOC order could not be executed immediately',
      now,
      now,
      order.id,
    );
    notify(order.user_id, 'ORDER', 'IOC order cancelled', `${sideVerb(order.side)} ${order.quantity} ${quote.symbol} was not marketable and has been cancelled.`, '/orders?tab=history');
    audit({ actor, action: 'ORDER_CANCELLED', subjectUserId: order.user_id, entityType: 'ORDER', entityId: order.id, details: { reason: 'IOC not marketable' } });
    emitOrderUpdate(order.user_id, order.id);
    return;
  }
  if (order.side === 'BUY') {
    const value = order.quantity * order.limit_price!;
    const block = value + calculateCharges('BUY', value).total;
    const available = availableBalance(order.user_id, order.id);
    if (available < block) {
      rejectOrder(order, quote.symbol, `Insufficient funds: ${formatInr(block)} required, ${formatInr(Math.max(0, available))} available`, actor);
      return;
    }
    run('UPDATE orders SET blocked_amount = ?, updated_at = ? WHERE id = ?', block, nowIso(), order.id);
  } else if (freeQuantity(order.user_id, order.security_id, order.id) < order.quantity) {
    rejectOrder(order, quote.symbol, 'Insufficient holdings', actor);
    return;
  }
  emitOrderUpdate(order.user_id, order.id);
}

export async function placeOrder(userId: number, input: OrderInput, pin: string | undefined, actor: Actor): Promise<OrderDto> {
  validateInput(input);
  await verifyTransactionPin(userId, pin, actor, 'ORDER');
  return placeOrderConfirmed(userId, input, actor);
}

/** Places an order whose confirmation (PIN) has already been verified. */
export function placeOrderConfirmed(userId: number, input: OrderInput, actor: Actor, historical?: ExecutionContext): OrderDto {
  const order = validateInput(input);
  return transaction(() => {
    const now = nowIso();
    const result = run(
      `INSERT INTO orders (user_id, security_id, side, order_type, validity, quantity, limit_price, status, trading_date,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
      userId,
      order.quote.securityId,
      order.side,
      order.orderType,
      order.validity,
      order.quantity,
      order.limitPrice,
      historical?.tradingDate ?? currentTradingDate(),
      now,
      now,
    );
    const id = Number(result.lastInsertRowid);
    audit({
      actor,
      action: 'ORDER_PLACED',
      subjectUserId: userId,
      entityType: 'ORDER',
      entityId: id,
      details: {
        symbol: order.quote.symbol,
        side: order.side,
        orderType: order.orderType,
        validity: order.validity,
        quantity: order.quantity,
        limitPrice: toRupeesOrNull(order.limitPrice),
        lastPrice: toRupees(order.quote.last),
      },
    });
    processNewOrder(get<OrderRow>('SELECT * FROM orders WHERE id = ?', id)!, order.quote, actor, historical);
    return orderDtoById(id);
  });
}

function requireOpenOrder(orderId: number, userId: number | null): OrderRow {
  const order = get<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order || (userId !== null && order.user_id !== userId)) throw notFound('Order not found');
  if (order.status !== 'OPEN') throw conflict(`Order is already ${order.status.toLowerCase()} and cannot be changed`);
  return order;
}

export interface OrderModification {
  quantity?: number;
  /** Paise. */
  limitPrice?: number;
  orderType?: OrderType;
}

export async function modifyOrder(
  userId: number,
  orderId: number,
  changes: OrderModification,
  pin: string | undefined,
  actor: Actor,
): Promise<OrderDto> {
  requireOpenOrder(orderId, userId);
  await verifyTransactionPin(userId, pin, actor, 'ORDER_MODIFY');
  return transaction(() => {
    const order = requireOpenOrder(orderId, userId);
    const quote = getQuote(order.security_id)!;
    const orderType = changes.orderType ?? order.order_type;
    const next = validateInput({
      symbol: quote.symbol,
      side: order.side,
      orderType,
      quantity: changes.quantity ?? order.quantity,
      limitPrice: orderType === 'LIMIT' ? (changes.limitPrice ?? order.limit_price) : null,
      validity: order.validity,
    });
    if (quote.tradingStatus !== 'ACTIVE') throw unprocessable('TRADING_HALTED', `Trading in ${quote.symbol} is halted`);
    const { lower, upper } = circuitLimits(quote);
    if (next.limitPrice !== null && (next.limitPrice < lower || next.limitPrice > upper)) {
      throw badRequest(`Limit price must be between ${formatInr(lower)} and ${formatInr(upper)}`);
    }
    const marketable = isMarketable(next, quote);
    const price = marketable ? quote.last : next.limitPrice!;
    if (order.side === 'BUY') {
      const value = next.quantity * price;
      const required = value + calculateCharges('BUY', value).total;
      const available = availableBalance(userId, order.id);
      if (available < required) {
        throw new AppError(422, 'INSUFFICIENT_FUNDS', `Insufficient funds: ${formatInr(required)} required, ${formatInr(Math.max(0, available))} available`);
      }
    } else if (freeQuantity(userId, order.security_id, order.id) < next.quantity) {
      throw new AppError(422, 'INSUFFICIENT_HOLDINGS', 'You do not hold enough free shares for this quantity');
    }

    const before = { orderType: order.order_type, quantity: order.quantity, limitPrice: toRupeesOrNull(order.limit_price) };
    run(
      'UPDATE orders SET order_type = ?, quantity = ?, limit_price = ?, updated_at = ? WHERE id = ?',
      next.orderType,
      next.quantity,
      next.limitPrice,
      nowIso(),
      order.id,
    );
    audit({
      actor,
      action: 'ORDER_MODIFIED',
      subjectUserId: userId,
      entityType: 'ORDER',
      entityId: order.id,
      details: { before, after: { orderType: next.orderType, quantity: next.quantity, limitPrice: toRupeesOrNull(next.limitPrice) } },
    });
    processNewOrder(get<OrderRow>('SELECT * FROM orders WHERE id = ?', order.id)!, quote, actor);
    return orderDtoById(order.id);
  });
}

/** Cancels an open order. Pass userId = null for administrative cancellation. */
export function cancelOrder(orderId: number, userId: number | null, actor: Actor, reason = 'Cancelled by you'): OrderDto {
  return transaction(() => {
    const order = requireOpenOrder(orderId, userId);
    const now = nowIso();
    run(
      "UPDATE orders SET status = 'CANCELLED', status_reason = ?, blocked_amount = 0, cancelled_at = ?, updated_at = ? WHERE id = ?",
      reason,
      now,
      now,
      order.id,
    );
    const symbol = getQuote(order.security_id)?.symbol ?? '';
    notify(order.user_id, 'ORDER', 'Order cancelled', `${sideVerb(order.side)} ${order.quantity} ${symbol} — ${reason}.`, '/orders?tab=history');
    audit({ actor, action: 'ORDER_CANCELLED', subjectUserId: order.user_id, entityType: 'ORDER', entityId: order.id, details: { reason } });
    emitOrderUpdate(order.user_id, order.id);
    return orderDtoById(order.id);
  });
}

/** Executes resting limit orders whose price has been reached. Registered as a market tick listener. */
export function matchOpenOrders(changed: LiveQuote[]): number {
  if (changed.length === 0) return 0;
  const changedIds = new Set(changed.map((q) => q.securityId));
  const candidates = all<OrderRow>("SELECT * FROM orders WHERE status = 'OPEN' AND order_type = 'LIMIT' ORDER BY id").filter(
    (order) => changedIds.has(order.security_id),
  );
  let executed = 0;
  for (const order of candidates) {
    const quote = getQuote(order.security_id);
    if (!quote || quote.tradingStatus !== 'ACTIVE' || order.limit_price === null) continue;
    const crossed = order.side === 'BUY' ? quote.last <= order.limit_price : quote.last >= order.limit_price;
    if (!crossed) continue;
    try {
      transaction(() => {
        const fresh = get<OrderRow>("SELECT * FROM orders WHERE id = ? AND status = 'OPEN'", order.id);
        if (fresh && executeOrder(fresh, quote, fresh.limit_price!, SYSTEM_ACTOR)) executed++;
      });
    } catch (err) {
      console.error(`Failed to execute order ${order.id}`, err);
    }
  }
  return executed;
}

/** Expires DAY orders from previous sessions. Registered as a market rollover listener. */
export function expireDayOrders(newDate: string): number {
  const stale = all<OrderRow & { symbol: string }>(
    `SELECT o.*, s.symbol FROM orders o JOIN securities s ON s.id = o.security_id
      WHERE o.status = 'OPEN' AND o.validity = 'DAY' AND o.trading_date < ?`,
    newDate,
  );
  for (const order of stale) {
    transaction(() => {
      const now = nowIso();
      run(
        "UPDATE orders SET status = 'EXPIRED', status_reason = ?, blocked_amount = 0, updated_at = ? WHERE id = ?",
        'Order expired at the end of the trading day',
        now,
        order.id,
      );
      notify(order.user_id, 'ORDER', 'Order expired', `${sideVerb(order.side)} ${order.quantity} ${order.symbol} expired unexecuted at the end of the trading day.`, '/orders?tab=history');
      audit({ actor: SYSTEM_ACTOR, action: 'ORDER_EXPIRED', subjectUserId: order.user_id, entityType: 'ORDER', entityId: order.id });
      emitOrderUpdate(order.user_id, order.id);
    });
  }
  return stale.length;
}

export interface OrderQuery {
  userId?: number;
  status?: OrderStatus;
  side?: OrderSide;
  symbol?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export function listOrders(query: OrderQuery): Page<OrderDto & { userId: number; userName: string }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.userId) (where.push('o.user_id = ?'), params.push(query.userId));
  if (query.status) (where.push('o.status = ?'), params.push(query.status));
  if (query.side) (where.push('o.side = ?'), params.push(query.side));
  if (query.symbol) (where.push('s.symbol = ?'), params.push(query.symbol));
  if (query.from) (where.push('o.created_at >= ?'), params.push(istDayStartIso(query.from)));
  if (query.to) (where.push('o.created_at <= ?'), params.push(istDayEndIso(query.to)));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM orders o JOIN securities s ON s.id = o.security_id JOIN users u ON u.id = o.user_id';
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n ${from} ${clause}`, ...params)!.n;
  const rows = all<OrderJoinRow & { full_name: string }>(
    `SELECT o.*, s.symbol, s.name, u.full_name ${from} ${clause} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
    ...params,
    query.pageSize,
    (query.page - 1) * query.pageSize,
  );
  return pageOf(
    rows.map((row) => ({ ...toOrderDto(row), userId: row.user_id, userName: row.full_name })),
    total,
    query.page,
    query.pageSize,
  );
}

export function getOrderDetail(orderId: number, userId: number | null) {
  const row = loadOrder(orderId);
  if (!row || (userId !== null && row.user_id !== userId)) throw notFound('Order not found');
  const trade = get<TradeJoinRow>(
    'SELECT t.*, s.symbol, s.name FROM trades t JOIN securities s ON s.id = t.security_id WHERE t.order_id = ?',
    orderId,
  );
  const timeline = listAuditLogs({ entityType: 'ORDER', entityId: String(orderId), page: 1, pageSize: 50 }).items.map((entry) => ({
    action: entry.action,
    createdAt: entry.createdAt,
    actorRole: entry.actorRole,
    details: entry.details,
  }));
  return { order: toOrderDto(row), trade: trade ? toTradeDto(trade) : null, timeline: timeline.reverse() };
}

export interface TradeQuery {
  userId?: number;
  symbol?: string;
  side?: OrderSide;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export function listTrades(query: TradeQuery): Page<TradeDto> & { totals: { buyValue: number; sellValue: number; charges: number; realizedPnl: number } } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.userId) (where.push('t.user_id = ?'), params.push(query.userId));
  if (query.symbol) (where.push('s.symbol = ?'), params.push(query.symbol));
  if (query.side) (where.push('t.side = ?'), params.push(query.side));
  if (query.from) (where.push('t.trading_date >= ?'), params.push(query.from));
  if (query.to) (where.push('t.trading_date <= ?'), params.push(query.to));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM trades t JOIN securities s ON s.id = t.security_id';
  const totals = get<{ n: number; buy: number | null; sell: number | null; charges: number | null; pnl: number | null }>(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN t.side = 'BUY' THEN t.value END) AS buy,
            SUM(CASE WHEN t.side = 'SELL' THEN t.value END) AS sell, SUM(t.total_charges) AS charges,
            SUM(t.realized_pnl) AS pnl ${from} ${clause}`,
    ...params,
  )!;
  const rows = all<TradeJoinRow>(
    `SELECT t.*, s.symbol, s.name ${from} ${clause} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
    ...params,
    query.pageSize,
    (query.page - 1) * query.pageSize,
  );
  return {
    ...pageOf(rows.map(toTradeDto), totals.n, query.page, query.pageSize),
    totals: {
      buyValue: toRupees(totals.buy ?? 0),
      sellValue: toRupees(totals.sell ?? 0),
      charges: toRupees(totals.charges ?? 0),
      realizedPnl: toRupees(totals.pnl ?? 0),
    },
  };
}
