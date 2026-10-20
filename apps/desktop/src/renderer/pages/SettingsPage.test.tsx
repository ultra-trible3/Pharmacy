import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { useToastStore } from '../components/ui/toast';
import { useAuthStore } from '../store/auth';
import { useUiStore } from '../store/ui';

const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;

function signIn(role: 'OWNER' | 'CASHIER' = 'OWNER') {
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: 'u1', username: 'ziad', fullName: 'زياد محمد', role, isActive: true },
    permissions: [],
    error: null,
  });
}

describe('settings page', () => {
  it('renders the tabs and the appearance panel without emojis', () => {
    const { container } = render(<SettingsPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'الإعدادات' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'المظهر',
      'الأمان',
      'الإدارة',
      'النسخ الاحتياطي',
    ]);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('المظهر');
    expect(screen.getByText('سمة الواجهة')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(EMOJI_PATTERN);
  });

  it('applies a theme choice to the ui store', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole('button', { name: 'داكن' }));
    expect(useUiStore.getState().themeMode).toBe('dark');
    expect(screen.getByRole('button', { name: 'داكن' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches the interface language from the language select', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole('combobox', { name: 'اللغة' }));
    await user.click(await screen.findByRole('option', { name: 'English' }));

    expect(useUiStore.getState().locale).toBe('en');
  });

  it('shows the signed-in account and revokes sessions from the security tab', async () => {
    const user = userEvent.setup();
    signIn('OWNER');
    render(<SettingsPage />);

    await user.click(screen.getByRole('tab', { name: 'الأمان' }));

    expect(screen.getByText('زياد محمد')).toBeInTheDocument();
    expect(screen.getByText('ziad')).toBeInTheDocument();
    expect(screen.getByText('مالك')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'إنهاء جميع الجلسات' }));
    expect(
      useToastStore.getState().toasts.some((toast) => toast.message === 'تم إنهاء الجلسات المحدَّدة.'),
    ).toBe(true);
  });

  it('navigates to an admin page from the administration tab', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    signIn('OWNER');
    render(<SettingsPage onNavigate={onNavigate} />);

    await user.click(screen.getByRole('tab', { name: 'الإدارة' }));

    const usersCard = screen
      .getByText('المستخدمون')
      .closest('div.rounded-lg') as HTMLElement | null;
    expect(usersCard).not.toBeNull();
    await user.click(within(usersCard as HTMLElement).getByRole('button', { name: 'فتح' }));

    expect(onNavigate).toHaveBeenCalledWith('users');
  });

  it('locks admin pages the role cannot open', async () => {
    const user = userEvent.setup();
    signIn('CASHIER');
    render(<SettingsPage />);

    await user.click(screen.getByRole('tab', { name: 'الإدارة' }));

    const noAccess = screen.getAllByText('لا تملك صلاحية');
    expect(noAccess).toHaveLength(4);
    for (const badge of noAccess) {
      expect(badge.closest('div.rounded-lg')).not.toBeNull();
    }
    for (const openButton of screen.getAllByRole('button', { name: 'فتح' })) {
      expect(openButton).toBeDisabled();
    }
  });
});
