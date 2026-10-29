import fs from 'node:fs';
import { config } from '../config.js';

/** Deletes the local PGlite database so the next start re-seeds market and demo data. */
if (config.databaseUrl) {
  console.error('DATABASE_URL is set: db:reset only deletes the local development database. Unset it to reset that one.');
  process.exit(1);
}
if (config.databasePath !== ':memory:' && fs.existsSync(config.databasePath)) {
  fs.rmSync(config.databasePath, { recursive: true });
  console.log(`Removed ${config.databasePath}`);
}
console.log('Database reset. Start the server to seed fresh data.');
