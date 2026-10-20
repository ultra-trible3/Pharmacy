import { describe, expect, it } from 'vitest';
import { expiryLabel, expirySeverity, formatDate, formatMoney, formatNumber } from './format';

describe('formatMoney', () => {
  it('renders a fixed 2-decimal amount with the currency symbol', () => {
    expect(formatMoney('1234.5', 'en-EG')).toBe('1,234.50 EGP');
  });

  it('never leaks binary floating point artefacts', () => {
    // 0.1 + 0.2 territory: the value is passed as a string so it must not drift.
    expect(formatMoney('0.30', 'en-EG')).toBe('0.30 EGP');
    expect(formatMoney('245.555', 'en-EG')).toBe('245.56 EGP');
  });

  it('uses the Arabic symbol for the ar-EG locale', () => {
    expect(formatMoney('10.00', 'ar-EG')).toContain('ج.م');
  });

  it('falls back to a dash for missing values', () => {
    expect(formatMoney(null, 'en-EG')).toBe('—');
    expect(formatMoney(undefined, 'en-EG')).toBe('—');
  });
});

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(12345, 'en-EG')).toBe('12,345');
  });
});

describe('formatDate', () => {
  it('formats an ISO date-only string without shifting the day', () => {
    expect(formatDate('2026-03-01', 'en-EG')).toBe('03/01/2026');
  });

  it('returns a dash for invalid input', () => {
    expect(formatDate('not-a-date', 'en-EG')).toBe('—');
  });
});

describe('expirySeverity', () => {
  it('classifies expired, critical, warning and ok bands', () => {
    expect(expirySeverity(-1)).toBe('expired');
    expect(expirySeverity(0)).toBe('critical');
    expect(expirySeverity(30)).toBe('critical');
    expect(expirySeverity(31)).toBe('warning');
    expect(expirySeverity(90)).toBe('warning');
    expect(expirySeverity(91)).toBe('ok');
  });

  it('honours a custom near-expiry window', () => {
    expect(expirySeverity(45, 30)).toBe('ok');
  });
});

describe('expiryLabel', () => {
  it('describes expired, imminent and far-future batches in Arabic', () => {
    expect(expiryLabel(-12)).toBe('منتهي منذ 12 يوم');
    expect(expiryLabel(0)).toBe('ينتهي اليوم');
    expect(expiryLabel(15)).toBe('ينتهي خلال 15 يوم');
    expect(expiryLabel(180)).toBe('متاح 6 شهر');
  });
});
