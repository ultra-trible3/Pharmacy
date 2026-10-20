import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PermissionsPage } from './PermissionsPage';
import { RolesPage } from './RolesPage';
import { UsersPage } from './UsersPage';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const SEARCH_PLACEHOLDER = 'ابحث في الصلاحيات…';

describe('admin pages smoke', () => {
  it('renders the users page', () => {
    renderWithClient(<UsersPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'إدارة المستخدمين' })).toBeInTheDocument();
  });

  it('renders the roles page', () => {
    renderWithClient(<RolesPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'إدارة الأدوار' })).toBeInTheDocument();
    expect(screen.getAllByText('مالك').length).toBeGreaterThan(0);
  });

  it('renders the permissions page', () => {
    renderWithClient(<PermissionsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'الصلاحيات' })).toBeInTheDocument();
    expect(screen.getByText('إجمالي الصلاحيات')).toBeInTheDocument();
    expect(screen.getByText('الدفعات')).toBeInTheDocument();
  });
});

describe('permissions page filters', () => {
  it('filters the catalogue by role', async () => {
    const user = userEvent.setup();
    renderWithClient(<PermissionsPage />);

    await user.click(screen.getByRole('combobox', { name: 'تصفية حسب الدور' }));
    await user.click(await screen.findByRole('option', { name: 'كاشير' }));

    expect(screen.getByText('عرض صلاحيات دور كاشير')).toBeInTheDocument();
    // `settings:manage` is owner-only; `sales:create` is a cashier permission.
    expect(screen.queryByText('settings:manage')).not.toBeInTheDocument();
    expect(screen.getByText('sales:create')).toBeInTheDocument();
  });

  it('filters by search term and shows the empty state when nothing matches', async () => {
    const user = userEvent.setup();
    renderWithClient(<PermissionsPage />);

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), 'خصم');
    expect(screen.getByText('sales:discount')).toBeInTheDocument();
    expect(screen.queryByText('products:read')).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText(SEARCH_PLACEHOLDER));
    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), 'zzz');
    expect(screen.getByText('لا توجد صلاحيات مطابقة')).toBeInTheDocument();
  });
});
