import type {
  ApiErrorShape,
  ApiRequestPayload,
  ApiResponse,
  LoginPayload,
  LoginResult,
  ServerHealth,
  SessionState,
} from '../shared/ipc.js';
import type { SessionStore } from './session.js';

interface RawSessionResponse {
  user: LoginResult['user'];
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  permissions: string[];
}

/**
 * The only component that talks to the API server.
 *
 * Runs in the Electron **main** process so that:
 *  - access tokens never enter the renderer's memory,
 *  - there is no CORS surface in production,
 *  - a single place enforces token refresh, timeouts and error normalisation.
 */
export class ApiClient {
  constructor(
    private readonly sessions: SessionStore,
    private readonly baseUrl: string,
    private readonly terminalId: string,
    private readonly onSessionChanged: (state: SessionState) => void,
  ) {}

  get apiBaseUrl(): string {
    return this.baseUrl;
  }

  private async raw(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parse<T>(response: Response): Promise<ApiResponse<T>> {
    const text = await response.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: { code: 'INVALID_JSON', message: text.slice(0, 300) } };
      }
    }

    if (response.ok) {
      return { ok: true, status: response.status, data: body as T };
    }

    const shape = (body as { error?: ApiErrorShape } | undefined)?.error;
    return {
      ok: false,
      status: response.status,
      error: {
        code: shape?.code ?? `HTTP_${response.status}`,
        message: shape?.message ?? response.statusText ?? 'طلب غير ناجح',
        ...(shape?.details !== undefined ? { details: shape.details } : {}),
        ...(shape?.requestId ? { requestId: shape.requestId } : {}),
      },
    };
  }

  async health(): Promise<ServerHealth> {
    const started = Date.now();
    try {
      const response = await this.raw('/readyz', { method: 'GET', timeoutMs: 4_000 });
      const body = (await response.json()) as { status?: string };
      return {
        reachable: true,
        status: body.status ?? 'unknown',
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async login(payload: LoginPayload): Promise<ApiResponse<LoginResult>> {
    const response = await this.raw('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-terminal-id': this.terminalId },
      body: JSON.stringify(payload),
    });

    const parsed = await this.parse<RawSessionResponse>(response);
    if (!parsed.ok) return parsed;

    const data = parsed.data!;
    this.sessions.set({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user,
      permissions: data.permissions,
      accessTokenExpiresAt: Date.now() + data.accessTokenExpiresIn * 1000,
    });
    const state = this.sessionState();
    this.onSessionChanged(state);

    return {
      ok: true,
      status: parsed.status,
      data: {
        user: data.user,
        permissions: data.permissions,
        accessTokenExpiresIn: data.accessTokenExpiresIn,
      },
    };
  }

  async logout(): Promise<void> {
    const session = this.sessions.get();
    if (session) {
      try {
        await this.raw('/api/v1/auth/logout', {
          method: 'POST',
          headers: { authorization: `Bearer ${session.accessToken}` },
          timeoutMs: 5_000,
        });
      } catch {
        // Logging out locally must succeed even if the server is unreachable.
      }
    }
    this.sessions.clear();
    this.onSessionChanged(this.sessionState());
  }

  sessionState(): SessionState {
    const session = this.sessions.get();
    return {
      authenticated: session !== null,
      user: session?.user ?? null,
      permissions: session?.permissions ?? [],
    };
  }

  /** Attempts a silent token refresh. Returns true when a new token is available. */
  private async refresh(): Promise<boolean> {
    const session = this.sessions.get();
    if (!session) return false;

    try {
      const response = await this.raw('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
        timeoutMs: 8_000,
      });
      const parsed = await this.parse<RawSessionResponse>(response);
      if (!parsed.ok) {
        this.sessions.clear();
        this.onSessionChanged(this.sessionState());
        return false;
      }
      const data = parsed.data!;
      this.sessions.set({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
        permissions: data.permissions,
        accessTokenExpiresAt: Date.now() + data.accessTokenExpiresIn * 1000,
      });
      this.onSessionChanged(this.sessionState());
      return true;
    } catch {
      return false;
    }
  }

  /** Authenticated request with a single transparent refresh-and-retry. */
  async request<T>(payload: ApiRequestPayload): Promise<ApiResponse<T>> {
    if (!this.sessions.get()) {
      return {
        ok: false,
        status: 401,
        error: { code: 'UNAUTHENTICATED', message: 'يجب تسجيل الدخول' },
      };
    }

    if (this.sessions.isExpired()) {
      await this.refresh();
    }

    const send = async (): Promise<Response> => {
      const session = this.sessions.get();
      const url = new URL(`${this.baseUrl}/api/v1${payload.path}`);
      for (const [key, value] of Object.entries(payload.query ?? {})) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }

      return this.raw(url.pathname + url.search, {
        method: payload.method,
        headers: {
          'content-type': 'application/json',
          ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
          'x-terminal-id': this.terminalId,
        },
        ...(payload.body !== undefined ? { body: JSON.stringify(payload.body) } : {}),
      });
    };

    let response = await send();
    if (response.status === 401) {
      const refreshed = await this.refresh();
      if (refreshed) response = await send();
    }

    return this.parse<T>(response);
  }

  /** Restores a persisted refresh token at startup. */
  async restore(): Promise<boolean> {
    const persisted = this.sessions.loadPersisted();
    if (!persisted?.refreshToken) return false;

    this.sessions.set({
      accessToken: '',
      refreshToken: persisted.refreshToken,
      user: persisted.user ?? {
        id: '',
        username: '',
        fullName: '',
        role: 'CASHIER',
        isActive: true,
      },
      permissions: [],
      accessTokenExpiresAt: 0,
    });

    const ok = await this.refresh();
    if (!ok) this.sessions.clear();
    return ok;
  }
}
