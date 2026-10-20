import { describe, expect, it } from 'vitest';
import type { InventoryReportDto, SalesReportDto } from './api';
import { buildDashboardSheets, type Translator } from './dashboardExcel';
import { formatDate } from './format';

const t: Translator = (key) => key;

const NOW = new Date('2026-10-16T10:00:00.000Z');

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
  profit: {
    cogs: '600.00',
    netRevenue: '935.22',
    grossProfit: '335.22',
    marginPct: 35.8,
    previous: { cogs: '500.00', netRevenue: '782.61', grossProfit: '282.61', marginPct: 36.1 },
  },
  daily: [
    { date: '2026-10-15', revenue: '500.00', transactions: 5, units: 15 },
    { date: '2026-10-16', revenue: '575.50', transactions: 7, units: 19 },
  ],
  dailyPrevious: [],
  byCategory: [
    { categoryId: 'cat_1', nameAr: 'مضادات حيوية', revenue: '700.00', units: 20 },
    { categoryId: null, nameAr: null, revenue: '375.50', units: 14 },
  ],
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
  payments: [
    { method: 'cash', amount: '800.00', count: 9 },
    { method: 'card', amount: '275.50', count: 3 },
  ],
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
  upcomingExpiries: [
    {
      batchId: 'b_1',
      productId: 'p_2',
      sku: 'SKU-2',
      nameAr: 'باراسيتامول',
      lotNumber: 'LOT-9',
      expiryDate: '2026-11-10',
      daysToExpiry: 25,
      quantity: 5,
      value: '50.00',
    },
  ],
  valueByCategory: [],
  fastMoving: [
    { productId: 'p_1', sku: 'SKU-1', nameAr: 'أموكسيسيلين', units: 12, invoices: 8 },
  ],
  slowMoving: [
    {
      productId: 'p_3',
      sku: 'SKU-3',
      nameAr: 'شراب سعال',
      totalQuantity: 40,
      units30d: 0,
      lastSoldAt: null,
    },
  ],
};

function build(input: {
  sales: SalesReportDto | null;
  inventory: InventoryReportDto | null;
  canViewCost?: boolean;
}) {
  return buildDashboardSheets({
    sales: input.sales,
    inventory: input.inventory,
    canViewCost: input.canViewCost ?? true,
    t,
    tag: 'ar-EG',
    generatedAt: NOW,
  });
}

function sheetByKey(
  sheets: ReturnType<typeof buildDashboardSheets>,
  key: string,
): ReturnType<typeof buildDashboardSheets>[number] {
  const sheet = sheets.find((candidate) => candidate.nameKey === key);
  if (!sheet) throw new Error(`Sheet ${key} not found`);
  return sheet;
}

describe('buildDashboardSheets', () => {
  it('maps both reports onto ordered, fully labelled sheets', () => {
    const sheets = build({ sales: SALES, inventory: INVENTORY });

    expect(sheets.map((sheet) => sheet.nameKey)).toEqual([
      'dashboard.report.summary',
      'dashboard.report.sheetDaily',
      'dashboard.byCategory',
      'dashboard.topProducts',
      'dashboard.payments',
      'nav.inventory',
      'dashboard.reorderList',
      'dashboard.upcomingExpiries',
      'dashboard.fastMoving',
      'dashboard.slowMoving',
    ]);
  });

  it('writes daily sales as numbers with a bold authoritative total row', () => {
    const sheets = build({ sales: SALES, inventory: null });
    const daily = sheetByKey(sheets, 'dashboard.report.sheetDaily');

    expect(daily.rows[0]?.map((cell) => cell.value)).toEqual([
      'dashboard.report.date',
      'dashboard.revenue',
      'dashboard.transactions',
      'dashboard.units',
    ]);
    expect(daily.rows[0]?.every((cell) => cell.header)).toBe(true);

    expect(daily.rows[1]?.map((cell) => cell.value)).toEqual([
      formatDate('2026-10-15', 'ar-EG'),
      500,
      5,
      15,
    ]);
    expect(daily.rows[1]?.[1]).toMatchObject({ value: 500, money: true });

    const totals = daily.rows[daily.rows.length - 1]!;
    expect(totals.map((cell) => cell.value)).toEqual(['dashboard.report.total', 1075.5, 12, 34]);
    expect(totals.slice(1).every((cell) => cell.bold)).toBe(true);
  });

  it('summarises sales, profit and inventory KPIs as numeric cells', () => {
    const sheets = build({ sales: SALES, inventory: INVENTORY });
    const summary = sheetByKey(sheets, 'dashboard.report.summary');

    expect(
      summary.rows.some((row) => row[0]?.value === 'dashboard.revenue' && row[1]?.value === 1075.5),
    ).toBe(true);
    expect(summary.rows.some((row) => row[0]?.value === 'dashboard.grossProfit' && row[1]?.value === 335.22)).toBe(true);
    expect(summary.rows.some((row) => row[0]?.value === 'dashboard.margin' && row[1]?.percent)).toBe(true);
    expect(
      summary.rows.some((row) => row[0]?.value === 'dashboard.inventoryValueCost' && row[1]?.value === 5200),
    ).toBe(true);
    // Expired batches and the three near-expiry buckets are aggregated.
    expect(
      summary.rows.some((row) => row[0]?.value === 'dashboard.expired' && row[1]?.value === 2),
    ).toBe(true);
    expect(
      summary.rows.some((row) => row[0]?.value === 'dashboard.nearExpiry' && row[1]?.value === 4),
    ).toBe(true);
  });

  it('hides profit rows without cost:view', () => {
    const sheets = build({ sales: SALES, inventory: null, canViewCost: false });
    const summary = sheetByKey(sheets, 'dashboard.report.summary');
    expect(summary.rows.some((row) => row[0]?.value === 'dashboard.grossProfit')).toBe(false);
  });

  it('drops cost/value columns entirely when the server stripped them', () => {
    const stripped: InventoryReportDto = {
      ...INVENTORY,
      stock: { units: 420, costValue: null, retailValue: null },
      expiryBuckets: INVENTORY.expiryBuckets.map((bucket) => ({ ...bucket, value: null })),
      upcomingExpiries: INVENTORY.upcomingExpiries.map((row) => ({ ...row, value: null })),
    };
    const sheets = build({ sales: null, inventory: stripped, canViewCost: false });

    expect(sheets.map((sheet) => sheet.nameKey)).toEqual([
      'dashboard.report.summary',
      'nav.inventory',
      'dashboard.reorderList',
      'dashboard.upcomingExpiries',
      'dashboard.fastMoving',
      'dashboard.slowMoving',
    ]);

    const stock = sheetByKey(sheets, 'nav.inventory');
    expect(stock.rows.some((row) => row[0]?.value === 'dashboard.inventoryValueCost')).toBe(false);
    const bucketHeader = stock.rows.find((row) => row[1]?.value === 'dashboard.report.batches');
    expect(bucketHeader).toHaveLength(3);

    const expiries = sheetByKey(sheets, 'dashboard.upcomingExpiries');
    expect(expiries.rows[1]).toHaveLength(6);
  });

  it('exports only what the reports contain', () => {
    expect(build({ sales: null, inventory: null })).toEqual([
      expect.objectContaining({ nameKey: 'dashboard.report.summary' }),
    ]);
  });
});
