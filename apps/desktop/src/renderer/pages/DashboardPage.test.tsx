import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryReportDto, SalesReportDto } from '../lib/api';
import { setBridge } from '../lib/bridge';
import { useAuthStore } from '../store/auth';
import { createFakeBridge } from '../test/fake-bridge';
import { DashboardPage } from './DashboardPage';

const SALES: SalesReportDto = {
  range: {
    from: '2026-10-10',
    to: '2026-10-16',
    days: 7,
    previousFrom: '2026-10-03',
    previousTo: '2026-10-09',
  },
  revenue: '1075.50',
  transactions: 12,
  itemsSold: 34,
  avgTicket: '89.63',
  previous: { revenue: '900.00', transactions: 10, itemsSold: 30, avgTicket: '90.00' },
  growth: { revenuePct: 19.5, transactionsPct: 20 },
  profit: null,
  daily: [{ date: '2026-10-16', revenue: '1075.50', transactions: 12, units: 34 }],
  dailyPrevious: [],
  byCategory: [],
  topProducts: [],
  payments: [],
};

const INVENTORY: InventoryReportDto = {
  generatedAt: '2026-10-16T10:00:00.000Z',
  nearExpiryDays: 90,
  stock: { units: 420, costValue: '5200.00', retailValue: '7400.00' },
  health: { healthy: 30, low: 4, out: 2, total: 36 },
  reorder: [
    { productId: 'p_2', sku: 'SKU-2', nameAr: 'باراسيتامول', totalQuantity: 3, minStock: 10 },
  ],
  expiryBuckets: [
    { bucket: 'expired', batches: 2, units: 12, value: '120.00' },
    { bucket: 'd30', batches: 1, units: 5, value: '50.00' },
    { bucket: 'd60', batches: 0, units: 0, value: '0.00' },
    { bucket: 'd90', batches: 3, units: 20, value: '200.00' },
  ],
  upcomingExpiries: [],
  valueByCategory: [],
  fastMoving: [],
  slowMoving: [],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <DashboardPage onNavigate={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: 'usr_owner', username: 'owner', fullName: 'أحمد عبد الرحمن', role: 'OWNER', isActive: true },
    permissions: [],
    error: null,
  });
  setBridge(
    createFakeBridge({
      request: (payload) => {
        if (payload.path === '/reports/sales') return { ok: true, status: 200, data: SALES };
        if (payload.path === '/reports/inventory') return { ok: true, status: 200, data: INVENTORY };
        return undefined;
      },
    }),
  );
});

describe('DashboardPage', () => {
  it('switches between the overview, sales and inventory views', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('tab', { name: 'نظرة عامة' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The overview keeps the alert centre and the quick-action rail.
    expect(await screen.findByText('التنبيهات')).toBeInTheDocument();
    expect(screen.getByText('إجراءات سريعة')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'تحليلات المبيعات' }));
    expect(await screen.findByText('اتجاه المبيعات')).toBeInTheDocument();
    expect(screen.queryByText('إجراءات سريعة')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'تحليلات المخزون' }));
    expect(await screen.findByText('حالة المخزون')).toBeInTheDocument();
    expect(screen.getByText('الأصناف المطلوبة')).toBeInTheDocument();
  });

  it('opens the printable report preview from the command bar', async () => {
    const user = userEvent.setup();
    renderPage();

    const pdfButton = screen.getByRole('button', { name: 'تصدير PDF' });
    const excelButton = screen.getByRole('button', { name: 'تصدير Excel' });
    // Exports stay disabled until at least one report has loaded.
    expect(pdfButton).toBeDisabled();
    await waitFor(() => expect(pdfButton).toBeEnabled());
    expect(excelButton).toBeEnabled();

    await user.click(pdfButton);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تنزيل PDF' })).toBeInTheDocument();
  });
});
