/**
 * Calendar-date helpers.
 *
 * Batch expiry dates are stored as PostgreSQL `DATE` (no timezone). Reporting
 * boundaries are computed in the pharmacy's business timezone (Africa/Cairo)
 * so that "today" always matches the local trading day regardless of where the
 * server process runs.
 */

export const BUSINESS_TIMEZONE = 'Africa/Cairo';

/** Format a Date (or ISO string) as `YYYY-MM-DD` in UTC (safe for DATE columns). */
export function toDateOnly(value: Date | string): string {
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/u.exec(value);
    if (match?.[1]) return match[1];
    return toDateOnly(new Date(value));
  }
  return value.toISOString().slice(0, 10);
}

/** Parse a `YYYY-MM-DD` string into a UTC midnight Date for Prisma DATE columns. */
export function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new RangeError(`Invalid date: ${value}`);
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${value}`);
  return date;
}

/** Current calendar date in the business timezone as `YYYY-MM-DD`. */
export function todayInBusinessTimezone(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

/** UTC instant corresponding to local midnight of the given calendar date. */
export function businessDayStart(dateOnly: string): Date {
  const [y, m, d] = dateOnly.split('-').map(Number) as [number, number, number];
  // Africa/Cairo is UTC+2 (UTC+3 with DST). Compute the offset for that date.
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetMinutes = timezoneOffsetMinutes(new Date(utcGuess));
  return new Date(utcGuess - offsetMinutes * 60_000);
}

function timezoneOffsetMinutes(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - date.getTime()) / 60_000;
}

/** Whole days between `dateOnly` and today (negative when in the past). */
export function daysUntil(dateOnly: string, today = todayInBusinessTimezone()): number {
  const target = parseDateOnly(dateOnly).getTime();
  const base = parseDateOnly(today).getTime();
  return Math.round((target - base) / 86_400_000);
}

/** ISO timestamp helper used in API responses. */
export function toIso(value: Date): string {
  return value.toISOString();
}
