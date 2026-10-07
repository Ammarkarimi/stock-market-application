import { all, get } from '../db/index.js';
import { changePercent, toRupees } from '../lib/money.js';
import { addDays } from '../lib/time.js';
import { currentTradingDate } from '../market/engine.js';
import { getQuote, getQuoteBySymbol, type SecurityType } from '../market/quoteStore.js';
import { freeQuantity } from './order.service.js';

interface HoldingRow {
  user_id: number;
  security_id: number;
  quantity: number;
  invested: number;
  realized_pnl: number;
  first_bought_at: string | null;
  symbol: string;
  name: string;
  security_type: SecurityType;
  sector: string | null;
}

export interface HoldingDto {
  symbol: string;
  name: string;
  type: SecurityType;
  sector: string | null;
  quantity: number;
  freeQuantity: number;
  averagePrice: number;
  lastPrice: number;
  prevClose: number;
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  dayChange: number;
  dayChangePercent: number;
  weight: number;
  realizedPnl: number;
  firstBoughtAt: string | null;
}

export interface PortfolioSummary {
  invested: number;
  currentValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  dayPnl: number;
  dayPnlPercent: number;
  realizedPnl: number;
  holdingsCount: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function holdingRows(userId: number, onlyOpen = true): HoldingRow[] {
  return all<HoldingRow>(
    `SELECT h.*, s.symbol, s.name, s.security_type, s.sector FROM holdings h JOIN securities s ON s.id = h.security_id
      WHERE h.user_id = ? ${onlyOpen ? 'AND h.quantity > 0' : ''} ORDER BY s.symbol`,
    userId,
  );
}

/** Holdings valued at live prices (amounts in paise until converted). */
function valuedHoldings(userId: number) {
  return holdingRows(userId).map((row) => {
    const quote = getQuote(row.security_id);
    const last = quote?.last ?? Math.round(row.invested / row.quantity);
    const prevClose = quote?.prevClose ?? last;
    const value = row.quantity * last;
    return { row, last, prevClose, value, dayChange: row.quantity * (last - prevClose) };
  });
}

export function getPortfolio(userId: number) {
  const valued = valuedHoldings(userId);
  const invested = valued.reduce((sum, h) => sum + h.row.invested, 0);
  const currentValue = valued.reduce((sum, h) => sum + h.value, 0);
  const dayPnl = valued.reduce((sum, h) => sum + h.dayChange, 0);
  const previousValue = currentValue - dayPnl;
  const realized =
    get<{ total: number | null }>('SELECT SUM(realized_pnl) AS total FROM holdings WHERE user_id = ?', userId)?.total ?? 0;

  const holdings: HoldingDto[] = valued.map(({ row, last, prevClose, value, dayChange }) => ({
    symbol: row.symbol,
    name: row.name,
    type: row.security_type,
    sector: row.sector,
    quantity: row.quantity,
    freeQuantity: freeQuantity(userId, row.security_id),
    averagePrice: toRupees(Math.round(row.invested / row.quantity)),
    lastPrice: toRupees(last),
    prevClose: toRupees(prevClose),
    invested: toRupees(row.invested),
    currentValue: toRupees(value),
    pnl: toRupees(value - row.invested),
    pnlPercent: changePercent(value, row.invested),
    dayChange: toRupees(dayChange),
    dayChangePercent: changePercent(last, prevClose),
    weight: currentValue ? round2((value / currentValue) * 100) : 0,
    realizedPnl: toRupees(row.realized_pnl),
    firstBoughtAt: row.first_bought_at,
  }));

  const group = (key: (h: HoldingDto) => string) => {
    const totals = new Map<string, number>();
    for (const h of holdings) totals.set(key(h), (totals.get(key(h)) ?? 0) + h.currentValue);
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value: round2(value), weight: currentValue ? round2((value * 100 * 100) / currentValue) : 0 }))
      .sort((a, b) => b.value - a.value);
  };

  const summary: PortfolioSummary = {
    invested: toRupees(invested),
    currentValue: toRupees(currentValue),
    totalPnl: toRupees(currentValue - invested),
    totalPnlPercent: changePercent(currentValue, invested),
    dayPnl: toRupees(dayPnl),
    dayPnlPercent: changePercent(currentValue, previousValue),
    realizedPnl: toRupees(realized),
    holdingsCount: holdings.length,
  };

  return {
    summary,
    holdings,
    allocation: {
      bySecurity: holdings
        .map((h) => ({ name: h.symbol, value: h.currentValue, weight: h.weight }))
        .sort((a, b) => b.value - a.value),
      bySector: group((h) => h.sector ?? 'Other'),
      byType: group((h) => h.type),
    },
  };
}

