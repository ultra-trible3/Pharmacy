/**
 * The IPC contract between the Electron main process and the renderer.
 *
 * This file is imported by main, preload and renderer, so it must stay free of
 * Node and DOM APIs. Channel names are the single source of truth for the
 * preload whitelist — nothing else is ever exposed to the renderer.
 */

export const IPC = {
  appInfo: 'app:info',
  appHealth: 'app:health',
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authSession: 'auth:session',
  /** Main -> renderer push when the session changes (e.g. refresh, revocation). */
  authChanged: 'auth:changed',
  apiRequest: 'api:request',
  /** Renderer -> main: print the current window (the label sheet). */
  appPrint: 'app:print',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiRequestPayload {
  method: HttpMethod;
  /** Path relative to the API base, e.g. `/products`. */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export type ApiResponse<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiErrorShape };

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  apiBaseUrl: string;
  isPackaged: boolean;
  terminalId: string;
}

export interface ServerHealth {
  reachable: boolean;
  status?: string;
  latencyMs?: number;
  error?: string;
}

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface LoginResult {
  user: SessionUser;
  permissions: string[];
  accessTokenExpiresIn: number;
}

export interface SessionState {
  authenticated: boolean;
  user: SessionUser | null;
  permissions: string[];
}

/** Options for `webContents.print` exposed to the renderer. */
export interface PrintOptions {
  /** Open the OS print dialog (default). Only set false for a fixed device. */
  silent?: boolean;
  /** Print CSS backgrounds/graphics. Defaults to true in the main process. */
  printBackground?: boolean;
  /** Target printer when `silent` is true. */
  deviceName?: string;
}

export type PrintResult =
  | { ok: true }
  | { ok: false; cancelled: boolean; error: string };

/** Shape mounted on `window.pharmacy` by the preload bridge. */
export interface PharmacyBridge {
  appInfo(): Promise<AppInfo>;
  health(): Promise<ServerHealth>;
  auth: {
    login(payload: LoginPayload): Promise<ApiResponse<LoginResult>>;
    logout(): Promise<void>;
    session(): Promise<SessionState>;
    /** Subscribe to session changes; returns an unsubscribe function. */
    onChange(listener: (state: SessionState) => void): () => void;
  };
  api: {
    request<T = unknown>(payload: ApiRequestPayload): Promise<ApiResponse<T>>;
  };
  /** Prints the current window; the label sheet is revealed by print CSS. */
  print(options?: PrintOptions): Promise<PrintResult>;
}
