import { z } from 'zod';
import { get, run } from '../db/index.js';
import { nowIso, nowMs } from '../lib/clock.js';
import { parse } from '../lib/validation.js';
import type { Actor } from './actor.js';
import { audit } from './audit.service.js';

/** Brokerage and statutory charges applied to every trade (percentages of trade value). */
const chargesSchema = z.object({
  brokeragePct: z.number().min(0).max(5),
  brokerageMax: z.number().min(0).max(10000),
  sttPct: z.number().min(0).max(5),
  exchangePct: z.number().min(0).max(1),
  sebiPerCrore: z.number().min(0).max(1000),
  stampDutyPct: z.number().min(0).max(1),
  gstPct: z.number().min(0).max(50),
});

/** Limits for adding and withdrawing money, in rupees. */
const fundsSchema = z
  .object({
    minDeposit: z.number().min(1),
    maxDeposit: z.number().min(1),
    minWithdrawal: z.number().min(1),
    maxWithdrawal: z.number().min(1),
  })
  .refine((v) => v.minDeposit <= v.maxDeposit, { message: 'minDeposit must not exceed maxDeposit' })
  .refine((v) => v.minWithdrawal <= v.maxWithdrawal, { message: 'minWithdrawal must not exceed maxWithdrawal' });

const tradingSchema = z.object({
  maxOrderQuantity: z.number().int().min(1).max(10_000_000),
  /** Retail IPO application limit in rupees. */
  ipoRetailLimit: z.number().min(1000),
});

const schemas = {
  charges: chargesSchema,
  funds: fundsSchema,
  trading: tradingSchema,
} as const;

export type SettingKey = keyof typeof schemas;
export type Settings = { [K in SettingKey]: z.infer<(typeof schemas)[K]> };

export const DEFAULT_SETTINGS: Settings = {
  charges: {
    brokeragePct: 0.1,
    brokerageMax: 20,
    sttPct: 0.1,
    exchangePct: 0.00297,
    sebiPerCrore: 10,
    stampDutyPct: 0.015,
    gstPct: 18,
  },
  funds: { minDeposit: 100, maxDeposit: 1_000_000, minWithdrawal: 100, maxWithdrawal: 1_000_000 },
  trading: { maxOrderQuantity: 100_000, ipoRetailLimit: 200_000 },
};

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  const row = await get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return DEFAULT_SETTINGS[key];
  return { ...DEFAULT_SETTINGS[key], ...(JSON.parse(row.value) as Partial<Settings[K]>) };
}

export async function getAllSettings(): Promise<Settings> {
  return {
    charges: (await getSetting('charges')),
    funds: (await getSetting('funds')),
    trading: (await getSetting('trading')),
  };
}

export function isSettingKey(key: string): key is SettingKey {
  return key in schemas;
}

export async function updateSetting<K extends SettingKey>(key: K, value: unknown, actor: Actor): Promise<Settings[K]> {
  const merged = { ...(await getSetting(key)), ...(typeof value === 'object' && value ? value : {}) };
  const parsed = parse(schemas[key] as unknown as z.ZodType<Settings[K]>, merged);
  const before = await getSetting(key);
  await run(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
    key,
    JSON.stringify(parsed),
    nowIso(),
    actor.userId,
  );
  await audit({
    actor,
    action: 'SETTINGS_UPDATED',
    subjectUserId: null,
    entityType: 'SETTING',
    entityId: key,
    details: { before, after: parsed },
  });
  return parsed;
}

/** Internal key/value state (e.g. the current trading date) that is not user-editable. */
export async function getState(key: string): Promise<string | null> {
  return (await get<{ value: string }>('SELECT value FROM settings WHERE key = ?', `state:${key}`))?.value ?? null;
}

export async function setState(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    `state:${key}`,
    value,
    nowIso(),
  );
}

/**
 * Claims a named lease for `intervalMs`: true for exactly one caller per interval, across every server instance.
 * Background work started by requests uses it so that each job runs once, wherever the request landed.
 */
export async function claimLease(name: string, intervalMs: number): Promise<boolean> {
  const now = nowMs();
  const result = await run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
     WHERE CAST(settings.value AS BIGINT) <= ? OR CAST(settings.value AS BIGINT) > ?`,
    `lease:${name}`,
    String(now),
    nowIso(),
    now - intervalMs,
    // A lease from the future means the clock moved back (tests freeze time); treat it as expired.
    now,
  );
  return result.changes > 0;
}
