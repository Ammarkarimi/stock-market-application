import { createApp } from './app.js';
import { config } from './config.js';
import { closeDatabase } from './db/index.js';
import { prepareServer } from './market/runtime.js';

/** Long-running server for local development and Docker. On Vercel, api/index.mjs serves the same app. */
async function main() {
  console.log('Preparing market data...');
  await prepareServer();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`StockKaro API listening on http://localhost:${config.port}`);
  });

  const shutdown = () => {
    console.log('Shutting down...');
    server.close(() => {
      void closeDatabase().finally(() => process.exit(0));
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
