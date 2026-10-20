import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AlertsPage } from './AlertsPage';
import { setBridge } from '../lib/bridge';
import { createFakeBridge } from '../test/fake-bridge';
import type { ApiRequestPayload, ApiResponse } from '../../shared/ipc';
import { useAuthStore } from '../store/auth';

const EXPIRED_BATCH = {
  batchId: 'b1',
  productId: 'p1',
  sku: 'SKU-1',
  productNameAr: 'أسبرين ٥٠٠',
  productNameEn: null,
  barcode: null,
  warehouseId: 'w1',
  warehouseNameAr: 'المخزن الرئيسي',
  lotNumber: 'LOT-1',
  expiryDate: '2026-09-01',
  manufactureDate: null,
  quantity: 3,
  costPrice: '5.00',
  salePrice: '9.00',
  daysToExpiry: -48,
  isExpired: true,
  isNearExpiry: false,
  stockValue: '15.00',
};

const NEAR_EXPIRY_BATCH = {
  ...EXPIRED_BATCH,
  batchId: 'b2',
  productId: 'p2',
  sku: 'SKU-2',
  productNameAr: 'فيتامين د',
  lotNumber: 'LOT-2',
  expiryDate: '2026-11-15',
  daysToExpiry: 27,
  isExpired: false,
  isNearExpiry: true,
};

const ALERTS_RESPONSE = {
  generatedAt: '2026-10-19T09:30:00.000Z',
  nearExpiryDays: 90,
  summary: { lowStockCount: 2, nearExpiryCount: 1, expiredCount: 1, totalStockUnits: 12 },
  expired: [EXPIRED_BATCH],
  nearExpiry: [NEAR_EXPIRY_BATCH],
  lowStock: [
    {
      productId: 'p3',
      sku: 'SKU-3',
      nameAr: 'باراسيتامول',
      nameEn: null,
      totalQuantity: 0,
      minStock: 10,
      isLowStock: true,
      nearestExpiry: '2026-12-01',
      stockValue: '0.00',
    },
    {
      productId: 'p4',
      sku: 'SKU-4',
      nameAr: 'أموكسيسيلين',
      nameEn: null,
      totalQuantity: 4,
      minStock: 20,
      isLowStock: true,
      nearestExpiry: null,
      stockValue: '40.00',
    },
  ],
};

const SUPPLIERS_RESPONSE = {
  items: [
    {
      id: 's1',
      code: 'SUP-1',
      nameAr: 'شركة الدواء',
      nameEn: null,
      phone: '0100000000',
      email: null,
      address: null,
      taxNumber: null,
      balance: '1500.00',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 200,
  totalPages: 1,
};

function withAlertsData(payload: unknown = ALERTS_RESPONSE) {
  return (request: ApiRequestPayload): ApiResponse<unknown> | undefined => {
    if (request.path === '/inventory/alerts') return { ok: true, status: 200, data: payload };
    if (request.path === '/suppliers') return { ok: true, status: 200, data: SUPPLIERS_RESPONSE };
    return undefined;
  };
}

function signIn() {
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: 'u1', username: 'ziad', fullName: 'زياد محمد', role: 'OWNER', isActive: true },
    permissions: [],
    error: null,
  });
}

function renderPage(onNavigate = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const result = render(
    <QueryClientProvider client={client}>
      <AlertsPage onNavigate={onNavigate} />
    </QueryClientProvider>,
  );
  return { ...result, onNavigate };
}

describe('alerts page', () => {
  it('lists expired, near-expiry, low stock and supplier payables', async () => {
    signIn();
    setBridge(createFakeBridge({ request: withAlertsData() }));
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'التنبيهات' })).toBeInTheDocument();

    // Expired batch with its stock value.
    expect(await screen.findByText('أسبرين ٥٠٠')).toBeInTheDocument();
    expect(screen.getByText(/SKU-1 • LOT-1/)).toBeInTheDocument();

    // Near-expiry batch and low-stock rows (out-of-stock first).
    expect(screen.getByText('فيتامين د')).toBeInTheDocument();
    expect(screen.getByText('باراسيتامول')).toBeInTheDocument();
    expect(screen.getByText('أموكسيسيلين')).toBeInTheDocument();
    expect(screen.getByText('نافد')).toBeInTheDocument();

    // Supplier payables section.
    expect(screen.getByText('شركة الدواء')).toBeInTheDocument();
  });

  it('navigates to inventory when an alert row is picked, and to suppliers for payables', async () => {
    const user = userEvent.setup();
    signIn();
    setBridge(createFakeBridge({ request: withAlertsData() }));
    const { onNavigate } = renderPage();

    await user.click(await screen.findByRole('button', { name: /أسبرين ٥٠٠/ }));
    expect(onNavigate).toHaveBeenCalledWith('inventory');

    await user.click(screen.getByRole('button', { name: /شركة الدواء/ }));
    expect(onNavigate).toHaveBeenCalledWith('suppliers');
  });

  it('shows the all-clear state when nothing needs attention', async () => {
    signIn();
    setBridge(createFakeBridge());
    renderPage();

    expect(await screen.findByText('لا توجد تنبيهات حالية')).toBeInTheDocument();
    expect(screen.queryByText('شركة الدواء')).not.toBeInTheDocument();
  });
});
