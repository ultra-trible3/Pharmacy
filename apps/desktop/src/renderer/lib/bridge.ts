import type { PharmacyBridge } from '../../shared/ipc';

/**
 * Access point for the preload bridge.
 *
 * Tests (and the browser-only dev preview) can inject a fake bridge through
 * `setBridge`, keeping every consumer free of `window` access.
 */
let bridge: PharmacyBridge | null = null;

export function setBridge(next: PharmacyBridge | null): void {
  bridge = next;
}

export function getBridge(): PharmacyBridge {
  if (bridge) return bridge;
  if (typeof window !== 'undefined' && window.pharmacy) {
    return window.pharmacy;
  }
  throw new Error(
    'Pharmacy bridge is unavailable — the app must run inside the Electron shell (preload not loaded)',
  );
}

export function hasBridge(): boolean {
  return bridge !== null || (typeof window !== 'undefined' && Boolean(window.pharmacy));
}
