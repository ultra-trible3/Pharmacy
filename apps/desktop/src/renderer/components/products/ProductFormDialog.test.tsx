import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductListItem } from '@pharmacy/shared';
import type { ApiRequestPayload, ApiResponse } from '../../../shared/ipc';
import { dictionaries } from '../../i18n/dictionaries';
import { setBridge } from '../../lib/bridge';
import { useAuthStore } from '../../store/auth';
import { createFakeBridge, DEMO_USER } from '../../test/fake-bridge';
import { Toaster } from '../ui/toast';
import { ProductFormDialog } from './ProductFormDialog';

const ar = dictionaries.ar;

function product(
  overrides: Partial<ProductListItem> & Pick<ProductListItem, 'id' | 'nameAr'>,
): ProductListItem {
  return {
    sku: 'SKU-0001',
    barcode: null,
    nameEn: null,
    brand: null,
    manufacturer: null,
    categoryId: null,
    categoryNameAr: null,
    dosageForm: 'TABLET',
    strength: null,
    packSize: null,
    unit: null,
    costPrice: '0.00',
    salePrice: '10.00',
    taxRate: '0.00',
    minStock: 0,
    prescriptionClass: 'OTC',
    isActive: true,
    totalStock: 0,
    nearestExpiry: null,
    hasImage: false,
    ...overrides,
  };
}

interface BridgeLog {
  created: number;
  adjustments: Array<Record<string, unknown>>;
}

/** Fake bridge that records product creates and stock adjustments. */
function setupBridge(): BridgeLog {
  const log: BridgeLog = { created: 0, adjustments: [] };
  setBridge(
    createFakeBridge({
      request: (payload: ApiRequestPayload): ApiResponse<unknown> | undefined => {
        if (payload.method === 'POST' && payload.path === '/products') {
          log.created += 1;
          return { ok: true, status: 201, data: product({ id: 'prd_new', nameAr: 'صنف جديد' }) };
        }
        if (payload.method === 'PATCH' && payload.path.startsWith('/products/')) {
          return {
            ok: true,
            status: 200,
            data: product({ id: payload.path.slice('/products/'.length), nameAr: 'صنف' }),
          };
        }
        if (payload.method === 'GET' && payload.path === '/warehouses') {
          return {
            ok: true,
            status: 200,
            data: [
              {
                id: 'wh_1',
                code: 'MAIN',
                nameAr: 'المخزن الرئيسي',
                nameEn: null,
                isDefault: true,
                isActive: true,
              },
            ],
          };
        }
        if (payload.method === 'POST' && payload.path === '/inventory/adjustments') {
          log.adjustments.push((payload.body ?? {}) as Record<string, unknown>);
          return { ok: true, status: 201, data: { quantity: 10 } };
        }
        return undefined;
      },
    }),
  );
  return log;
}

function renderDialog(target: ProductListItem | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ProductFormDialog open onOpenChange={onOpenChange} product={target} />
      <Toaster />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/الكود/u), 'SKU-100');
  await user.type(screen.getByLabelText(/الاسم العربي/u), 'بروفين 400');
  await user.type(screen.getByLabelText(/سعر البيع/u), '25.00');
}

describe('ProductFormDialog stock', () => {
  beforeEach(() => {
    // `can()` resolves permissions from the user's role, not the array.
    useAuthStore.setState({
      status: 'authenticated',
      user: DEMO_USER,
      permissions: ['products:read', 'products:write', 'inventory:adjust'],
      error: null,
    });
  });

  it('books an opening-stock movement after creating the product', async () => {
    const user = userEvent.setup();
    const log = setupBridge();
    const onOpenChange = renderDialog(null);

    await fillRequiredFields(user);
    await user.type(screen.getByLabelText(/الرصيد الافتتاحي/u), '10');
    await user.type(screen.getByLabelText(/رقم التشغيلة/u), 'LOT-001');
    fireEvent.change(screen.getByLabelText(/تاريخ انتهاء الصلاحية/u), {
      target: { value: '2027-12-31' },
    });

    await user.click(screen.getByRole('button', { name: ar['common.save'] }));

    await waitFor(() => expect(log.adjustments).toHaveLength(1));
    expect(log.created).toBe(1);
    expect(log.adjustments[0]).toMatchObject({
      productId: 'prd_new',
      warehouseId: 'wh_1',
      type: 'ADJUSTMENT_IN',
      quantity: 10,
      lotNumber: 'LOT-001',
      expiryDate: '2027-12-31',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('refuses to save a stock increase without lot number and expiry', async () => {
    const user = userEvent.setup();
    const log = setupBridge();
    renderDialog(null);

    await fillRequiredFields(user);
    await user.type(screen.getByLabelText(/الرصيد الافتتاحي/u), '10');

    await user.click(screen.getByRole('button', { name: ar['common.save'] }));

    await screen.findByText(/أدخل رقم التشغيلة وتاريخ الانتهاء لزيادة الرصيد/u);
    expect(log.created).toBe(0);
    expect(log.adjustments).toHaveLength(0);
  });

  it('lowers the balance with a FEFO adjustment when editing stock down', async () => {
    const user = userEvent.setup();
    const log = setupBridge();
    const onOpenChange = renderDialog(
      product({ id: 'prd_1', nameAr: 'باراسيتامول', totalStock: 10 }),
    );

    expect(screen.getByText('الرصيد الحالي: 10')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/الرصيد/u));
    await user.type(screen.getByLabelText(/الرصيد/u), '4');
    // A decrease is FEFO-allocated by the server, so no lot inputs appear.
    expect(screen.queryByLabelText(/رقم التشغيلة/u)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: ar['common.save'] }));

    await waitFor(() => expect(log.adjustments).toHaveLength(1));
    expect(log.adjustments[0]).toMatchObject({
      productId: 'prd_1',
      warehouseId: 'wh_1',
      type: 'ADJUSTMENT_OUT',
      quantity: 6,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
