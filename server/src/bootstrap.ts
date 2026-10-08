import { onMarketRollover, onMarketTick } from './market/engine.js';
import { isLiveSource, isMarketOpen } from './market/session.js';
import { checkAlerts } from './services/alert.service.js';
import { expireDayOrders, matchOpenOrders } from './services/order.service.js';

let registered = false;

/**
 * Wires services to market events: order matching (while the market is open) and price alerts on every
 * tick, and expiry at the simulated day rollover. A live feed expires orders itself when the session closes.
 */
export function registerMarketListeners(): void {
  if (registered) return;
  registered = true;
  onMarketTick((changed) => {
    if (isMarketOpen()) matchOpenOrders(changed);
    checkAlerts(changed);
  });
  onMarketRollover((_previous, next) => {
    if (!isLiveSource()) expireDayOrders(next);
  });
}
