import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { notFound, unauthorized } from '../lib/errors.js';
import { runDailyJobs } from '../market/runtime.js';

const router = Router();

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Vercel Cron calls this once a day with `Authorization: Bearer $CRON_SECRET`. */
router.get('/daily', async (req, res) => {
  if (!config.cronSecret) throw notFound();
  if (!sameSecret(req.get('authorization') ?? '', `Bearer ${config.cronSecret}`)) throw unauthorized();
  const started = Date.now();
  await runDailyJobs();
  res.json({ ok: true, ms: Date.now() - started });
});

export default router;
