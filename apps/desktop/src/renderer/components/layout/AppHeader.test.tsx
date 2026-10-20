import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppHeader } from './AppHeader';
import { setBridge } from '../../lib/bridge';
import { createFakeBridge } from '../../test/fake-bridge';
import { useNotificationsStore } from '../../store/notifications';
import { useUiStore } from '../../store/ui';

function alertBatch(overrides: Record<string, unknown>) {
  return {
    productId: 'prod_1',
    productNameAr: 'دواء',
    productNameEn: null,
    barcode: null,
    warehouseId: 'wh_1',
    warehouseNameAr: 'المخزن الرئيسي',
    manufactureDate: null,
    quantity: 10,
    costPrice: '10.00',
    salePrice: '15.00',
    isExpired: false,
    isNearExpiry: false,
    stockValue: '100.00',
    ...overrides,
  };
}

const ALERTS = {
  generatedAt: '2026-10-16T09:00:00.000Z',
  nearExpiryDays: 90,
  summary: { lowStockCount: 1, nearExpiryCount: 1, expiredCount: 1, totalStockUnits: 100 },
  lowStock: [
    {
      productId: 'prod_low',
      sku: 'SKU-LOW',
      nameAr: 'باراسيتامول',
      nameEn: null,
      totalQuantity: 2,
      minStock: 10,
      isLowStock: true,
      nearestExpiry: null,
      stockValue: '20.00',
    },
  ],
  nearExpiry: [
    alertBatch({
      batchId: 'batch_near',
      sku: 'SKU-NEAR',
      productNameAr: 'أموكسيسيلين',
      lotNumber: 'LOT-2',
      expiryDate: '2026-11-01',
      daysToExpiry: 16,
      isNearExpiry: true,
    }),
  ],
  expired: [
    alertBatch({
      batchId: 'batch_expired',
      sku: 'SKU-EXP',
      productNameAr: 'شراب سعال',
      lotNumber: 'LOT-3',
      expiryDate: '2026-09-01',
      daysToExpiry: -45,
      isExpired: true,
    }),
  ],
};

function renderHeader() {
  const onNavigate = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <AppHeader page="dashboard" title="لوحة التحكم" onNavigate={onNavigate} />
    </QueryClientProvider>,
  );
  return { onNavigate };
}

describe('AppHeader notification centre', () => {
  it('shows unread alerts, marks them read and navigates on click', async () => {
    const user = userEvent.setup();
    setBridge(
      createFakeBridge({
        request: (payload) =>
          payload.path === '/inventory/alerts'
            ? { ok: true, status: 200, data: ALERTS }
            : undefined,
      }),
    );
    const { onNavigate } = renderHeader();

    const bell = screen.getByRole('button', { name: 'التنبيهات' });
    // All three alerts are unread: expired, near expiry and low stock.
    await waitFor(() => expect(within(bell).getByText('3')).toBeInTheDocument());

    await user.click(bell);
    expect(screen.getByText('منتهية الصلاحية: شراب سعال')).toBeInTheDocument();
    expect(screen.getByText('قارب على الانتهاء: أموكسيسيلين (16 يوم)')).toBeInTheDocument();
    expect(screen.getByText('مخزون منخفض: باراسيتامول (2 وحدة)')).toBeInTheDocument();

    // Clicking a notification navigates to the screen that fixes it and
    // consumes one unread item.
    await user.click(screen.getByText('منتهية الصلاحية: شراب سعال'));
    expect(onNavigate).toHaveBeenCalledWith('inventory');
    await waitFor(() => expect(within(bell).getByText('2')).toBeInTheDocument());

    // The per-item "mark as read" button consumes one more without navigating.
    await user.click(bell);
    const markButtons = screen.getAllByRole('button', { name: 'تحديد كمقروء' });
    expect(markButtons).toHaveLength(2);
    await user.click(markButtons[0]!);
    await waitFor(() => expect(within(bell).getByText('1')).toBeInTheDocument());
    expect(onNavigate).toHaveBeenCalledTimes(1);

    // "Mark all as read" clears the badge and persists the read flags.
    await user.click(screen.getByRole('button', { name: 'تحديد الكل كمقروء' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'تحديد الكل كمقروء' })).toBeDisabled(),
    );
    expect(within(bell).queryByText('1')).not.toBeInTheDocument();
    expect(useNotificationsStore.getState().readIds).toEqual([
      'expired-batch_expired',
      'near-batch_near',
      'low-prod_low',
    ]);
  });
});

describe('AppHeader appearance menu', () => {
  it('selects and persists the theme mode', async () => {
    const user = userEvent.setup();
    setBridge(createFakeBridge());
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'المظهر' }));
    expect(screen.getByRole('button', { name: 'حسب النظام' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'داكن' }));
    expect(useUiStore.getState().themeMode).toBe('dark');
    expect(window.localStorage.getItem('pharmacy.theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'المظهر' }));
    await user.click(screen.getByRole('button', { name: 'فاتح' }));
    expect(useUiStore.getState().themeMode).toBe('light');
    expect(window.localStorage.getItem('pharmacy.theme')).toBe('light');
  });
});
