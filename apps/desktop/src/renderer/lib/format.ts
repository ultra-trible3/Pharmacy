import { CURRENCY_CONFIG, normaliseDecimalString } from '@pharmacy/shared';

/** Formats a decimal string as EGP using the requested locale. */
export function formatMoney(value: string | number | null | undefined, locale = 'ar-EG'): string {
  if (value === null || value === undefined) return '—';
  const amount = Number(normaliseDecimalString(value, 2));
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return locale === 'ar-EG'
    ? `${formatted} ${CURRENCY_CONFIG.symbolAr}`
    : `${formatted} ${CURRENCY_CONFIG.symbolEn}`;
}

export function formatNumber(value: number | null | undefined, locale = 'ar-EG'): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale).format(value);
}

/** Compact number for chart axes (e.g. `12.5K`), locale aware. */
export function formatCompactNumber(value: number | null | undefined, locale = 'ar-EG'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Parses a value into a Date.
 *
 * Date-only strings (`YYYY-MM-DD`, i.e. expiry dates and business dates) are
 * interpreted as **local noon**, never as UTC midnight, so a pharmacy east or
 * west of UTC can never see a batch expire one day early or late.
 */
function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly as unknown as [string, string, string, string];
    return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value: string | Date | null | undefined, locale = 'ar-EG'): string {
  if (!value) return '—';
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined, locale = 'ar-EG'): string {
  if (!value) return '—';
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export type ExpirySeverity = 'expired' | 'critical' | 'warning' | 'ok';

/** Maps days-to-expiry onto the colour band used across the inventory screens. */
export function expirySeverity(daysToExpiry: number, nearExpiryDays = 90): ExpirySeverity {
  if (daysToExpiry < 0) return 'expired';
  if (daysToExpiry <= 30) return 'critical';
  if (daysToExpiry <= nearExpiryDays) return 'warning';
  return 'ok';
}

export function expiryLabel(daysToExpiry: number): string {
  if (daysToExpiry < 0) return `منتهي منذ ${Math.abs(daysToExpiry)} يوم`;
  if (daysToExpiry === 0) return 'ينتهي اليوم';
  if (daysToExpiry <= 90) return `ينتهي خلال ${daysToExpiry} يوم`;
  return `متاح ${Math.round(daysToExpiry / 30)} شهر`;
}
