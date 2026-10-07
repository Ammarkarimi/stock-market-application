import { getTick, useLiveVersion } from '@/live/priceStore';
import type { Portfolio } from '@/lib/types';

const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (current: number, base: number) => (base ? round2(((current - base) / base) * 100) : 0);

/** Re-values holdings with live prices so totals tick in real time. */
export function useLivePortfolio(portfolio: Portfolio | undefined): Portfolio | undefined {
  useLiveVersion();
  if (!portfolio) return undefined;
  const holdings = portfolio.holdings.map((h) => {
    const tick = getTick(h.symbol);
    if (!tick) return h;
    const currentValue = round2(h.quantity * tick.lastPrice);
    return {
      ...h,
      lastPrice: tick.lastPrice,
      currentValue,
      pnl: round2(currentValue - h.invested),
      pnlPercent: pct(currentValue, h.invested),
      dayChange: round2(h.quantity * (tick.lastPrice - h.prevClose)),
      dayChangePercent: pct(tick.lastPrice, h.prevClose),
    };
  });
  const invested = holdings.reduce((s, h) => s + h.invested, 0);
  const currentValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const dayPnl = holdings.reduce((s, h) => s + h.dayChange, 0);
  return {
    ...portfolio,
    holdings: holdings.map((h) => ({ ...h, weight: currentValue ? round2((h.currentValue / currentValue) * 100) : 0 })),
    summary: {
      ...portfolio.summary,
      invested: round2(invested),
      currentValue: round2(currentValue),
      totalPnl: round2(currentValue - invested),
      totalPnlPercent: pct(currentValue, invested),
      dayPnl: round2(dayPnl),
      dayPnlPercent: pct(currentValue, currentValue - dayPnl),
    },
  };
}
