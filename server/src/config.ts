import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load server/.env when present (process.loadEnvFile is built into Node >= 20.12).
const envFile = path.join(serverRoot, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Environment variable ${name} must be a number`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function marketDataSource(fallback: 'yahoo' | 'simulated'): 'yahoo' | 'simulated' {
  const raw = process.env.MARKET_DATA?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'yahoo' || raw === 'simulated') return raw;
  throw new Error('Environment variable MARKET_DATA must be "yahoo" or "simulated"');
}

function resolveDatabasePath(file: string): string {
  return file === ':memory:' ? file : path.resolve(serverRoot, file);
}

const env = process.env.NODE_ENV ?? 'development';
const isTest = env === 'test' || process.env.VITEST === 'true';

export const config = {
  env,
  isProduction: env === 'production',
  isTest,
  port: num('PORT', 4000),
  /** SQLite file, relative to server/. ':memory:' keeps everything in memory (nothing survives a restart). */
  databasePath: isTest ? ':memory:' : resolveDatabasePath(process.env.DATABASE_PATH || 'data/stocksphere.db'),
  /** Session expires after this many minutes without any authenticated request. */
  sessionIdleMinutes: num('SESSION_IDLE_MINUTES', 120),
  /** Absolute session lifetime regardless of activity. */
  sessionMaxHours: num('SESSION_MAX_HOURS', 24 * 7),
  cookieSecure: bool('COOKIE_SECURE', env === 'production'),
  /** Value passed to Express "trust proxy" so req.ip reflects the client behind a reverse proxy. */
  trustProxy: num('TRUST_PROXY', 0),
  /**
   * Where prices come from: 'yahoo' for real NSE/BSE prices (delayed ~15 minutes) from Yahoo Finance, or
   * 'simulated' for the built-in random-walk market. Tests always simulate.
   */
  marketData: isTest ? ('simulated' as const) : marketDataSource('yahoo'),
  /** How often live quotes are refreshed while the exchange is open. */
  livePollMs: Math.max(5000, num('LIVE_POLL_MS', 15_000)),
  /** Interval between simulated market ticks. */
  tickIntervalMs: num('TICK_INTERVAL_MS', 2000),
  simulationEnabled: bool('MARKET_SIMULATION', !isTest),
  /** Demo accounts have published passwords, so production only seeds them when explicitly asked to. */
  seedDemoData: bool('SEED_DEMO_DATA', !isTest && env !== 'production'),
  rateLimitEnabled: bool('RATE_LIMIT', !isTest),
  clientDistPath: path.resolve(serverRoot, '../client/dist'),
  timezone: 'Asia/Kolkata',
  serverRoot,
} as const;
