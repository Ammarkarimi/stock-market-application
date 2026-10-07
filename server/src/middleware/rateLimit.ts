import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

const passthrough: RequestHandler = (_req, _res, next) => next();

function limiter(windowMs: number, limit: number, message: string): RequestHandler {
  if (!config.rateLimitEnabled) return passthrough;
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    },
  });
}

/** Brute-force protection for login and registration. */
export const authLimiter = limiter(15 * 60_000, 30, 'Too many attempts. Please wait a few minutes and try again.');

/** General API limit per client IP. */
export const apiLimiter = limiter(60_000, 1200, 'Too many requests. Please slow down.');
