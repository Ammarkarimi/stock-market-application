import { Router } from 'express';
import { z } from 'zod';
import { nowMs } from '../lib/clock.js';
import { idParam, paginationQuery, parse, passwordSchema, pinSchema, dateString } from '../lib/validation.js';
import { currentUser } from '../middleware/auth.js';
import { actorFrom } from '../services/actor.js';
import { listAuditLogs } from '../services/audit.service.js';
import {
  changePassword,
  getBankAccount,
  getNotificationPreferences,
  saveBankAccount,
  setTransactionPin,
  updateNotificationPreferences,
  updateProfile,
} from '../services/profile.service.js';
import { toUserDto } from '../services/user.repository.js';

const router = Router();

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
    .nullable()
    .optional(),
  dateOfBirth: dateString()
    .refine((d) => {
      const age = (nowMs() - Date.parse(d)) / (365.25 * 86_400_000);
      return age >= 18 && age <= 120;
    }, 'You must be at least 18 years old')
    .nullable()
    .optional(),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN must look like ABCDE1234F')
    .nullable()
    .optional(),
  address: optionalText(300),
});

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema(),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

const pinChangeSchema = z
  .object({ password: z.string().min(1, 'Password is required'), pin: pinSchema(), confirmPin: z.string() })
  .refine((v) => v.pin === v.confirmPin, { path: ['confirmPin'], message: 'PINs do not match' });

const bankAccountSchema = z.object({
  accountHolder: z.string().trim().min(2).max(80),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{9,18}$/, 'Account number must be 9 to 18 digits'),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC must look like HDFC0001234'),
  bankName: z.string().trim().min(2).max(80),
});

const preferencesSchema = z.object({
  ORDER: z.boolean().optional(),
  IPO: z.boolean().optional(),
  PRICE_ALERT: z.boolean().optional(),
  FUNDS: z.boolean().optional(),
  SYSTEM: z.boolean().optional(),
});

router.get('/', (req, res) => {
  const user = currentUser(req);
  res.json({
    user: toUserDto(user),
    bankAccount: getBankAccount(user.id),
    notificationPreferences: getNotificationPreferences(user.id),
  });
});

router.patch('/', (req, res) => {
  const body = parse(profileSchema, req.body);
  res.json({ user: updateProfile(currentUser(req).id, body, actorFrom(req)) });
});

router.post('/password', async (req, res) => {
  const body = parse(passwordChangeSchema, req.body);
  const result = await changePassword(
    currentUser(req).id,
    body.currentPassword,
    body.newPassword,
    actorFrom(req),
    req.auth!.session.id,
  );
  res.json(result);
});

router.post('/pin', async (req, res) => {
  const body = parse(pinChangeSchema, req.body);
  await setTransactionPin(currentUser(req).id, body.password, body.pin, actorFrom(req));
  res.json({ ok: true });
});

router.put('/bank-account', (req, res) => {
  const body = parse(bankAccountSchema, req.body);
  res.json({ bankAccount: saveBankAccount(currentUser(req).id, body, actorFrom(req)) });
});

router.put('/notification-preferences', (req, res) => {
  const body = parse(preferencesSchema, req.body);
  res.json({ notificationPreferences: updateNotificationPreferences(currentUser(req).id, body, actorFrom(req)) });
});

router.get('/activity', (req, res) => {
  const query = parse(
    z.object({ ...paginationQuery, action: z.string().max(60).optional(), entityId: idParam().optional() }),
    req.query,
  );
  const page = listAuditLogs({
    subjectUserId: currentUser(req).id,
    action: query.action,
    page: query.page,
    pageSize: query.pageSize,
  });
  // Users see their own trail without hashes or other actors' identifiers.
  res.json({
    ...page,
    items: page.items.map(({ hash: _hash, actorId: _actorId, subjectUserId: _subject, subjectName: _sn, ...item }) => item),
  });
});

export default router;
