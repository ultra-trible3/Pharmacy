import { useLayoutEffect } from 'react';
import { resolveTheme, type ThemeMode } from '../store/ui';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Applies the selected theme by toggling `.dark` on <html> (see the palette
 * in index.css). While the mode is "system" the OS preference is followed
 * live — the app re-themes the moment Windows switches to dark or back.
 * Uses a layout effect so the class lands before the first paint.
 */
export function useTheme(mode: ThemeMode): void {
  useLayoutEffect(() => {
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
    const apply = (prefersDark: boolean): void => {
      const dark = resolveTheme(mode, prefersDark) === 'dark';
      document.documentElement.classList.toggle('dark', dark);
    };

    apply(media?.matches ?? false);
    if (!media) return undefined;

    const onChange = (event: MediaQueryListEvent): void => apply(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);
}
