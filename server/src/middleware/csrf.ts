import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { safeEqual } from '../lib/crypto.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests:
 *  - cross-origin state-changing requests are rejected based on the Origin header, and
 *  - authenticated state-changing requests must echo the session's CSRF token in X-CSRF-Token.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin');
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const host = req.get('x-forwarded-host') ?? req.get('host');
    if (!originHost || originHost !== host) {
      return next(new AppError(403, 'CSRF_REJECTED', 'Cross-origin request rejected'));
    }
  }

  if (req.auth) {
    const token = req.get('x-csrf-token');
    if (!token || !safeEqual(token, req.auth.session.csrf_token)) {
      return next(new AppError(403, 'CSRF_REJECTED', 'Missing or invalid CSRF token. Refresh the page and try again.'));
    }
  }
  next();
}
