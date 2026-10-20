import type { TranslationKey } from '../i18n/dictionaries';
import type { PaymentMethodCode } from '@pharmacy/shared';
import type { InventoryReportDto, SalesReportDto } from './api';
import { formatDate, formatDateTime } from './format';

/**
 * Excel export for the dashboard report.
 *
 * `buildDashboardSheets` is a pure data mapper (unit-testable, no workbook
 * dependency); `downloadDashboardExcel` lazy-loads the XLSX writer and saves
 * the file, mirroring how receipt PDFs trigger downloads.
 */

export type Translator = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

/** A spreadsheet cell in the dashboard's own, library-agnostic shape. */
export interface ExportCell {
  value: string | number | null;
  bold?: boolean;
  header?: boolean;
  money?: boolean;
  integer?: boolean;
  percent?: boolean;
}

export interface DashboardSheet {
  /** Translation key of the sheet (tab) name. */
  nameKey: TranslationKey;
  /** Column widths in Excel character units. */
  columns: number[];
  rows: ExportCell[][];
}

export interface DashboardExportInput {
  sales: SalesReportDto | null;
  inventory: InventoryReportDto | null;
  canViewCost: boolean;
  t: Translator;
  tag: string;
  generatedAt: Date;
}

const PAYMENT_LABEL_KEYS: Record<PaymentMethodCode, TranslationKey> = {
  cash: 'pos.payment.cash',
  card: 'pos.payment.card',
  wallet: 'pos.payment.wallet',
  credit: 'pos.payment.credit',
};

const money = (value: string | number | null | undefined): ExportCell => {
  const parsed = value === null || value === undefined ? NaN : Number(value);
  return { value: Number.isFinite(parsed) ? parsed : null, money: true };
};

const count = (value: number | null | undefined): ExportCell => ({
  value: value ?? null,
  integer: true,
});

const text = (value: string | number | null | undefined): ExportCell => ({
  value: value ?? null,
});

const label = (value: string): ExportCell => ({ value, bold: true });

const head = (value: string): ExportCell => ({ value, header: true });

const blank: ExportCell[] = [];

/**
 * Maps the dashboard reports onto workbook sheets. Only the data the user is
 * allowed to see is exported: `sales` is null without `sales:read`, cost and
 * value columns are null without `cost:view` (stripped server-side).
 */
