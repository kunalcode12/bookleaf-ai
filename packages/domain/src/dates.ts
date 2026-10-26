/**
 * Calendar helpers on UTC "civil dates" (YYYY-MM-DD). Royalty windows are day-granular, so
 * everything is computed at UTC midnight to keep results independent of the server's timezone.
 */

const DAY_MS = 86_400_000;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function parseIsoDate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new RangeError(`Invalid ISO date: ${iso}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (toIsoDate(date) !== iso) throw new RangeError(`Invalid ISO date: ${iso}`);
  return date;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

/** Whole days from `b` to `a` (positive when `a` is later). */
export function diffInDays(a: Date, b: Date): number {
  return Math.round((startOfUtcDay(a).getTime() - startOfUtcDay(b).getTime()) / DAY_MS);
}

function asDate(value: Date | string): Date {
  return typeof value === 'string' ? (value.length === 10 ? parseIsoDate(value) : new Date(value)) : value;
}

/** "14 November 2026" — the format BookLeaf uses in author communication. */
export function formatLongDate(value: Date | string): string {
  const d = asDate(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "14 Nov 2026". */
export function formatShortDate(value: Date | string): string {
  const d = asDate(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)} ${d.getUTCFullYear()}`;
}

export interface CalendarQuarter {
  year: number;
  /** 1–4 */
  quarter: number;
}

export function quarterOf(date: Date): CalendarQuarter {
  return { year: date.getUTCFullYear(), quarter: Math.floor(date.getUTCMonth() / 3) + 1 };
}

export function quarterEnd({ year, quarter }: CalendarQuarter): Date {
  // Day 0 of the month after the quarter = last day of the quarter.
  return new Date(Date.UTC(year, quarter * 3, 0));
}

export function quarterLabel({ year, quarter }: CalendarQuarter): string {
  const first = MONTHS[(quarter - 1) * 3]!.slice(0, 3);
  const last = MONTHS[(quarter - 1) * 3 + 2]!.slice(0, 3);
  return `${first}–${last} ${year}`;
}

export function nextQuarter({ year, quarter }: CalendarQuarter): CalendarQuarter {
  return quarter === 4 ? { year: year + 1, quarter: 1 } : { year, quarter: quarter + 1 };
}

export function previousQuarter({ year, quarter }: CalendarQuarter): CalendarQuarter {
  return quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
}
