/**
 * Date-range presets for the dashboard analytics.
 *
 * Bounds are date-only strings (`YYYY-MM-DD`) built from the operator's local
 * calendar; the API re-interprets them in the pharmacy business timezone.
 */

export type RangePreset = 'today' | 'last7' | 'last30' | 'thisMonth' | 'custom';

export interface DateRange {
  from: string;
  to: string;
}

export const RANGE_PRESETS: RangePreset[] = ['today', 'last7', 'last30', 'thisMonth', 'custom'];

export const DEFAULT_RANGE_PRESET: RangePreset = 'last7';

/** Formats a local Date as the `YYYY-MM-DD` value an `<input type="date">` expects. */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Shifts a date-only string by whole days (UTC-anchored, DST-safe). */
export function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Builds the concrete range for a non-custom preset, relative to `now`. */
export function presetRange(
  preset: Exclude<RangePreset, 'custom'>,
  now: Date = new Date(),
): DateRange {
  const today = toDateInputValue(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

/** Inclusive day count of a range. */
export function rangeDayCount(range: DateRange): number {
  const [fy, fm, fd] = range.from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = range.to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

/**
 * Download name for a range-stamped export, e.g.
 * `dashboard-report_2026-10-01_2026-10-16.xlsx`; falls back to `now`'s day
 * when there is no range (inventory-only exports).
 */
export function dashboardFileName(
  range: { from: string; to: string } | null,
  now: Date,
  extension: 'xlsx' | 'pdf',
): string {
  const stamp = range ? `${range.from}_${range.to}` : now.toISOString().slice(0, 10);
  return `dashboard-report_${stamp}.${extension}`;
}
