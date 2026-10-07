import { createApp } from './app.js';
import { config } from './config.js';
import { closeDatabase, db } from './db/index.js';

function main() {
  db();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`StockSphere API listening on http://localhost:${config.port}`);
  });

  const shutdown = () => {
    console.log('Shutting down...');
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
