import { waitUntil } from '@vercel/functions';
import { registerMarketListeners } from '../bootstrap.js';
import { config } from '../config.js';
import { database, transaction } from '../db/index.js';
import { nowMs } from '../lib/clock.js';
import { DEMO_ACCOUNTS, seedDemoData } from '../seed/demo.js';
import { SYSTEM_ACTOR } from '../services/actor.js';
import { setUserRole } from '../services/admin.service.js';
import { processIpoLifecycle } from '../services/ipo.service.js';
import { cleanupSessions } from '../services/session.service.js';
import { claimLease } from '../services/settings.service.js';
import { findUserByEmail } from '../services/user.repository.js';
import { initMarket, reloadMarket, tick } from './engine.js';
import {
  enableLiveFeed,
  liveFeedEnabled,
  liveHistoryDue,
  refreshLiveQuotes,
  syncLiveFundamentals,
  syncLiveHistory,
} from './liveFeed.js';
import { seedIpos } from './seedIpos.js';
import { seedMarket } from './seedMarket.js';
import { isMarketOpen, loadMarketSession, marketSession } from './session.js';

/**
 * Runs the market without timers, so the server can live in short-lived serverless functions. Each instance
 * keeps an in-memory copy of the market that requests refresh from the database every couple of seconds.
 * Price updates and housekeeping are started by requests: whichever instance claims a job's lease runs it, after
 * the response has been sent. A daily cron request keeps long-running jobs going on quiet days.
 */

/** How stale this instance's copy of quotes and the session may get before a request reloads it. */
const SYNC_MS = 2_000;
/** Minimum gap between this instance's attempts to start background work. */
const WORK_CHECK_MS = 1_000;
const LIVE_CLOSED_POLL_MS = 2 * 60_000;
const IPO_LIFECYCLE_MS = 30_000;
const SESSION_CLEANUP_MS = 60 * 60_000;
const ADMIN_CHECK_MS = 5 * 60_000;
/** Long jobs hold their lease this long, so a crashed run is retried an hour later. */
const LONG_JOB_LEASE_MS = 60 * 60_000;
const LONG_JOB_CHECK_MS = 60_000;

let prepared: Promise<void> | null = null;
let syncedAt = 0;
let syncing: Promise<void> | null = null;
let workCheckedAt = 0;
let working: Promise<void> | null = null;
let longWork: Promise<void> | null = null;
let longCheckedAt = 0;

async function prepare(): Promise<void> {
  await database();
  // Seeding checks for existing data first; the write lock makes the first instance seed while the others wait.
  await transaction(async () => {
    // A live feed replaces the history straight away, so a year of simulated history is enough to start with.
    await seedMarket({ years: config.marketData === 'yahoo' ? 1 : 5 });
    await seedIpos();
  });
  if (config.marketData === 'yahoo') await enableLiveFeed();
  await initMarket();
  await loadMarketSession();
  registerMarketListeners();
  if (config.seedDemoData) {
    await transaction(seedDemoData);
    if (!config.isProduction) {
      console.log(
        `Demo investor: ${DEMO_ACCOUNTS.investor.email} / ${DEMO_ACCOUNTS.investor.password} (PIN ${DEMO_ACCOUNTS.investor.pin})`,
      );
      console.log(
        `Demo admin:    ${DEMO_ACCOUNTS.admin.email} / ${DEMO_ACCOUNTS.admin.password} (PIN ${DEMO_ACCOUNTS.admin.pin})`,
      );
    }
  }
  await promoteConfiguredAdmins();
  syncedAt = nowMs();
}

async function promoteConfiguredAdmins(): Promise<void> {
  for (const email of config.adminEmails) {
    const user = await findUserByEmail(email);
    if (!user || user.role === 'ADMIN') continue;
    try {
      await setUserRole(user.id, 'ADMIN', { ...SYSTEM_ACTOR, userAgent: 'ADMIN_EMAILS setting' });
      console.log(`${user.email} is now an administrator (ADMIN_EMAILS).`);
    } catch (err) {
      // Another instance starting at the same time may have promoted them first.
      console.warn(`Could not promote ${user.email}: ${(err as Error).message}`);
    }
  }
}

