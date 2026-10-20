import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useI18n } from './useI18n';

describe('useI18n', () => {
  it('defaults to Arabic with RTL direction', () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.locale).toBe('ar');
    expect(result.current.dir).toBe('rtl');
    expect(result.current.t('app.title')).toBe('نظام إدارة الصيدلية');
  });

  it('interpolates named placeholders', () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.t('products.count', { count: 42 })).toBe('42 صنف');
    expect(result.current.t('dashboard.nearExpiryDays', { days: 90 })).toBe('خلال 90 يوم');
  });

  it('switches to English and LTR', () => {
    const { result } = renderHook(() => useI18n());
    act(() => result.current.setLocale('en'));
    expect(result.current.locale).toBe('en');
    expect(result.current.dir).toBe('ltr');
    expect(result.current.t('app.title')).toBe('Pharmacy Management System');
  });

  it('leaves unknown placeholders untouched', () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.t('login.demoHint')).toBe('بيانات تجريبية: owner / Pharma@2024');
  });
});
