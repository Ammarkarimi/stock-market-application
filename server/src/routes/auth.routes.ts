import { Router, type Response } from 'express';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { parse, passwordSchema } from '../lib/validation.js';
import { clearSessionCookie, currentUser, requireAuth, sessionCookieOptions } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { actorFrom } from '../services/actor.js';
import { audit } from '../services/audit.service.js';
import { login, logout, register } from '../services/auth.service.js';
import {
  getUserSession,
  listActiveSessions,
  revokeSession,
  revokeUserSessions,
  SESSION_COOKIE,
} from '../services/session.service.js';
import { toUserDto } from '../services/user.repository.js';

const router = Router();

const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name').max(80),
    email: z.email('Enter a valid email address').max(254),
    phone: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
    password: passwordSchema(),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').max(254),
  password: z.string().min(1, 'Password is required').max(128),
});

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

router.post('/register', authLimiter, async (req, res) => {
  const body = parse(registerSchema, req.body);
  const result = await register(body, actorFrom(req));
  setSessionCookie(res, result.token);
  res.status(201).json({ user: toUserDto(result.user), csrfToken: result.session.csrf_token });
});

router.post('/login', authLimiter, async (req, res) => {
  const body = parse(loginSchema, req.body);
  // Signing in again from the same browser replaces the previous session.
  if (req.auth) revokeSession(req.auth.session.id, 'REPLACED');
  const result = await login(body.email, body.password, { ...actorFrom(req), userId: null, role: 'ANONYMOUS' });
  setSessionCookie(res, result.token);
  res.json({ user: toUserDto(result.user), csrfToken: result.session.csrf_token });
});

router.post('/logout', requireAuth, (req, res) => {
  logout(req.auth?.session, actorFrom(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Anonymous visitors get { user: null } rather than a 401 so a normal page load doesn't log an error.
router.get('/me', (req, res) => {
  if (!req.auth) {
    res.json({ user: null, csrfToken: null });
    return;
  }
  res.json({ user: toUserDto(req.auth.user), csrfToken: req.auth.session.csrf_token });
});

router.get('/sessions', requireAuth, (req, res) => {
  res.json({ sessions: listActiveSessions(currentUser(req).id, req.auth?.session.id) });
});

router.delete('/sessions/:id', requireAuth, (req, res) => {
  const user = currentUser(req);
  const id = String(req.params.id);
  const session = getUserSession(user.id, id);
  if (!session || session.revoked_at) throw notFound('Session not found');
  revokeSession(session.id, 'REVOKED_BY_USER');
  audit({ actor: actorFrom(req), action: 'SESSION_REVOKED', entityType: 'SESSION', entityId: session.id.slice(0, 12) });
  const isCurrent = session.id === req.auth?.session.id;
  if (isCurrent) clearSessionCookie(res);
  res.json({ ok: true, signedOut: isCurrent });
});

router.post('/sessions/revoke-others', requireAuth, (req, res) => {
  const user = currentUser(req);
  const revoked = revokeUserSessions(user.id, 'REVOKED_BY_USER', req.auth?.session.id);
  audit({ actor: actorFrom(req), action: 'OTHER_SESSIONS_REVOKED', entityType: 'USER', entityId: user.id, details: { revoked } });
  res.json({ revoked });
});

export default router;