export function buildDashboardSheets(input: DashboardExportInput): DashboardSheet[] {
  const { sales, inventory, canViewCost, t, tag, generatedAt } = input;
  const sheets: DashboardSheet[] = [];

  // --- Summary ------------------------------------------------------------
  const summary: ExportCell[][] = [
    [head(t('dashboard.report.title'))],
    blank,
    [label(t('dashboard.report.generatedAt')), text(formatDateTime(generatedAt, tag))],
  ];
  if (sales) {
    summary.push([
      label(t('dashboard.from')),
      text(formatDate(sales.range.from, tag)),
    ]);
    summary.push([
      label(t('dashboard.to')),
      text(formatDate(sales.range.to, tag)),
    ]);
  }
  if (sales) {
    summary.push(blank, [head(t('nav.sales'))]);
    summary.push([label(t('dashboard.revenue')), money(sales.revenue)]);
    summary.push([label(t('dashboard.transactions')), count(sales.transactions)]);
    summary.push([label(t('dashboard.units')), count(sales.itemsSold)]);
    summary.push([label(t('dashboard.avgTicket')), money(sales.avgTicket)]);
    summary.push([label(t('dashboard.previousPeriod')), money(sales.previous.revenue)]);
    if (canViewCost && sales.profit) {
      summary.push([label(t('dashboard.grossProfit')), money(sales.profit.grossProfit)]);
      summary.push([label(t('dashboard.netRevenue')), money(sales.profit.netRevenue)]);
      summary.push([label(t('dashboard.cogs')), money(sales.profit.cogs)]);
      if (sales.profit.marginPct !== null) {
        summary.push([
          label(t('dashboard.margin')),
          { value: sales.profit.marginPct, percent: true },
        ]);
      }
    }
  }
  if (inventory) {
    summary.push(blank, [head(t('nav.inventory'))], [label(t('dashboard.stockUnits')), count(inventory.stock.units)]);
    if (canViewCost && inventory.stock.costValue !== null) {
      summary.push([
        label(t('dashboard.inventoryValueCost')),
        money(inventory.stock.costValue),
      ]);
    }
    if (canViewCost && inventory.stock.retailValue !== null) {
      summary.push([
        label(t('dashboard.inventoryValueRetail')),
        money(inventory.stock.retailValue),
      ]);
    }
    summary.push([label(t('dashboard.healthy')), count(inventory.health.healthy)]);
    summary.push([label(t('dashboard.lowStock')), count(inventory.health.low)]);
    summary.push([label(t('dashboard.outOfStock')), count(inventory.health.out)]);
    const expired = inventory.expiryBuckets.find((bucket) => bucket.bucket === 'expired');
    const nearExpiry = inventory.expiryBuckets
      .filter((bucket) => bucket.bucket !== 'expired')
      .reduce((sum, bucket) => sum + bucket.batches, 0);
    summary.push([label(t('dashboard.expired')), count(expired?.batches ?? 0)]);
    summary.push([label(t('dashboard.nearExpiry')), count(nearExpiry)]);
  }
  sheets.push({ nameKey: 'dashboard.report.summary', columns: [32, 22], rows: summary });

  // --- Sales sheets -------------------------------------------------------
  if (sales) {
    const daily: ExportCell[][] = [
      [
        head(t('dashboard.report.date')),
        head(t('dashboard.revenue')),
        head(t('dashboard.transactions')),
        head(t('dashboard.units')),
      ],
    ];
    for (const point of sales.daily) {
      daily.push([
        text(formatDate(point.date, tag)),
        money(point.revenue),
        count(point.transactions),
        count(point.units),
      ]);
    }
    daily.push([
      label(t('dashboard.report.total')),
      { ...money(sales.revenue), bold: true },
      { ...count(sales.transactions), bold: true },
      { ...count(sales.itemsSold), bold: true },
    ]);
    sheets.push({ nameKey: 'dashboard.report.sheetDaily', columns: [16, 16, 14, 12], rows: daily });

    const categories: ExportCell[][] = [
      [
        head(t('dashboard.report.category')),
        head(t('dashboard.units')),
        head(t('dashboard.revenue')),
      ],
      ...sales.byCategory.map((row): ExportCell[] => [
        text(row.nameAr ?? t('dashboard.uncategorized')),
        count(row.units),
        money(row.revenue),
      ]),
    ];
    sheets.push({ nameKey: 'dashboard.byCategory', columns: [28, 14, 18], rows: categories });

    const products: ExportCell[][] = [
      [
        head('SKU'),
        head(t('dashboard.report.productName')),
        head(t('dashboard.units')),
        head(t('dashboard.invoices')),
        head(t('dashboard.revenue')),
      ],
      ...sales.topProducts.map((row): ExportCell[] => [
        text(row.sku),
        text(row.nameAr),
        count(row.units),
        count(row.invoices),
        money(row.revenue),
      ]),
    ];
    sheets.push({ nameKey: 'dashboard.topProducts', columns: [16, 36, 12, 12, 18], rows: products });

    const payments: ExportCell[][] = [
      [
        head(t('dashboard.report.paymentMethod')),
        head(t('dashboard.invoices')),
        head(t('dashboard.report.amount')),
      ],
      ...sales.payments.map((row): ExportCell[] => [
        text(t(PAYMENT_LABEL_KEYS[row.method] ?? 'cash')),
        count(row.count),
        money(row.amount),
      ]),
    ];
    sheets.push({ nameKey: 'dashboard.payments', columns: [20, 14, 18], rows: payments });
  }

  // --- Inventory sheets ---------------------------------------------------
  if (inventory) {
    const stock: ExportCell[][] = [
      [head(t('dashboard.stockHealth'))],
      [label(t('dashboard.stockUnits')), count(inventory.stock.units)],
    ];
    if (canViewCost && inventory.stock.costValue !== null) {
      stock.push([label(t('dashboard.inventoryValueCost')), money(inventory.stock.costValue)]);
    }
    if (canViewCost && inventory.stock.retailValue !== null) {
      stock.push([
        label(t('dashboard.inventoryValueRetail')),
        money(inventory.stock.retailValue),
      ]);
    }
    stock.push([label(t('dashboard.healthy')), count(inventory.health.healthy)]);
    stock.push([label(t('dashboard.lowStock')), count(inventory.health.low)]);
    stock.push([label(t('dashboard.outOfStock')), count(inventory.health.out)]);
    stock.push(blank, [head(t('dashboard.stockExpiry'))]);

    const bucketLabels: Record<string, TranslationKey> = {
      expired: 'dashboard.bucketExpired',
      d30: 'dashboard.bucket0to30',
      d60: 'dashboard.bucket31to60',
      d90: 'dashboard.bucket61to90',
    };
    const hasBucketValue = inventory.expiryBuckets.some((bucket) => bucket.value !== null);
    stock.push([
      head(t('dashboard.stockExpiry')),
      head(t('dashboard.report.batches')),
      head(t('dashboard.units')),
      ...(hasBucketValue ? [head(t('dashboard.report.amount'))] : []),
    ]);
    for (const bucket of inventory.expiryBuckets) {
      stock.push([
        text(t(bucketLabels[bucket.bucket] ?? 'dashboard.stockExpiry')),
        count(bucket.batches),
        count(bucket.units),
        ...(hasBucketValue ? [money(bucket.value)] : []),
      ]);
    }
    sheets.push({
      nameKey: 'nav.inventory',
      columns: [34, 14, 14, 18].slice(0, hasBucketValue ? 4 : 3),
      rows: stock,
    });

    const reorder: ExportCell[][] = [
      [
        head('SKU'),
        head(t('dashboard.report.productName')),
        head(t('dashboard.report.stockQty')),
        head(t('dashboard.report.minStock')),
      ],
      ...inventory.reorder.map((row): ExportCell[] => [
        text(row.sku),
        text(row.nameAr),
        count(row.totalQuantity),
        count(row.minStock),
      ]),
    ];
    sheets.push({ nameKey: 'dashboard.reorderList', columns: [16, 36, 14, 14], rows: reorder });

    const expiries: ExportCell[][] = [
      [
        head('SKU'),
        head(t('dashboard.report.productName')),
        head(t('dashboard.report.lotNumber')),
        head(t('dashboard.report.expiryDate')),
        head(t('dashboard.report.daysLeft')),
        head(t('dashboard.report.stockQty')),
        ...(hasBucketValue ? [head(t('dashboard.report.amount'))] : []),
      ],
      ...inventory.upcomingExpiries.map((row): ExportCell[] => [
        text(row.sku),
        text(row.nameAr),
        text(row.lotNumber),
        text(formatDate(row.expiryDate, tag)),
        count(row.daysToExpiry),
        count(row.quantity),
        ...(hasBucketValue ? [money(row.value)] : []),
      ]),
    ];
    sheets.push({
      nameKey: 'dashboard.upcomingExpiries',
      columns: [16, 32, 16, 14, 12, 12, 18].slice(0, hasBucketValue ? 7 : 6),
      rows: expiries,
    });

    const fast: ExportCell[][] = [
      [
        head('SKU'),
        head(t('dashboard.report.productName')),
        head(t('dashboard.units')),
        head(t('dashboard.invoices')),
      ],
      ...inventory.fastMoving.map((row): ExportCell[] => [
        text(row.sku),
        text(row.nameAr),
        count(row.units),
        count(row.invoices),
      ]),
    ];
    sheets.push({ nameKey: 'dashboard.fastMoving', columns: [16, 36, 14, 14], rows: fast });

    const slow: ExportCell[][] = [
      [
        head('SKU'),
        head(t('dashboard.report.productName')),
        head(t('dashboard.report.stockQty')),
        head(t('dashboard.report.units30d')),
        head(t('dashboard.report.lastSale')),
      ],
      ...inventory.slowMoving.map((row): ExportCell[] => [
        text(row.sku),
        text(row.nameAr),
        count(row.totalQuantity),
        count(row.units30d),
        text(row.lastSoldAt ? formatDate(row.lastSoldAt, tag) : t('dashboard.neverSoldPeriod')),
      ]),
    ];
    sheets.push({ nameKey: 'dashboard.slowMoving', columns: [16, 36, 14, 16, 16], rows: slow });
  }

  return sheets;
}

