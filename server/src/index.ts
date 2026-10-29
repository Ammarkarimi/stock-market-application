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

/** Set when the desktop app runs this server as an Electron utility process: the channel back to the app. */
interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}
const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;

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
  const onListening = () => {
    // PORT=0 picks a free port: report the real one, and tell the desktop app which address to open.
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    console.log(`StockKaro API listening on http://${config.host ?? 'localhost'}:${port}`);
    parentPort?.postMessage({ type: 'listening', port });
    if (config.seedDemoData && !config.isProduction) {
      console.log(`Demo investor: ${DEMO_ACCOUNTS.investor.email} / ${DEMO_ACCOUNTS.investor.password} (PIN ${DEMO_ACCOUNTS.investor.pin})`);
      console.log(`Demo admin:    ${DEMO_ACCOUNTS.admin.email} / ${DEMO_ACCOUNTS.admin.password} (PIN ${DEMO_ACCOUNTS.admin.pin})`);
    }
  };
  const server = config.host ? app.listen(config.port, config.host, onListening) : app.listen(config.port, onListening);

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log('Shutting down...');
    stopSimulation();
    void stopLiveFeed();
    stopScheduler();
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    server.closeAllConnections(); // live event streams would otherwise hold the server open
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  parentPort?.on('message', (event) => {
    if ((event.data as { type?: string } | null)?.type === 'shutdown') shutdown();
  });
}

main().catch((err) => {
  console.error('Failed to start server', err);
  parentPort?.postMessage({ type: 'error', message: (err as Error).message });
  process.exit(1);
});
