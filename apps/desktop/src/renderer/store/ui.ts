import { create } from 'zustand';
import { LOCALES, type Locale } from '../i18n/dictionaries';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

interface UiState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  /** "system" follows the OS colour scheme; explicit modes always win. */
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

const LOCALE_STORAGE_KEY = 'pharmacy.locale';
const THEME_STORAGE_KEY = 'pharmacy.theme';

/**
 * Resolves the effective theme for a mode. `prefersDark` is the live
 * `prefers-color-scheme: dark` media query result.
 */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'ar';
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return LOCALES.includes(stored as Locale) ? (stored as Locale) : 'ar';
}

function initialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return THEME_MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : 'system';
}

/** UI preferences. Arabic is the default locale for Egyptian pharmacies. */
export const useUiStore = create<UiState>((set, get) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore storage failures (private mode / locked profile)
    }
    set({ locale });
  },
  toggleLocale: () => get().setLocale(get().locale === 'ar' ? 'en' : 'ar'),

  themeMode: initialThemeMode(),
  setThemeMode: (mode) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // ignore storage failures (private mode / locked profile)
    }
    set({ themeMode: mode });
  },
}));
