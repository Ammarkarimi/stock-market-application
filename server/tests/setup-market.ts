import { registerMarketListeners } from '../src/bootstrap.js';
import { initMarket } from '../src/market/engine.js';
import { seedMarket } from '../src/market/seedMarket.js';

/** Seeds one year of market data and wires order matching, as the server does on startup. */
export function setupMarket(): void {
  seedMarket({ years: 1, intradayDays: 1 });
  initMarket();
  registerMarketListeners();
}
