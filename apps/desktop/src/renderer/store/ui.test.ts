import { describe, expect, it } from 'vitest';
import { resolveTheme, useUiStore } from './ui';

describe('resolveTheme', () => {
  it('follows the system preference while the mode is "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('lets explicit modes override the system preference', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });
});

describe('ui store theme mode', () => {
  it('defaults to "system"', () => {
    expect(useUiStore.getState().themeMode).toBe('system');
  });

  it('persists an explicit selection', () => {
    useUiStore.getState().setThemeMode('dark');
    expect(useUiStore.getState().themeMode).toBe('dark');
    expect(window.localStorage.getItem('pharmacy.theme')).toBe('dark');

    useUiStore.getState().setThemeMode('light');
    expect(window.localStorage.getItem('pharmacy.theme')).toBe('light');
  });
});
