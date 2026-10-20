import type { PharmacyBridge } from '../../shared/ipc';

declare global {
  interface Window {
    /** Injected by the preload bridge (see src/preload.ts). */
    pharmacy: PharmacyBridge;
  }
}

export {};