export function getPosition(userId: number, securityId: number) {
  const row = get<{ quantity: number; invested: number; realized_pnl: number }>(
    'SELECT quantity, invested, realized_pnl FROM holdings WHERE user_id = ? AND security_id = ?',
    userId,
    securityId,
  );
  if (!row || (row.quantity === 0 && row.realized_pnl === 0)) return null;
  const quote = getQuote(securityId);
  const last = quote?.last ?? 0;
  const value = row.quantity * last;
  return {
    quantity: row.quantity,
    freeQuantity: freeQuantity(userId, securityId),
    averagePrice: row.quantity ? toRupees(Math.round(row.invested / row.quantity)) : 0,
    invested: toRupees(row.invested),
    currentValue: toRupees(value),
    pnl: toRupees(value - row.invested),
    pnlPercent: changePercent(value, row.invested),
    realizedPnl: toRupees(row.realized_pnl),
  };
}

export const PERFORMANCE_RANGES = ['1M', '3M', '6M', '1Y', 'ALL'] as const;
export type PerformanceRange = (typeof PERFORMANCE_RANGES)[number];

interface PerformancePoint {
  date: string;
  value: number;
  invested: number;
  benchmark: number | null;
}

/**
 * Rebuilds daily portfolio value by replaying the user's trades against closing prices, so the chart
 * reflects exactly what was held on each day.
 */
export function getPerformance(userId: number, range: PerformanceRange) {
  const trades = all<{ security_id: number; side: 'BUY' | 'SELL'; quantity: number; value: number; trading_date: string }>(
    'SELECT security_id, side, quantity, value, trading_date FROM trades WHERE user_id = ? ORDER BY trading_date, id',
    userId,
  );
  const today = currentTradingDate();
  const days = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365, ALL: 0 }[range];
  const firstTrade = trades[0]?.trading_date ?? today;
  let start = days ? addDays(today, -days) : firstTrade;
  if (start < firstTrade) start = firstTrade;

  const nifty = getQuoteBySymbol('NIFTY50');
  const calendar = nifty
    ? all<{ date: string; close: number }>(
        'SELECT date, close FROM price_history WHERE security_id = ? AND date >= ? AND date < ? ORDER BY date',
        nifty.securityId,
        start,
        today,
      )
    : [];
  const dates = calendar.map((row) => row.date);
  dates.push(today);
  const benchmarkByDate = new Map(calendar.map((row) => [row.date, row.close]));
  if (nifty) benchmarkByDate.set(today, nifty.last);

  const securityIds = [...new Set(trades.map((t) => t.security_id))];
  const closes = new Map<number, Map<string, number>>();
  for (const id of securityIds) {
    const rows = all<{ date: string; close: number }>(
      'SELECT date, close FROM price_history WHERE security_id = ? AND date >= ? ORDER BY date',
      id,
      addDays(start, -10),
    );
    closes.set(id, new Map(rows.map((row) => [row.date, row.close])));
  }

  const position = new Map<number, { quantity: number; cost: number; lastClose: number | null }>();
  let tradeIndex = 0;
  const points: PerformancePoint[] = [];
  for (const date of dates) {
    while (tradeIndex < trades.length && trades[tradeIndex]!.trading_date <= date) {
      const trade = trades[tradeIndex++]!;
      const pos = position.get(trade.security_id) ?? { quantity: 0, cost: 0, lastClose: null };
      if (trade.side === 'BUY') {
        pos.quantity += trade.quantity;
        pos.cost += trade.value;
      } else if (pos.quantity > 0) {
        pos.cost -= Math.round((pos.cost * trade.quantity) / pos.quantity);
        pos.quantity -= trade.quantity;
      }
      position.set(trade.security_id, pos);
    }
    let value = 0;
    let invested = 0;
    for (const [id, pos] of position) {
      if (pos.quantity <= 0) continue;
      const close = date === today ? (getQuote(id)?.last ?? null) : (closes.get(id)?.get(date) ?? null);
      if (close !== null) pos.lastClose = close;
      value += pos.quantity * (pos.lastClose ?? pos.cost / pos.quantity);
      invested += pos.cost;
    }
    const benchmark = benchmarkByDate.get(date);
    points.push({
      date,
      value: toRupees(Math.round(value)),
      invested: toRupees(Math.round(invested)),
      benchmark: benchmark !== undefined ? toRupees(benchmark) : null,
    });
  }

  const first = points.find((p) => p.value > 0);
  const last = points[points.length - 1];
  return {
    range,
    points,
    startValue: first?.value ?? 0,
    endValue: last?.value ?? 0,
  };
}
