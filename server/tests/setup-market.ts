import { registerMarketListeners } from '../src/bootstrap.js';
import { initMarket } from '../src/market/engine.js';
import { seedIpos } from '../src/market/seedIpos.js';
import { seedMarket } from '../src/market/seedMarket.js';

/** Seeds one year of market data (and optionally IPOs) and wires listeners, as the server does on startup. */
export async function setupMarket(options: { ipos?: boolean } = {}): Promise<void> {
  await seedMarket({ years: 1, intradayDays: 1 });
  if (options.ipos) await seedIpos();
  await initMarket();
  registerMarketListeners();
}