/** Connects, migrates and seeds the database and loads the market; runs once per server instance. */
export function prepareServer(): Promise<void> {
  prepared ??= prepare().catch((err) => {
    prepared = null;
    throw err;
  });
  return prepared;
}

/** Reloads quotes, the trading date and the live session when this instance's copy is more than a moment old. */
export async function syncMarketState(): Promise<void> {
  // While this instance runs price updates, its copy is the freshest there is.
  if (working || nowMs() - syncedAt < SYNC_MS) return;
  syncing ??= (async () => {
    try {
      await reloadMarket();
      await loadMarketSession();
      syncedAt = nowMs();
    } finally {
      syncing = null;
    }
  })();
  await syncing;
}

async function attempt(name: string, job: () => Promise<unknown>): Promise<void> {
  try {
    await job();
  } catch (err) {
    console.error(`Background job "${name}" failed:`, (err as Error).message);
  }
}

/** Price updates and housekeeping whose leases this instance claims, one after another. */
export async function runDueWork(): Promise<void> {
  if (liveFeedEnabled()) {
    const interval = marketSession().phase === 'OPEN' ? config.livePollMs : LIVE_CLOSED_POLL_MS;
    if (await claimLease('liveQuotes', interval)) await attempt('live quotes', refreshLiveQuotes);
  }
  // With a live feed, the simulator still prices securities the feed does not cover (IPO listings) while the market is open.
  if (
    config.simulationEnabled &&
    isMarketOpen() &&
    (await claimLease('simulationTick', config.tickIntervalMs))
  ) {
    await attempt('market tick', () =>
      transaction(async () => {
        await reloadMarket();
        await tick();
      }),
    );
  }
  if (await claimLease('ipoLifecycle', IPO_LIFECYCLE_MS)) await attempt('IPO lifecycle', processIpoLifecycle);
  if (await claimLease('sessionCleanup', SESSION_CLEANUP_MS))
    await attempt('session cleanup', cleanupSessions);
  // Accounts listed in ADMIN_EMAILS that registered after this instance started.
  if (config.adminEmails.length > 0 && (await claimLease('adminEmails', ADMIN_CHECK_MS)))
    await attempt('admin promotion', promoteConfiguredAdmins);
  syncedAt = nowMs();
}

/** History and company data from the feed: slow, so each runs at most about once a day. */
export async function runLongJobs(): Promise<void> {
  if (!liveFeedEnabled()) return;
  if ((await liveHistoryDue()) && (await claimLease('liveHistory', LONG_JOB_LEASE_MS)))
    await attempt('history sync', syncLiveHistory);
  if (await claimLease('liveFundamentals', LONG_JOB_LEASE_MS))
    await attempt('fundamentals sync', syncLiveFundamentals);
}

/** Keeps a promise running after the response is sent; on Vercel the function stays alive until it settles. */
function background(job: () => Promise<void>): Promise<void> {
  const promise = job().catch((err) => console.error('Background work failed', err));
  waitUntil(promise);
  return promise;
}

/** Starts due background work after the current request, unless this instance is already running it. */
export function scheduleDueWork(): void {
  const now = nowMs();
  if (now - workCheckedAt < WORK_CHECK_MS) return;
  workCheckedAt = now;
  working ??= background(runDueWork).finally(() => {
    working = null;
  });
  if (now - longCheckedAt < LONG_JOB_CHECK_MS) return;
  longCheckedAt = now;
  longWork ??= background(runLongJobs).finally(() => {
    longWork = null;
  });
}

/** The daily cron: everything above, with the long jobs given a chance even if nobody visited today. */
export async function runDailyJobs(): Promise<void> {
  await prepareServer();
  await Promise.all([working, longWork]);
  await runDueWork();
  await runLongJobs();
}