type WorkbookCell = {
  value: string | number;
  type?: StringConstructor | NumberConstructor;
  format?: string;
  fontWeight?: 'bold';
  backgroundColor?: string;
  borderColor?: string;
  borderStyle?: 'thin';
};

/** Empty cells must be the standalone `null` the writer expects. */
function toWorkbookCell(cell: ExportCell): WorkbookCell | null {
  if (cell.value === null) return null;

  const mapped: WorkbookCell = { value: cell.value };
  if (typeof cell.value === 'number') mapped.type = Number;
  else mapped.type = String;

  if (cell.money) mapped.format = '#,##0.00';
  else if (cell.integer) mapped.format = '#,##0';
  else if (cell.percent) mapped.format = '#,##0.0"%"';

  if (cell.bold || cell.header) mapped.fontWeight = 'bold';
  if (cell.header) {
    mapped.backgroundColor = '#F1F5F9';
    mapped.borderColor = '#CBD5E1';
    mapped.borderStyle = 'thin';
  }
  return mapped;
}

/**
 * Writes the built sheets to an `.xlsx` download. The writer is imported on
 * demand so the (sizeable) XLSX code only loads when a user exports.
 */
export async function downloadDashboardExcel(
  sheets: DashboardSheet[],
  t: Translator,
  fileName: string,
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await writeXlsxFile(
    sheets.map((sheet) => ({
      // Excel caps sheet names at 31 characters.
      sheet: t(sheet.nameKey).slice(0, 31),
      data: sheet.rows.map((row) => row.map(toWorkbookCell)),
      columns: sheet.columns.map((width) => ({ width })),
      rightToLeft: true,
      stickyRowsCount: 1,
    })),
    { fontFamily: 'Segoe UI' },
  ).toFile(fileName);
}
