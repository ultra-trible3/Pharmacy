import type {
  ApiRequestPayload,
  ApiResponse,
  PharmacyBridge,
  SessionState,
} from '../../shared/ipc';

/**
 * A fully in-memory stand-in for the preload bridge.
 *
 * Renderer tests never touch Electron or the network: they inject this bridge
 * through `setBridge()` and assert on the resulting UI, which keeps the tests
 * fast and deterministic while still exercising the real component code.
 */
export interface FakeBridgeOptions {
  login?: (username: string, password: string) => ApiResponse<{
    user: { id: string; username: string; fullName: string; role: string; isActive: boolean };
    permissions: string[];
    accessTokenExpiresIn: number;
  }>;
  session?: SessionState;
  /** Return `undefined` to fall through to the path-aware default stub. */
  request?: (payload: ApiRequestPayload) => ApiResponse<unknown> | undefined;
  health?: PharmacyBridge['health'];
  print?: PharmacyBridge['print'];
}

export const DEMO_USER = {
  id: 'usr_owner',
  username: 'owner',
  fullName: 'أحمد عبد الرحمن',
  role: 'OWNER',
  isActive: true,
};

export const DEMO_PERMISSIONS = [
  'products:read',
  'products:write',
  'products:delete',
  'inventory:read',
  'inventory:adjust',
  'cost:view',
];

export const EMPTY_PAGE = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 25,
  totalPages: 0,
} as const;

/** Path-aware default so any page can render without a bespoke stub. */
function defaultRequest(payload: ApiRequestPayload): ApiResponse<unknown> {
  const { path, method } = payload;

  if (path === '/inventory/alerts') {
    return {
      ok: true,
      status: 200,
      data: {
        generatedAt: new Date().toISOString(),
        nearExpiryDays: 90,
        summary: {
          lowStockCount: 0,
          nearExpiryCount: 0,
          expiredCount: 0,
          totalStockUnits: 0,
        },
        lowStock: [],
        nearExpiry: [],
        expired: [],
      },
    };
  }

  if (path === '/warehouses') return { ok: true, status: 200, data: [] };

  if (path === '/sales/suspended') return { ok: true, status: 200, data: [] };

  if (path === '/sales/best-sellers') {
    return { ok: true, status: 200, data: { items: [], total: 0, page: 1, pageSize: 8 } };
  }

  if (path === '/sales/recent') return { ok: true, status: 200, data: { items: [] } };

  if (path === '/reports/sales') {
    const today = new Date().toISOString().slice(0, 10);
    return {
      ok: true,
      status: 200,
      data: {
        range: { from: today, to: today, days: 1, previousFrom: today, previousTo: today },
        revenue: '0.00',
        transactions: 0,
        itemsSold: 0,
        avgTicket: '0.00',
        previous: { revenue: '0.00', transactions: 0, itemsSold: 0, avgTicket: '0.00' },
        growth: { revenuePct: null, transactionsPct: null },
        profit: null,
        daily: [],
        dailyPrevious: [],
        byCategory: [],
        topProducts: [],
        payments: [],
      },
    };
  }

  if (path === '/reports/inventory') {
    const bucket = (key: string) => ({ bucket: key, batches: 0, units: 0, value: null });
    return {
      ok: true,
      status: 200,
      data: {
        generatedAt: new Date().toISOString(),
        nearExpiryDays: 90,
        stock: { units: 0, costValue: null, retailValue: null },
        health: { healthy: 0, low: 0, out: 0, total: 0 },
        reorder: [],
        expiryBuckets: [bucket('expired'), bucket('d30'), bucket('d60'), bucket('d90')],
        upcomingExpiries: [],
        valueByCategory: [],
        fastMoving: [],
        slowMoving: [],
      },
    };
  }

  if (method === 'GET') {
    if (
      path.startsWith('/products') ||
      path.startsWith('/inventory') ||
      path.startsWith('/categories') ||
      path.startsWith('/suppliers') ||
      path.startsWith('/customers') ||
      path.startsWith('/sales')
    ) {
      return { ok: true, status: 200, data: EMPTY_PAGE };
    }
  }

  return { ok: true, status: 200, data: {} };
}

export function createFakeBridge(options: FakeBridgeOptions = {}): PharmacyBridge {
  const listeners = new Set<(state: SessionState) => void>();

  return {
    appInfo: async () => ({
      name: 'PharmacyPOS',
      version: '0.1.0-test',
      electron: '33.0.0',
      chrome: '130.0.0',
      node: '20.18.0',
      platform: 'win32',
      apiBaseUrl: 'http://127.0.0.1:4000',
      isPackaged: false,
      terminalId: 'TERM-TEST01',
    }),

    health: options.health ?? (async () => ({ reachable: true, status: 'ok', latencyMs: 4 })),

    auth: {
      login: async (payload) => {
        const result = options.login
          ? options.login(payload.username, payload.password)
          : {
              ok: true as const,
              status: 200,
              data: {
                user: DEMO_USER,
                permissions: DEMO_PERMISSIONS,
                accessTokenExpiresIn: 900,
              },
            };
        if (result.ok) {
          const state: SessionState = {
            authenticated: true,
            user: result.data.user,
            permissions: result.data.permissions,
          };
          for (const listener of listeners) listener(state);
        }
        // The bridge returns a looser shape than ApiResponse's generic union.
        return result as Awaited<ReturnType<PharmacyBridge['auth']['login']>>;
      },
      logout: async () => {
        for (const listener of listeners) {
          listener({ authenticated: false, user: null, permissions: [] });
        }
      },
      session: async () => options.session ?? { authenticated: false, user: null, permissions: [] },
      onChange: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },

    api: {
      request: async <T = unknown>(payload: ApiRequestPayload) =>
        ((options.request ? options.request(payload) : undefined) ?? defaultRequest(payload)) as ApiResponse<T>,
    },

    print: options.print ?? (async () => ({ ok: true })),
  };
}
