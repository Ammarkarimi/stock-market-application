import fs from 'node:fs';
import { config } from '../config.js';

/** Deletes the local SQLite database so the next start re-seeds market and demo data. */
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${config.databasePath}${suffix}`;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    console.log(`Removed ${file}`);
  }
}
console.log('Database reset. Start the server to seed fresh data.');
