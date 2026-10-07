/**
 * Money is stored and computed as integer paise (1 rupee = 100 paise) to avoid floating point drift.
 * The API exposes rupees; conversion happens only at the boundaries.
 */
export type Paise = number;

export function toPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function toRupees(paise: Paise): number {
  return Math.round(paise) / 100;
}

export function toRupeesOrNull(paise: Paise | null | undefined): number | null {
  return paise === null || paise === undefined ? null : toRupees(paise);
}

/** Rounds a price to the nearest multiple of the tick size (both in paise). */
export function roundToTick(paise: Paise, tickSize: Paise): Paise {
  return Math.max(tickSize, Math.round(paise / tickSize) * tickSize);
}

export function isMultipleOf(paise: Paise, tickSize: Paise): boolean {
  return paise % tickSize === 0;
}

/** Percentage of a paise amount, rounded to the nearest paisa. */
export function percentOf(paise: Paise, percent: number): Paise {
  return Math.round((paise * percent) / 100);
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats paise as an Indian rupee string, e.g. ₹1,23,456.70. */
export function formatInr(paise: Paise): string {
  return inrFormatter.format(paise / 100);
}

export function changePercent(current: number, previous: number): number {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}
