import { createApp } from './app.js';
import { registerMarketListeners } from './bootstrap.js';
import { config } from './config.js';
import { closeDatabase, db } from './db/index.js';
import { istDate } from './lib/time.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { alignTradingDate, initMarket, startSimulation, stopSimulation } from './market/engine.js';
import { startLiveFeed, stopLiveFeed } from './market/liveFeed.js';
import { updateMarketSession } from './market/session.js';
import { seedIpos } from './market/seedIpos.js';
import { seedMarket } from './market/seedMarket.js';
import { DEMO_ACCOUNTS, seedDemoData } from './seed/demo.js';

async function main() {
  db();
  console.log('Preparing market data...');
  seedMarket();
  seedIpos();
  if (config.marketData === 'yahoo') updateMarketSession({ source: 'yahoo', phase: 'CLOSED' });
  initMarket();
  registerMarketListeners();
  if (config.marketData === 'yahoo') {
    console.log('Loading live prices from Yahoo Finance...');
    try {
      await startLiveFeed();
    } catch (err) {
      console.warn(`Live market data unavailable (${(err as Error).message}); using simulated prices instead.`);
      alignTradingDate(istDate());
    }
  }
  if (config.seedDemoData) {
    await seedDemoData();
  }
  if (config.simulationEnabled) startSimulation();
  startScheduler();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`StockSphere API listening on http://localhost:${config.port}`);
    if (config.seedDemoData && !config.isProduction) {
      console.log(`Demo investor: ${DEMO_ACCOUNTS.investor.email} / ${DEMO_ACCOUNTS.investor.password} (PIN ${DEMO_ACCOUNTS.investor.pin})`);
      console.log(`Demo admin:    ${DEMO_ACCOUNTS.admin.email} / ${DEMO_ACCOUNTS.admin.password} (PIN ${DEMO_ACCOUNTS.admin.pin})`);
    }
  });

  const shutdown = () => {
    console.log('Shutting down...');
    stopSimulation();
    void stopLiveFeed();
    stopScheduler();
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
