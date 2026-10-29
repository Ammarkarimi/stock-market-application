import { processIpoLifecycle } from '../services/ipo.service.js';
import { cleanupSessions } from '../services/session.service.js';

const INTERVAL_MS = 30_000;
const SESSION_CLEANUP_EVERY = 20;

let timer: NodeJS.Timeout | null = null;
let runs = 0;

/** Runs periodic housekeeping: IPO lifecycle (opening, subscriptions, allotment, listing) and session cleanup. */
export async function runScheduledJobs(): Promise<void> {
  try {
    await processIpoLifecycle();
  } catch (err) {
    console.error('IPO lifecycle job failed', err);
  }
  if (runs++ % SESSION_CLEANUP_EVERY === 0) {
    try {
      await cleanupSessions();
    } catch (err) {
      console.error('Session cleanup failed', err);
    }
  }
}

export async function startScheduler(): Promise<void> {
  if (timer) return;
  await runScheduledJobs();
  timer = setInterval(runScheduledJobs, INTERVAL_MS);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
