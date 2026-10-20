import { describe, expect, it } from 'vitest';
import {
  applyPercentDiscount,
  compareCurrency,
  formatEGP,
  fromMinorUnits,
  multiplyCurrency,
  roundCurrency,
  sumCurrency,
  toMinorUnits,
} from './money.js';

describe('money helpers', () => {
  it('rounds to two decimals without floating point drift', () => {
    expect(roundCurrency(0.1 + 0.2)).toBe('0.30');
    expect(roundCurrency('1.005')).toBe('1.01');
    expect(roundCurrency(2.675)).toBe('2.68');
    expect(roundCurrency(-1.005)).toBe('-1.01');
  });

  it('converts to and from integer minor units', () => {
    expect(toMinorUnits('12.34')).toBe(1234);
    expect(toMinorUnits(0)).toBe(0);
    expect(fromMinorUnits(1234)).toBe('12.34');
    expect(fromMinorUnits(-5)).toBe('-0.05');
    expect(fromMinorUnits(7)).toBe('0.07');
  });

  it('rejects invalid input', () => {
    expect(() => toMinorUnits('abc')).toThrow(TypeError);
    expect(() => fromMinorUnits(Number.NaN)).toThrow(TypeError);
    expect(() => multiplyCurrency('1.00', Number.NaN)).toThrow(TypeError);
    expect(() => applyPercentDiscount('10.00', 101)).toThrow(RangeError);
    expect(() => applyPercentDiscount('10.00', -1)).toThrow(RangeError);
  });

  it('sums a cart of decimal strings exactly', () => {
    expect(sumCurrency(['0.10', '0.20', '0.30'])).toBe('0.60');
    expect(sumCurrency(['19.99', '0.01'])).toBe('20.00');
    expect(sumCurrency([])).toBe('0.00');
  });

  it('multiplies unit prices by quantity', () => {
    expect(multiplyCurrency('2.50', 4)).toBe('10.00');
    expect(multiplyCurrency('0.1', 3)).toBe('0.30');
  });

  it('applies percentage discounts', () => {
    expect(applyPercentDiscount('100.00', 10)).toBe('90.00');
    expect(applyPercentDiscount('99.99', 0)).toBe('99.99');
    expect(applyPercentDiscount('99.99', 100)).toBe('0.00');
  });

  it('compares amounts', () => {
    expect(compareCurrency('1.00', '1.00')).toBe(0);
    expect(compareCurrency('1.01', '1.00')).toBe(1);
    expect(compareCurrency('0.99', '1.00')).toBe(-1);
  });

  it('formats EGP amounts for both locales', () => {
    expect(formatEGP('1234.5', 'en-EG')).toContain('1,234.50');
    expect(formatEGP('1234.5', 'en-EG')).toContain('EGP');
    expect(formatEGP('1234.5', 'ar-EG')).toContain('ج.م');
  });
});
