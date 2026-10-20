import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ProductListItem } from '@pharmacy/shared';
import type { ApiRequestPayload, ApiResponse, PrintOptions } from '../../../shared/ipc';
import { setBridge } from '../../lib/bridge';
import { createFakeBridge } from '../../test/fake-bridge';
import { Toaster } from '../ui/toast';
import { PrintLabelsDialog } from './PrintLabelsDialog';

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

function renderDialog(products: ProductListItem[], canWrite = false): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <PrintLabelsDialog
        open
        onOpenChange={() => undefined}
        products={products}
        canWrite={canWrite}
      />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('PrintLabelsDialog', () => {
  it('delegates the print job to the Electron bridge', async () => {
    const user = userEvent.setup();
    const calls: Array<PrintOptions | undefined> = [];
    setBridge(
      createFakeBridge({
        print: async (options) => {
          calls.push(options);
          return { ok: true };
        },
      }),
    );

    renderDialog([product({ id: 'p1', nameAr: 'أوجمنتين 1 جم', barcode: '6221000000010' })]);

    expect(screen.getAllByText('أوجمنتين 1 جم').length).toBeGreaterThan(0);
    // The sheet is portaled onto <body> so print CSS can reveal it.
    expect(document.querySelector('.label-print-root')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'طباعة' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ silent: false });
  });

  it('warns about barcodes that cannot be printed and can assign one', async () => {
    const user = userEvent.setup();
    let assignCalls = 0;
    setBridge(
      createFakeBridge({
        print: async () => ({ ok: true }),
        request: (payload: ApiRequestPayload): ApiResponse<unknown> => {
          if (payload.method === 'POST' && payload.path === '/products/barcodes/assign') {
            assignCalls += 1;
            return { ok: true, status: 200, data: { assigned: 1, remaining: 0 } };
          }
          return { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'nope' } };
        },
      }),
    );

    renderDialog([product({ id: 'p1', nameAr: 'صنف بلا باركود', barcode: null })], true);

    expect(screen.getByText(/بدون باركود قابل للطباعة/u)).toBeInTheDocument();
    // Nothing printable yet, so the print button is disabled.
    expect(screen.getByRole('button', { name: 'طباعة' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'إسناد باركود ناقص' }));
    await waitFor(() => expect(assignCalls).toBe(1));
  });
});
