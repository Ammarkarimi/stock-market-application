type Cell = string | number | boolean | null | undefined;

/** Escapes a value for CSV and neutralises spreadsheet formula injection in text cells. */
function escapeCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}
