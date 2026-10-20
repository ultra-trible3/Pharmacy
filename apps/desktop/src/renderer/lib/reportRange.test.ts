import { describe, expect, it } from 'vitest';
import {
  addDays,
  dashboardFileName,
  presetRange,
  rangeDayCount,
  toDateInputValue,
} from './reportRange';

describe('reportRange', () => {
  // 16 Oct 2026, 15:30 local time.
  const now = new Date(2026, 9, 16, 15, 30);

  it('builds every preset relative to today', () => {
    expect(presetRange('today', now)).toEqual({ from: '2026-10-16', to: '2026-10-16' });
    expect(presetRange('last7', now)).toEqual({ from: '2026-10-10', to: '2026-10-16' });
    expect(presetRange('last30', now)).toEqual({ from: '2026-09-17', to: '2026-10-16' });
    expect(presetRange('thisMonth', now)).toEqual({ from: '2026-10-01', to: '2026-10-16' });
  });

  it('shifts dates across month and year boundaries without DST drift', () => {
    expect(addDays('2026-10-16', -15)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('counts ranges inclusively', () => {
    expect(rangeDayCount({ from: '2026-10-16', to: '2026-10-16' })).toBe(1);
    expect(rangeDayCount({ from: '2026-10-10', to: '2026-10-16' })).toBe(7);
    expect(rangeDayCount({ from: '2026-09-17', to: '2026-10-16' })).toBe(30);
  });

  it('formats a local date for date inputs', () => {
    expect(toDateInputValue(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('stamps the selected range into export file names', () => {
    expect(dashboardFileName({ from: '2026-10-10', to: '2026-10-16' }, now, 'xlsx')).toBe(
      'dashboard-report_2026-10-10_2026-10-16.xlsx',
    );
    expect(dashboardFileName(null, now, 'pdf')).toBe('dashboard-report_2026-10-16.pdf');
  });
});
