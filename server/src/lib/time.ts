import { nowMs } from './clock.js';

export const IST_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date (YYYY-MM-DD) in India for the given instant. */
export function istDate(at: number | Date = nowMs()): string {
  return dateFormatter.format(typeof at === 'number' ? new Date(at) : at);
}

/** Epoch ms of 00:00 IST on the given YYYY-MM-DD date. */
export function istDayStart(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) - IST_OFFSET_MS;
}

/** Epoch ms of 23:59:59.999 IST on the given date. */
export function istDayEnd(date: string): number {
  return istDayStart(date) + DAY_MS - 1;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Most recent weekday strictly before the given date. */
export function previousWeekday(date: string): string {
  let d = addDays(date, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

/** Adds (or subtracts) weekdays, skipping Saturdays and Sundays. */
export function addWeekdays(date: string, count: number): string {
  let d = date;
  let remaining = Math.abs(count);
  const step = count >= 0 ? 1 : -1;
  while (remaining > 0) {
    d = addDays(d, step);
    if (!isWeekend(d)) remaining--;
  }
  return d;
}

export function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

/** ISO timestamp of the start of an IST calendar day (for filtering UTC timestamps by local date). */
export function istDayStartIso(date: string): string {
  return new Date(istDayStart(date)).toISOString();
}

export function istDayEndIso(date: string): string {
  return new Date(istDayEnd(date)).toISOString();
}
