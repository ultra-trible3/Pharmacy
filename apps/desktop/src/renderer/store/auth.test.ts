import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setBridge } from '../lib/bridge';
import { useAuthStore } from './auth';
import { DEMO_PERMISSIONS, DEMO_USER, createFakeBridge } from '../test/fake-bridge';

describe('auth store', () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: 'loading',
      user: null,
      permissions: [],
      error: null,
    });
  });

  it('bootstraps into the anonymous state when there is no session', async () => {
    setBridge(createFakeBridge());
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('logs in and exposes the session to the UI', async () => {
    setBridge(createFakeBridge());
    await useAuthStore.getState().login('owner', 'Pharma@2024');

    const state = useAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.user?.username).toBe('owner');
    expect(state.permissions).toEqual(DEMO_PERMISSIONS);
  });

  it('resolves permissions from the role matrix via can()', async () => {
    setBridge(createFakeBridge());
    await useAuthStore.getState().login('owner', 'Pharma@2024');

    // OWNER implicitly holds every permission.
    expect(useAuthStore.getState().can('products:read')).toBe(true);
    expect(useAuthStore.getState().can('users:manage')).toBe(true);
    expect(useAuthStore.getState().can('backup:manage')).toBe(true);
  });

  it('denies permissions a limited role does not hold', async () => {
    setBridge(
      createFakeBridge({
        login: () => ({
          ok: true,
          status: 200,
          data: {
            user: { ...DEMO_USER, username: 'cashier', role: 'CASHIER' },
            permissions: ['products:read'],
            accessTokenExpiresIn: 900,
          },
        }),
      }),
    );

    await useAuthStore.getState().login('cashier', 'Pharma@2024');
    expect(useAuthStore.getState().can('products:read')).toBe(true);
    expect(useAuthStore.getState().can('products:write')).toBe(false);
    expect(useAuthStore.getState().can('cost:view')).toBe(false);
  });

  it('surfaces the server error message and stays anonymous', async () => {
    setBridge(
      createFakeBridge({
        login: () => ({
          ok: false,
          status: 401,
          error: { code: 'INVALID_CREDENTIALS', message: 'اسم المستخدم أو كلمة المرور غير صحيحة' },
        }),
      }),
    );

    await expect(useAuthStore.getState().login('owner', 'wrongpass1')).rejects.toThrow();

    const state = useAuthStore.getState();
    expect(state.status).toBe('anonymous');
    expect(state.error).toBe('اسم المستخدم أو كلمة المرور غير صحيحة');
  });

  it('clears the session on logout', async () => {
    const onLogout = vi.fn();
    const bridge = createFakeBridge();
    bridge.auth.logout = async () => {
      onLogout();
    };
    setBridge(bridge);

    await useAuthStore.getState().login('owner', 'Pharma@2024');
    await useAuthStore.getState().logout();

    expect(onLogout).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().user).toBeNull();
  });
});
