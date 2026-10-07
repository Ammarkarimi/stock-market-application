import { z } from 'zod';
import { validationError } from './errors.js';
import { isValidDate } from './time.js';

/** Parses input with a Zod schema and converts failures into a 400 with per-field messages. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    fields[key] ??= issue.message;
  }
  const first = result.error.issues[0];
  const message = first ? (first.path.length ? `${first.path.join('.')}: ${first.message}` : first.message) : 'Invalid input';
  throw validationError(message, { fields });
}

const hasAtMostTwoDecimals = (value: number) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6;

/** Positive rupee amount with at most two decimal places. */
export const rupees = () =>
  z
    .number({ error: 'Must be a number' })
    .positive('Must be greater than zero')
    .refine(hasAtMostTwoDecimals, 'At most two decimal places are allowed');

export const dateString = () => z.string().refine(isValidDate, 'Must be a date in YYYY-MM-DD format');

export const symbolParam = () =>
  z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9&\-_.]+$/, 'Invalid symbol')
    .transform((s) => s.toUpperCase());

export const idParam = () => z.coerce.number().int().positive();

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function pageOf<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, page, pageSize, total };
}

export const PASSWORD_RULES = 'at least 8 characters with at least one letter and one number';

export const passwordSchema = () =>
  z
    .string()
    .min(8, `Password must have ${PASSWORD_RULES}`)
    .max(128, 'Password is too long')
    .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), `Password must have ${PASSWORD_RULES}`);

export const pinSchema = () => z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits');
