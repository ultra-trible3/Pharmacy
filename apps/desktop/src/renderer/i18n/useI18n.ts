import { useCallback } from 'react';
import {
  LOCALE_DIRECTION,
  LOCALE_TAG,
  dictionaries,
  type Locale,
  type TranslationKey,
} from './dictionaries';
import { useUiStore } from '../store/ui';

export interface I18n {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  tag: string;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  /** Translate a key, interpolating `{name}` placeholders. */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

export function useI18n(): I18n {
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);
  const toggleLocale = useUiStore((state) => state.toggleLocale);
  const dictionary = dictionaries[locale];

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const template = dictionary[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
      );
    },
    [dictionary],
  );

  return {
    locale,
    dir: LOCALE_DIRECTION[locale],
    tag: LOCALE_TAG[locale],
    setLocale,
    toggleLocale,
    t,
  };
}
