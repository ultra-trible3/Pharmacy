import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { setBridge } from '../lib/bridge';
import { LoginPage } from './LoginPage';
import { useAuthStore } from '../store/auth';
import { createFakeBridge } from '../test/fake-bridge';

describe('LoginPage (Arabic-first, RTL)', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'anonymous', user: null, permissions: [], error: null });
  });

  it('renders Arabic labels inside an RTL container', () => {
    setBridge(createFakeBridge());
    const { container } = render(<LoginPage />);

    expect(screen.getByRole('heading', { name: 'تسجيل الدخول' })).toBeInTheDocument();
    expect(screen.getByLabelText('اسم المستخدم')).toBeInTheDocument();
    expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'دخول' })).toBeInTheDocument();

    // The page itself declares RTL so the whole form mirrors correctly.
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });

  it('validates the form before calling the bridge', async () => {
    const user = userEvent.setup();
    setBridge(createFakeBridge());
    render(<LoginPage />);

    await user.type(screen.getByLabelText('كلمة المرور'), 'short');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(
      await screen.findByText('كلمة المرور يجب أن تكون 8 أحرف على الأقل'),
    ).toBeInTheDocument();
  });

  it('shows the Arabic server error when credentials are rejected', async () => {
    const user = userEvent.setup();
    setBridge(
      createFakeBridge({
        login: () => ({
          ok: false,
          status: 401,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'اسم المستخدم أو كلمة المرور غير صحيحة',
          },
        }),
      }),
    );

    render(<LoginPage />);

    await user.type(screen.getByLabelText('اسم المستخدم'), 'owner');
    await user.type(screen.getByLabelText('كلمة المرور'), 'Pharma@2024');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('اسم المستخدم أو كلمة المرور غير صحيحة');
    expect(useAuthStore.getState().status).toBe('anonymous');
  });
});
