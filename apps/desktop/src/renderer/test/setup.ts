import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { setBridge } from '../lib/bridge';
import { useToastStore } from '../components/ui/toast';
import { useUiStore } from '../store/ui';
import { useNotificationsStore } from '../store/notifications';

beforeEach(() => {
  window.localStorage.clear();
  useUiStore.setState({ locale: 'ar', themeMode: 'system' });
  useNotificationsStore.setState({ readIds: [] });
  useToastStore.setState({ toasts: [] });
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  cleanup();
  setBridge(null);
});

// jsdom does not implement these; several components call them defensively.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Radix Select relies on pointer capture + `scrollIntoView`, neither of which jsdom implements.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}
if (!('ResizeObserver' in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
