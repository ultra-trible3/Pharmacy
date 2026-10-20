import { Prisma } from '@prisma/client';
import {
  BUSINESS_DEFAULTS,
  hasPermission,
  roundCurrency,
  type PaymentMethodCode,
  type Role,
  type SalesReportQuery,
} from '@pharmacy/shared';
import { prisma } from '../../prisma.js';
import {
  BUSINESS_TIMEZONE,
  businessDayStart,
  daysUntil,
  toDateOnly,
  toIso,
  todayInBusinessTimezone,
} from '../../lib/dates.js';
import { ValidationError } from '../../lib/errors.js';

/**
 * Dashboard reporting aggregates.
 *
 * Every number is derived from live rows — never from cached totals:
 *  - revenue is the sum of `COMPLETED` sale totals (VAT-inclusive, net of
 *    item/invoice discounts and redeemed loyalty points);
 *  - COGS comes from the `ISSUE` stock movements that the checkout writes,
 *    keyed back to the sale through `reference = invoiceNumber`. That is the
 *    actual consumed batch cost (FEFO), so gross profit is
 *    `(total − taxAmount) − cogs` — VAT is a liability, not profit;
 *  - voided sales are excluded naturally because their status is `VOIDED`;
 *  - all calendar grouping happens in the pharmacy business timezone.
 */

/** Maximum window accepted by the sales report (inclusive day count). */
const MAX_RANGE_DAYS = 366;

/** Rolling window used by the fast/slow-moving inventory analytics. */
const MOVEMENT_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Date helpers (pure date-only arithmetic, no timezone drift)
// ---------------------------------------------------------------------------

function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

function enumerateDates(from: string, to: string, limit = MAX_RANGE_DAYS): string[] {
  const dates: string[] = [];
  for (let cursor = from; cursor <= to && dates.length < limit; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

interface ResolvedRange {
  from: string;
  to: string;
  days: number;
  previousFrom: string;
  previousTo: string;
  /** Inclusive UTC instant of the first business day. */
  start: Date;
  /** Exclusive UTC instant after the last business day. */
  endExclusive: Date;
  previousStart: Date;
  previousEndExclusive: Date;
}

function resolveRange(query: SalesReportQuery): ResolvedRange {
  const today = todayInBusinessTimezone();
  const from = query.from ?? today;
  const to = query.to ?? today;
  if (from > to) {
    throw new ValidationError('الفترة غير صحيحة: تاريخ البداية بعد تاريخ النهاية');
  }
  const days = diffDays(from, to) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new ValidationError(`الفترة الزمنية كبيرة جدًا (الحد الأقصى ${MAX_RANGE_DAYS} يومًا)`);
  }

  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  return {
    from,
    to,
    days,
    previousFrom,
    previousTo,
    start: businessDayStart(from),
    endExclusive: businessDayStart(addDays(to, 1)),
    previousStart: businessDayStart(previousFrom),
    previousEndExclusive: businessDayStart(from),
  };
}

function percentChange(current: string | number, previous: string | number): number | null {
  const baseline = Number(previous);
  if (!Number.isFinite(baseline) || baseline === 0) return null;
  return Math.round(((Number(current) - baseline) / baseline) * 1_000) / 10;
}

function marginPercent(netRevenue: string, grossProfit: string): number | null {
  const base = Number(netRevenue);
  if (!Number.isFinite(base) || base <= 0) return null;
  return Math.round((Number(grossProfit) / base) * 1_000) / 10;
}

// ---------------------------------------------------------------------------
// Sales report
// ---------------------------------------------------------------------------

export interface SalesReportTotals {
  revenue: string;
  transactions: number;
  itemsSold: number;
  avgTicket: string;
}

export interface SalesReportProfit {
  cogs: string;
  netRevenue: string;
  grossProfit: string;
  marginPct: number | null;
}

export interface SalesReportPoint {
  date: string;
  revenue: string;
  transactions: number;
  units: number;
}

export interface SalesReport {
  range: {
    from: string;
    to: string;
    days: number;
    previousFrom: string;
    previousTo: string;
  };
  revenue: string;
  transactions: number;
  itemsSold: number;
  avgTicket: string;
  previous: SalesReportTotals;
  growth: { revenuePct: number | null; transactionsPct: number | null };
  profit: (SalesReportProfit & { previous: SalesReportProfit }) | null;
  daily: SalesReportPoint[];
  dailyPrevious: Array<{ date: string; revenue: string }>;
  byCategory: Array<{ categoryId: string | null; nameAr: string | null; revenue: string; units: number }>;
  topProducts: Array<{ productId: string; sku: string; nameAr: string; units: number; revenue: string; invoices: number }>;
  payments: Array<{ method: PaymentMethodCode; amount: string; count: number }>;
}

interface RangeTotals {
  revenue: string;
  tax: string;
  transactions: number;
  itemsSold: number;
}

async function salesTotals(start: Date, endExclusive: Date): Promise<RangeTotals> {
  const [salesRows, itemRows] = await Promise.all([
    prisma.$queryRaw<Array<{ revenue: string; tax: string; transactions: number }>>`
      SELECT COALESCE(SUM(s.total), 0)::text AS revenue,
             COALESCE(SUM(s."taxAmount"), 0)::text AS tax,
             COUNT(*)::int AS transactions
      FROM sales s
      WHERE s.status = 'COMPLETED'
        AND s."createdAt" >= ${start}
        AND s."createdAt" < ${endExclusive}
    `,
    prisma.$queryRaw<Array<{ units: number }>>`
      SELECT COALESCE(SUM(si.quantity), 0)::int AS units
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s.status = 'COMPLETED'
        AND s."createdAt" >= ${start}
        AND s."createdAt" < ${endExclusive}
    `,
  ]);

  const row = salesRows[0];
  return {
    revenue: roundCurrency(row?.revenue ?? '0'),
    tax: roundCurrency(row?.tax ?? '0'),
    transactions: row?.transactions ?? 0,
    itemsSold: itemRows[0]?.units ?? 0,
  };
}

/**
 * Cost of goods sold for the range: the summed actual cost of the ISSUE
 * movements the checkout wrote, matched to their sale via the invoice number.
 */
async function rangeCogs(start: Date, endExclusive: Date): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ cogs: string }>>`
    SELECT COALESCE(SUM(m.quantity * m."unitCost"), 0)::text AS cogs
    FROM stock_movements m
    JOIN sales s ON s."invoiceNumber" = m.reference
    WHERE m.type = 'ISSUE'
      AND s.status = 'COMPLETED'
      AND s."createdAt" >= ${start}
      AND s."createdAt" < ${endExclusive}
  `;
  return roundCurrency(rows[0]?.cogs ?? '0');
}

