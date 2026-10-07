import { onMarketRollover, onMarketTick } from './market/engine.js';
import { checkAlerts } from './services/alert.service.js';
import { expireDayOrders, matchOpenOrders } from './services/order.service.js';

let registered = false;

/** Wires services to market events: order matching and price alerts on every tick, expiry at day rollover. */
export function registerMarketListeners(): void {
  if (registered) return;
  registered = true;
  onMarketTick((changed) => {
    matchOpenOrders(changed);
    checkAlerts(changed);
  });
  onMarketRollover((_previous, next) => expireDayOrders(next));
}
