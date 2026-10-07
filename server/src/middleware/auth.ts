import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { resolveSession, SESSION_COOKIE } from '../services/session.service.js';

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: config.sessionMaxHours * 3_600_000,
  };
}

export function clearSessionCookie(res: Response): void {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE, options);
}

/** Attaches req.auth when the request carries a valid session cookie. */
export function loadSession(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) {
    const auth = resolveSession(token);
    if (auth) req.auth = auth;
    else clearSessionCookie(res);
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized('Your session has expired. Please sign in again.'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized());
  if (req.auth.user.role !== 'ADMIN') return next(forbidden('Administrator access required'));
  next();
}

/** Returns the authenticated user; only call behind requireAuth. */
export function currentUser(req: Request) {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
}
