const TZ = 'Asia/Kolkata';

const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹1,23,456.78 */
export function formatINR(value: number | null | undefined, options: { decimals?: 0 | 2; sign?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const formatted = (options.decimals === 0 ? inr0 : inr2).format(Math.abs(value));
  const sign = value < 0 ? '−' : options.sign && value > 0 ? '+' : '';
  return `${sign}${formatted}`;
}

/** 1,23,456.78 (no currency symbol) */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return num2.format(value);
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return decimals ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: decimals }).format(value) : int.format(value);
}

/** +1.25% */
export function formatPercent(value: number | null | undefined, options: { sign?: boolean; decimals?: number } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const decimals = options.decimals ?? 2;
  const sign = value > 0 && options.sign !== false ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/** +12.30 / −4.05 */
export function formatChange(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${num2.format(Math.abs(value))}`;
}

/** Indian short scale: 1.2 K, 3.4 L, 5.6 Cr */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(abs >= 1e9 ? 0 : 2)} Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)} K`;
  return `${sign}${int.format(abs)}`;
}

/** Amounts already expressed in crore, e.g. market cap: ₹18.8 L Cr */
export function formatCrores(crores: number | null | undefined): string {
  if (crores === null || crores === undefined || Number.isNaN(crores)) return '—';
  if (Math.abs(crores) >= 1e5) return `₹${(crores / 1e5).toFixed(2)} L Cr`;
  return `₹${int.format(crores)} Cr`;
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
const shortDateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short' });

/** Accepts ISO timestamps and plain YYYY-MM-DD dates (treated as IST calendar dates). */
function toDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
}

export function formatDate(value: string | null | undefined): string {
  return value ? dateFmt.format(toDate(value)) : '—';
}

export function formatShortDate(value: string | null | undefined): string {
  return value ? shortDateFmt.format(toDate(value)) : '—';
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTimeFmt.format(toDate(value)).replace(' am', ' AM').replace(' pm', ' PM') : '—';
}

export function formatTime(value: string | number | Date): string {
  return timeFmt.format(new Date(value)).replace(' am', ' AM').replace(' pm', ' PM');
}

export function relativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value);
}

/** Today's date in India as YYYY-MM-DD. */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Sign class helper for gain/loss colouring. */
export function trendClass(value: number | null | undefined): string {
  if (!value) return 'text-muted';
  return value > 0 ? 'text-gain' : 'text-loss';
}