interface DailyRow {
  revenue: string;
  transactions: number;
  units: number;
}

async function dailyTotals(start: Date, endExclusive: Date): Promise<Map<string, DailyRow>> {
  const [revenueRows, unitRows] = await Promise.all([
    prisma.$queryRaw<Array<{ date: string; revenue: string; transactions: number }>>`
      SELECT to_char((s."createdAt" AT TIME ZONE ${Prisma.raw(`'${BUSINESS_TIMEZONE}'`)})::date, 'YYYY-MM-DD') AS date,
             COALESCE(SUM(s.total), 0)::text AS revenue,
             COUNT(*)::int AS transactions
      FROM sales s
      WHERE s.status = 'COMPLETED'
        AND s."createdAt" >= ${start}
        AND s."createdAt" < ${endExclusive}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<Array<{ date: string; units: number }>>`
      SELECT to_char((s."createdAt" AT TIME ZONE ${Prisma.raw(`'${BUSINESS_TIMEZONE}'`)})::date, 'YYYY-MM-DD') AS date,
             COALESCE(SUM(si.quantity), 0)::int AS units
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s.status = 'COMPLETED'
        AND s."createdAt" >= ${start}
        AND s."createdAt" < ${endExclusive}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const byDate = new Map<string, DailyRow>();
  for (const row of revenueRows) {
    byDate.set(row.date, { revenue: roundCurrency(row.revenue), transactions: row.transactions, units: 0 });
  }
  for (const row of unitRows) {
    const existing = byDate.get(row.date) ?? { revenue: '0.00', transactions: 0, units: 0 };
    existing.units = row.units;
    byDate.set(row.date, existing);
  }
  return byDate;
}

/** Zero-filled day series so charts always have a continuous axis. */
function toSeries(
  dates: string[],
  byDate: Map<string, DailyRow>,
): { daily: SalesReportPoint[]; dailyPrevious: Array<{ date: string; revenue: string }> } {
  const daily = dates.map((date) => {
    const row = byDate.get(date);
    return {
      date,
      revenue: row?.revenue ?? '0.00',
      transactions: row?.transactions ?? 0,
      units: row?.units ?? 0,
    };
  });
  return {
    daily,
    dailyPrevious: daily.map((point) => ({ date: point.date, revenue: '0.00' })),
  };
}

async function categoryBreakdown(
  start: Date,
  endExclusive: Date,
): Promise<SalesReport['byCategory']> {
  const rows = await prisma.$queryRaw<
    Array<{ categoryId: string | null; nameAr: string | null; revenue: string; units: number }>
  >`
    SELECT p."categoryId" AS "categoryId",
           c."nameAr" AS "nameAr",
           COALESCE(SUM(si."lineTotal"), 0)::text AS revenue,
           COALESCE(SUM(si.quantity), 0)::int AS units
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    JOIN products p ON p.id = si."productId"
    LEFT JOIN categories c ON c.id = p."categoryId"
    WHERE s.status = 'COMPLETED'
      AND s."createdAt" >= ${start}
      AND s."createdAt" < ${endExclusive}
    GROUP BY 1, 2
    ORDER BY SUM(si."lineTotal") DESC
    LIMIT 8
  `;
  return rows.map((row) => ({
    categoryId: row.categoryId,
    nameAr: row.nameAr,
    revenue: roundCurrency(row.revenue),
    units: row.units,
  }));
}

async function topProducts(
  start: Date,
  endExclusive: Date,
): Promise<SalesReport['topProducts']> {
  const rows = await prisma.$queryRaw<
    Array<{ productId: string; units: number; revenue: string; invoices: number }>
  >`
    SELECT si."productId" AS "productId",
           COALESCE(SUM(si.quantity), 0)::int AS units,
           COALESCE(SUM(si."lineTotal"), 0)::text AS revenue,
           COUNT(DISTINCT si."saleId")::int AS invoices
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    WHERE s.status = 'COMPLETED'
      AND s."createdAt" >= ${start}
      AND s."createdAt" < ${endExclusive}
    GROUP BY 1
    ORDER BY SUM(si.quantity) DESC, SUM(si."lineTotal") DESC
    LIMIT 8
  `;
  if (rows.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((row) => row.productId) } },
    select: { id: true, sku: true, nameAr: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  return rows.flatMap((row) => {
    const product = byId.get(row.productId);
    if (!product) return [];
    return [
      {
        productId: row.productId,
        sku: product.sku,
        nameAr: product.nameAr,
        units: row.units,
        revenue: roundCurrency(row.revenue),
        invoices: row.invoices,
      },
    ];
  });
}

async function paymentBreakdown(
  start: Date,
  endExclusive: Date,
): Promise<SalesReport['payments']> {
  const rows = await prisma.$queryRaw<Array<{ method: string; amount: string; count: number }>>`
    SELECT pay.method::text AS method,
           COALESCE(SUM(pay.amount), 0)::text AS amount,
           COUNT(*)::int AS count
    FROM payments pay
    JOIN sales s ON s.id = pay."saleId"
    WHERE s.status = 'COMPLETED'
      AND s."createdAt" >= ${start}
      AND s."createdAt" < ${endExclusive}
    GROUP BY 1
    ORDER BY SUM(pay.amount) DESC
  `;
  return rows.map((row) => ({
    method: row.method.toLowerCase() as PaymentMethodCode,
    amount: roundCurrency(row.amount),
    count: row.count,
  }));
}

function totalsToDto(totals: RangeTotals): SalesReportTotals {
  return {
    revenue: totals.revenue,
    transactions: totals.transactions,
    itemsSold: totals.itemsSold,
    avgTicket:
      totals.transactions > 0
        ? roundCurrency(Number(totals.revenue) / totals.transactions)
        : '0.00',
  };
}

export async function getSalesReport(query: SalesReportQuery, role: Role): Promise<SalesReport> {
  const range = resolveRange(query);
  const canViewCost = hasPermission(role, 'cost:view');

  const [current, previous, dailyByDate, previousDailyByDate, byCategory, top, payments] =
    await Promise.all([
      salesTotals(range.start, range.endExclusive),
      salesTotals(range.previousStart, range.previousEndExclusive),
      dailyTotals(range.start, range.endExclusive),
      dailyTotals(range.previousStart, range.previousEndExclusive),
      categoryBreakdown(range.start, range.endExclusive),
      topProducts(range.start, range.endExclusive),
      paymentBreakdown(range.start, range.endExclusive),
    ]);

  // Cost/profit is only assembled for roles holding `cost:view`; the payload
  // omits it entirely otherwise so the renderer cannot leak it by accident.
  let profit: SalesReport['profit'] = null;
  if (canViewCost) {
    const [cogs, previousCogs] = await Promise.all([
      rangeCogs(range.start, range.endExclusive),
      rangeCogs(range.previousStart, range.previousEndExclusive),
    ]);
    const netRevenue = roundCurrency(Number(current.revenue) - Number(current.tax));
    const grossProfit = roundCurrency(Number(netRevenue) - Number(cogs));
    const previousNetRevenue = roundCurrency(
      Number(previous.revenue) - Number(previous.tax),
    );
    const previousGrossProfit = roundCurrency(Number(previousNetRevenue) - Number(previousCogs));
    profit = {
      cogs,
      netRevenue,
      grossProfit,
      marginPct: marginPercent(netRevenue, grossProfit),
      previous: {
        cogs: previousCogs,
        netRevenue: previousNetRevenue,
        grossProfit: previousGrossProfit,
        marginPct: marginPercent(previousNetRevenue, previousGrossProfit),
      },
    };
  }

  const currentDates = enumerateDates(range.from, range.to, range.days);
  const previousDates = enumerateDates(range.previousFrom, range.previousTo, range.days);
  const series = toSeries(currentDates, dailyByDate);
  const previousSeries = toSeries(previousDates, previousDailyByDate);

  return {
    range: {
      from: range.from,
      to: range.to,
      days: range.days,
      previousFrom: range.previousFrom,
      previousTo: range.previousTo,
    },
    ...totalsToDto(current),
    previous: totalsToDto(previous),
    growth: {
      revenuePct: percentChange(current.revenue, previous.revenue),
      transactionsPct: percentChange(current.transactions, previous.transactions),
    },
    profit,
    daily: series.daily,
    dailyPrevious: previousSeries.daily.map((point) => ({ date: point.date, revenue: point.revenue })),
    byCategory,
    topProducts: top,
    payments,
  };
}

// ---------------------------------------------------------------------------
// Inventory report
// ---------------------------------------------------------------------------

export type ExpiryBucketKey = 'expired' | 'd30' | 'd60' | 'd90';

export interface InventoryReport {
  generatedAt: string;
  nearExpiryDays: number;
  stock: { units: number; costValue: string | null; retailValue: string | null };
  health: { healthy: number; low: number; out: number; total: number };
  reorder: Array<{ productId: string; sku: string; nameAr: string; totalQuantity: number; minStock: number }>;
  expiryBuckets: Array<{ bucket: ExpiryBucketKey; batches: number; units: number; value: string | null }>;
  upcomingExpiries: Array<{
    batchId: string;
    productId: string;
    sku: string;
    nameAr: string;
    lotNumber: string;
    expiryDate: string;
    daysToExpiry: number;
    quantity: number;
    value: string | null;
  }>;
  valueByCategory: Array<{ categoryId: string | null; nameAr: string | null; units: number; value: string | null }>;
  fastMoving: Array<{ productId: string; sku: string; nameAr: string; units: number; invoices: number }>;
  slowMoving: Array<{
    productId: string;
    sku: string;
    nameAr: string;
    totalQuantity: number;
    units30d: number;
    lastSoldAt: string | null;
  }>;
}

const BUCKET_ORDER: ExpiryBucketKey[] = ['expired', 'd30', 'd60', 'd90'];

export async function getInventoryReport(role: Role): Promise<InventoryReport> {
  const canViewCost = hasPermission(role, 'cost:view');
  const today = todayInBusinessTimezone();
  const movementSince = businessDayStart(addDays(today, -(MOVEMENT_WINDOW_DAYS - 1)));

  const [
    stockRows,
    healthRows,
    reorderRows,
    bucketRows,
    upcomingRows,
    categoryRows,
    fastRows,
    slowRows,
  ] = await Promise.all([
    // On-hand totals and valuation, from live batches only.
    prisma.$queryRaw<Array<{ units: number; cost: string; retail: string }>>`
      SELECT COALESCE(SUM(b.quantity), 0)::int AS units,
             COALESCE(SUM(b.quantity * b."costPrice"), 0)::text AS cost,
             COALESCE(SUM(b.quantity * COALESCE(b."salePrice", p."salePrice")), 0)::text AS retail
      FROM batches b
      JOIN products p ON p.id = b."productId"
      WHERE b.quantity > 0
    `,
    // Mirrors the alerts rule: `SUM(batches.quantity) <= products.minStock` is
    // low, split into out-of-stock (`<= 0`) and low (`> 0`).
    prisma.$queryRaw<Array<{ out: number; low: number; healthy: number; total: number }>>`
      SELECT COUNT(*) FILTER (WHERE COALESCE(t.qty, 0) <= 0)::int AS out,
             COUNT(*) FILTER (WHERE COALESCE(t.qty, 0) > 0 AND t.qty <= p."minStock")::int AS low,
             COUNT(*) FILTER (WHERE t.qty > p."minStock")::int AS healthy,
             COUNT(*)::int AS total
      FROM products p
      LEFT JOIN (
        SELECT "productId", SUM(quantity)::int AS qty
        FROM batches
        GROUP BY 1
      ) t ON t."productId" = p.id
      WHERE p."isActive" = true
    `,
    // Lowest coverage first (quantity / minStock), so the most urgent appear on top.
    prisma.$queryRaw<Array<{ productId: string; sku: string; nameAr: string; totalQuantity: number; minStock: number }>>`
      SELECT p.id AS "productId", p.sku, p."nameAr",
             COALESCE(t.qty, 0)::int AS "totalQuantity",
             p."minStock"
      FROM products p
      LEFT JOIN (
        SELECT "productId", SUM(quantity)::int AS qty
        FROM batches
        GROUP BY 1
      ) t ON t."productId" = p.id
      WHERE p."isActive" = true AND COALESCE(t.qty, 0) <= p."minStock"
      ORDER BY COALESCE(t.qty, 0)::float / GREATEST(p."minStock", 1) ASC, COALESCE(t.qty, 0) ASC
      LIMIT 10
    `,
    // Counted as whole batches (not product totals) so a product whose
    // aggregate stock is healthy still surfaces a batch that expires soon.
    prisma.$queryRaw<Array<{ bucket: ExpiryBucketKey; batches: number; units: number; value: string }>>`
      SELECT CASE
               WHEN b."expiryDate" < ${today}::date THEN 'expired'
               WHEN b."expiryDate" <= ${today}::date + 30 THEN 'd30'
               WHEN b."expiryDate" <= ${today}::date + 60 THEN 'd60'
               ELSE 'd90'
             END AS bucket,
             COUNT(*)::int AS batches,
             COALESCE(SUM(b.quantity), 0)::int AS units,
             COALESCE(SUM(b.quantity * b."costPrice"), 0)::text AS value
      FROM batches b
      WHERE b.quantity > 0
        AND b."expiryDate" <= ${today}::date + 90
      GROUP BY 1
    `,
    prisma.$queryRaw<
      Array<{
        batchId: string;
        productId: string;
        sku: string;
        nameAr: string;
        lotNumber: string;
        expiryDate: Date;
        quantity: number;
        value: string;
      }>
    >`
      SELECT b.id AS "batchId", b."productId", p.sku, p."nameAr",
             b."lotNumber", b."expiryDate", b.quantity,
             (b.quantity * b."costPrice")::text AS value
      FROM batches b
      JOIN products p ON p.id = b."productId"
      WHERE b.quantity > 0
        AND b."expiryDate" >= ${today}::date
        AND b."expiryDate" <= ${today}::date + 90
      ORDER BY b."expiryDate" ASC, b.quantity DESC
      LIMIT 6
    `,
    prisma.$queryRaw<Array<{ categoryId: string | null; nameAr: string | null; units: number; value: string }>>`
      SELECT p."categoryId" AS "categoryId",
             c."nameAr" AS "nameAr",
             COALESCE(SUM(b.quantity), 0)::int AS units,
             COALESCE(SUM(b.quantity * b."costPrice"), 0)::text AS value
      FROM batches b
      JOIN products p ON p.id = b."productId"
      LEFT JOIN categories c ON c.id = p."categoryId"
      WHERE b.quantity > 0
      GROUP BY 1, 2
      ORDER BY SUM(b.quantity * b."costPrice") DESC
      LIMIT 8
    `,
    // Units sold in the rolling 30-day window (completed sales only).
    prisma.$queryRaw<Array<{ productId: string; units: number; invoices: number }>>`
      SELECT si."productId" AS "productId",
             COALESCE(SUM(si.quantity), 0)::int AS units,
             COUNT(DISTINCT si."saleId")::int AS invoices
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s.status = 'COMPLETED'
        AND s."createdAt" >= ${movementSince}
      GROUP BY 1
      ORDER BY SUM(si.quantity) DESC
      LIMIT 8
    `,
    // In-stock products with the least movement in the same window.
    prisma.$queryRaw<
      Array<{
        productId: string;
        sku: string;
        nameAr: string;
        totalQuantity: number;
        units30d: number;
        lastSoldAt: Date | null;
      }>
    >`
      SELECT p.id AS "productId", p.sku, p."nameAr",
             t.qty AS "totalQuantity",
             COALESCE(su.units, 0)::int AS "units30d",
             su.last_sold AS "lastSoldAt"
      FROM products p
      JOIN (
        SELECT "productId", SUM(quantity)::int AS qty
        FROM batches
        WHERE quantity > 0
        GROUP BY 1
      ) t ON t."productId" = p.id
      LEFT JOIN (
        SELECT si."productId", SUM(si.quantity)::int AS units, MAX(s."createdAt") AS last_sold
        FROM sale_items si
        JOIN sales s ON s.id = si."saleId"
        WHERE s.status = 'COMPLETED' AND s."createdAt" >= ${movementSince}
        GROUP BY 1
      ) su ON su."productId" = p.id
      WHERE p."isActive" = true
      ORDER BY COALESCE(su.units, 0) ASC, su.last_sold ASC NULLS FIRST, t.qty DESC
      LIMIT 8
    `,
  ]);

  const stockRow = stockRows[0] ?? { units: 0, cost: '0', retail: '0' };
  const healthRow = healthRows[0] ?? { out: 0, low: 0, healthy: 0, total: 0 };

  const bucketByKey = new Map(bucketRows.map((row) => [row.bucket, row]));
  const expiryBuckets = BUCKET_ORDER.map((bucket) => {
    const row = bucketByKey.get(bucket);
    return {
      bucket,
      batches: row?.batches ?? 0,
      units: row?.units ?? 0,
      value: canViewCost ? roundCurrency(row?.value ?? '0') : null,
    };
  });

  const fastIds = fastRows.map((row) => row.productId);
  const fastProducts =
    fastIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: fastIds } },
          select: { id: true, sku: true, nameAr: true },
        })
      : [];
  const fastById = new Map(fastProducts.map((product) => [product.id, product]));

  return {
    generatedAt: new Date().toISOString(),
    nearExpiryDays: BUSINESS_DEFAULTS.nearExpiryDays,
    stock: {
      units: stockRow.units,
      costValue: canViewCost ? roundCurrency(stockRow.cost) : null,
      retailValue: canViewCost ? roundCurrency(stockRow.retail) : null,
    },
    health: {
      healthy: healthRow.healthy,
      low: healthRow.low,
      out: healthRow.out,
      total: healthRow.total,
    },
    reorder: reorderRows.map((row) => ({
      productId: row.productId,
      sku: row.sku,
      nameAr: row.nameAr,
      totalQuantity: row.totalQuantity,
      minStock: row.minStock,
    })),
    expiryBuckets,
    upcomingExpiries: upcomingRows.map((row) => ({
      batchId: row.batchId,
      productId: row.productId,
      sku: row.sku,
      nameAr: row.nameAr,
      lotNumber: row.lotNumber,
      expiryDate: toDateOnly(row.expiryDate),
      daysToExpiry: daysUntil(toDateOnly(row.expiryDate), today),
      quantity: row.quantity,
      value: canViewCost ? roundCurrency(row.value) : null,
    })),
    valueByCategory: categoryRows.map((row) => ({
      categoryId: row.categoryId,
      nameAr: row.nameAr,
      units: row.units,
      value: canViewCost ? roundCurrency(row.value) : null,
    })),
    fastMoving: fastRows.flatMap((row) => {
      const product = fastById.get(row.productId);
      if (!product) return [];
      return [{ productId: row.productId, sku: product.sku, nameAr: product.nameAr, units: row.units, invoices: row.invoices }];
    }),
    slowMoving: slowRows.map((row) => ({
      productId: row.productId,
      sku: row.sku,
      nameAr: row.nameAr,
      totalQuantity: row.totalQuantity,
      units30d: row.units30d,
      lastSoldAt: row.lastSoldAt ? toIso(row.lastSoldAt) : null,
    })),
  };
}
