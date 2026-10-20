import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InventoryReportDto, SalesReportDto } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { DashboardReportDialog, type DashboardReportDialogProps } from './DashboardReportDialog';

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
  daily: [
    { date: '2026-10-15', revenue: '500.00', transactions: 5, units: 15 },
    { date: '2026-10-16', revenue: '575.50', transactions: 7, units: 19 },
  ],
  dailyPrevious: [],
  byCategory: [],
  topProducts: [
    {
      productId: 'p_1',
      sku: 'SKU-1',
      nameAr: 'أموكسيسيلين',
      units: 12,
      revenue: '600.00',
      invoices: 8,
    },
  ],
  payments: [],
};

const INVENTORY: InventoryReportDto = {
  generatedAt: '2026-10-16T10:00:00.000Z',
  nearExpiryDays: 90,
  stock: { units: 420, costValue: null, retailValue: null },
  health: { healthy: 30, low: 4, out: 2, total: 36 },
  reorder: [
    { productId: 'p_2', sku: 'SKU-2', nameAr: 'باراسيتامول', totalQuantity: 3, minStock: 10 },
  ],
  expiryBuckets: [
    { bucket: 'expired', batches: 2, units: 12, value: null },
    { bucket: 'd30', batches: 1, units: 5, value: null },
    { bucket: 'd60', batches: 0, units: 0, value: null },
    { bucket: 'd90', batches: 3, units: 20, value: null },
  ],
  upcomingExpiries: [],
  valueByCategory: [],
  fastMoving: [],
  slowMoving: [],
};

function renderDialog(overrides: Partial<DashboardReportDialogProps> = {}) {
  const onClose = vi.fn();
  const props: DashboardReportDialogProps = {
    open: true,
    onClose,
    sales: SALES,
    inventory: null,
    canViewCost: false,
    rangeLabel: 'من 10/10/2026 إلى 16/10/2026 • 7 أيام',
    range: { from: '2026-10-10', to: '2026-10-16' },
    ...overrides,
  };
  render(<DashboardReportDialog {...props} />);
  return { onClose };
}

describe('DashboardReportDialog', () => {
  it('previews the exact report document with its KPIs and tables', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Header title + report subtitle share the same label.
    expect(screen.getAllByText('تقرير لوحة التحكم').length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatMoney(SALES.revenue, 'ar-EG')).length).toBeGreaterThan(0);
    expect(screen.getByText('أموكسيسيلين')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تنزيل PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'طباعة' })).toBeInTheDocument();
  });

  it('renders the inventory snapshot when the sales report is not available', () => {
    renderDialog({ sales: null, inventory: INVENTORY });

    expect(
      screen.getByText('لقطة حالية للمخزون لا ترتبط بالفترة المحددة.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('باراسيتامول').length).toBeGreaterThan(0);
    expect(screen.queryByText(formatMoney(SALES.revenue, 'ar-EG'))).not.toBeInTheDocument();
  });

  it('closes on Escape and on an overlay click, but not on clicks inside', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(screen.getByText('نظام إدارة الصيدلية'));
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders nothing while closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
