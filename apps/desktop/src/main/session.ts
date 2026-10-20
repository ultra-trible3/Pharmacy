import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SessionUser } from '../shared/ipc.js';

interface PersistedSession {
  refreshToken: string;
  /** Present so the renderer can restore a friendly UI before the first refresh. */
  user: SessionUser | null;
  apiBaseUrl: string;
  savedAt: string;
}

export interface ActiveSession {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
  permissions: string[];
  accessTokenExpiresAt: number;
}

/**
 * Holds the authentication material for the terminal.
 *
 * Access tokens live **only in main-process memory**. The refresh token is
 * persisted to disk encrypted with Electron's `safeStorage` (DPAPI on Windows)
 * so a terminal can resume its session after a restart without keeping any
 * credential in the renderer.
 */
export class SessionStore {
  private session: ActiveSession | null = null;
  private readonly file: string;

  constructor() {
    this.file = join(app.getPath('userData'), 'session.bin');
  }

  private ensureDir(): void {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  set(session: ActiveSession): void {
    this.session = session;
    this.persist();
  }

  get(): ActiveSession | null {
    return this.session;
  }

  patchTokens(accessToken: string, refreshToken: string, expiresInSeconds: number): void {
    if (!this.session) return;
    this.session.accessToken = accessToken;
    this.session.refreshToken = refreshToken;
    this.session.accessTokenExpiresAt = Date.now() + expiresInSeconds * 1000;
    this.persist();
  }

  clear(): void {
    this.session = null;
    try {
      if (existsSync(this.file)) writeFileSync(this.file, '');
    } catch {
      // best effort
    }
  }

  isExpired(skewSeconds = 20): boolean {
    if (!this.session) return true;
    return this.session.accessTokenExpiresAt - skewSeconds * 1000 <= Date.now();
  }

  /** Reads a previously persisted refresh token, if any. */
  loadPersisted(): PersistedSession | null {
    try {
      if (!existsSync(this.file)) return null;
      const raw = readFileSync(this.file);
      if (raw.length === 0) return null;

      const decrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(raw)
        : raw.toString('utf8');
      return JSON.parse(decrypted) as PersistedSession;
    } catch {
      return null;
    }
  }

  private persist(): void {
    if (!this.session) return;
    try {
      this.ensureDir();
      const payload: PersistedSession = {
        refreshToken: this.session.refreshToken,
        user: this.session.user,
        apiBaseUrl: process.env.PHARMACY_API_URL ?? 'http://127.0.0.1:4000',
        savedAt: new Date().toISOString(),
      };
      const serialised = JSON.stringify(payload);
      if (safeStorage.isEncryptionAvailable()) {
        writeFileSync(this.file, safeStorage.encryptString(serialised));
      } else {
        // Explicitly refuse to write plaintext credentials to disk.
        console.warn('[session] OS encryption unavailable — session will not persist across restarts');
      }
    } catch (error) {
      console.error('[session] failed to persist session', error);
    }
  }
}
