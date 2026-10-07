import { onMarketRollover, onMarketTick } from './market/engine.js';
import { expireDayOrders, matchOpenOrders } from './services/order.service.js';

let registered = false;

/** Wires services to market events: order matching on every tick, expiry at day rollover. */
export function registerMarketListeners(): void {
  if (registered) return;
  registered = true;
  onMarketTick((changed) => matchOpenOrders(changed));
  onMarketRollover((_previous, next) => expireDayOrders(next));
}
