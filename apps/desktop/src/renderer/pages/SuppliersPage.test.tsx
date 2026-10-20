import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Toaster } from '../components/ui/toast';
import type { SupplierDto } from '../lib/api';
import { setBridge } from '../lib/bridge';
import { useAuthStore } from '../store/auth';
import { createFakeBridge, DEMO_USER } from '../test/fake-bridge';
import { SuppliersPage } from './SuppliersPage';

let suppliers: SupplierDto[];
let patchBody: Record<string, unknown> | null;
let deleteCalled: boolean;
let lastQuery: Record<string, string | number | boolean | undefined> | undefined;

function makeSupplier(overrides: Partial<SupplierDto> = {}): SupplierDto {
  return {
    id: 'sup_1',
    code: 'SUP-1',
    nameAr: 'شركة الأدوية المصرية',
    nameEn: 'Egyptian Pharma Co.',
    phone: '01000000001',
    email: 'sales@pharma.test',
    address: null,
    taxNumber: null,
    balance: '120.00',
    isActive: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SuppliersPage />
      <Toaster />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  suppliers = [makeSupplier()];
  patchBody = null;
  deleteCalled = false;
  lastQuery = undefined;
  useAuthStore.setState({
    status: 'authenticated',
    user: DEMO_USER,
    permissions: [],
    error: null,
  });
  setBridge(
    createFakeBridge({
      request: (payload) => {
        if (payload.path === '/suppliers' && payload.method === 'GET') {
          lastQuery = payload.query;
          return {
            ok: true,
            status: 200,
            data: {
              items: suppliers,
              total: suppliers.length,
              page: 1,
              pageSize: 25,
              totalPages: 1,
            },
          };
        }
        if (payload.path === '/suppliers/sup_1' && payload.method === 'PATCH') {
          patchBody = payload.body as Record<string, unknown>;
          suppliers = suppliers.map((supplier) =>
            supplier.id === 'sup_1'
              ? { ...supplier, ...(payload.body as Partial<SupplierDto>) }
              : supplier,
          );
          return { ok: true, status: 200, data: suppliers[0] };
        }
        if (payload.path === '/suppliers/sup_1' && payload.method === 'DELETE') {
          deleteCalled = true;
          suppliers = [];
          return { ok: true, status: 200, data: { deleted: true, deactivated: false } };
        }
        return undefined;
      },
    }),
  );
});

describe('SuppliersPage', () => {
  it('lists suppliers and opens the read-only details dialog', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('شركة الأدوية المصرية')).toBeInTheDocument();
    expect(screen.getByText('Egyptian Pharma Co.')).toBeInTheDocument();
    expect(screen.getByText('01000000001')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'عرض البيانات' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('بيانات المورد')).toBeInTheDocument();
    expect(within(dialog).getByText('sales@pharma.test')).toBeInTheDocument();
    // Owners can jump straight from the details view into the edit form.
    expect(within(dialog).getByRole('button', { name: 'تعديل' })).toBeInTheDocument();
  });

  it('updates a supplier from the edit dialog, clearing blank fields', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('شركة الأدوية المصرية');
    await user.click(screen.getByRole('button', { name: 'تعديل' }));

    const dialog = await screen.findByRole('dialog');
    const nameAr = within(dialog).getByLabelText(/الاسم بالعربية/);
    await user.clear(nameAr);
    await user.type(nameAr, 'شركة دواء جديدة');

    const phone = within(dialog).getByLabelText('الهاتف');
    await user.clear(phone);
    await user.type(phone, '01112223333');

    await user.click(within(dialog).getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody).toEqual({
      nameAr: 'شركة دواء جديدة',
      nameEn: 'Egyptian Pharma Co.',
      phone: '01112223333',
      email: 'sales@pharma.test',
      address: null,
      taxNumber: null,
      isActive: true,
    });
    expect(await screen.findByText('تم تحديث بيانات المورد بنجاح')).toBeInTheDocument();
  });

  it('deletes a supplier after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('شركة الأدوية المصرية');
    await user.click(screen.getByRole('button', { name: 'حذف' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'حذف' }));

    await waitFor(() => expect(deleteCalled).toBe(true));
    expect(await screen.findByText('تم حذف المورد')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('شركة الأدوية المصرية')).not.toBeInTheDocument(),
    );
  });

  it('includes deactivated suppliers on demand', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('شركة الأدوية المصرية');
    expect(lastQuery?.includeInactive).toBe(false);

    await user.click(screen.getByRole('checkbox', { name: 'عرض غير النشطين' }));
    await waitFor(() => expect(lastQuery?.includeInactive).toBe(true));
  });

  it('hides management actions from read-only roles', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { ...DEMO_USER, role: 'ACCOUNTANT' },
      permissions: ['suppliers:read'],
      error: null,
    });
    renderPage();

    await screen.findByText('شركة الأدوية المصرية');
    expect(screen.getByRole('button', { name: 'عرض البيانات' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تعديل' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حذف' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'مورد جديد' })).not.toBeInTheDocument();
  });
});
