import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  buildPaginated,
  purchaseQuerySchema,
  stockReceiptSchema,
  type PurchaseQuery,
  type StockReceiptInput,
} from '@pharmacy/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { toDateOnly, toIso } from '../../lib/dates.js';
import { NotFoundError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../prisma.js';
import { receiveStock, replacePurchase, reversePurchase } from '../inventory/inventory.service.js';

/**
 * Purchases module — supplier purchase invoices (goods-receipt notes).
 *
 * Receipts are persisted as inbound `StockMovement` rows (type RECEIPT) that
 * share one `reference`; this module groups them back into invoices. Recording
 * a purchase reuses the inventory service so stock, batches and supplier
 * payables all move in a single transaction.
 */
export const purchasesRouter = Router();
purchasesRouter.use(authenticate);

const referenceParams = z.object({ reference: z.string().trim().min(1).max(60) });

export interface PurchaseReceiptRowDto {
  reference: string;
  createdAt: string;
  warehouseId: string;
  warehouseNameAr: string | null;
  supplierId: string | null;
  supplierNameAr: string | null;
  linesCount: number;
  unitsCount: number;
  totalCost: string;
  userName: string | null;
}

export interface PurchaseSummaryDto {
  totalCost: string;
  receiptsTotal: number;
  unitsTotal: number;
}

export interface PurchaseReceiptLineDto {
  id: string;
  productId: string;
  sku: string;
  productNameAr: string;
  batchId: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  quantity: number;
  unitCost: string;
  lineTotal: string;
}

export interface PurchaseReceiptDetailDto {
  reference: string;
  createdAt: string;
  warehouseId: string;
  warehouseNameAr: string | null;
  supplierId: string | null;
  supplierNameAr: string | null;
  userName: string | null;
  linesCount: number;
  unitsCount: number;
  totalCost: string;
  lines: PurchaseReceiptLineDto[];
}

interface ReceiptGroupRow {
  reference: string;
  createdAt: Date;
  warehouseId: string;
  warehouseNameAr: string | null;
  supplierId: string | null;
  supplierNameAr: string | null;
  linesCount: number;
  unitsCount: number;
  totalCost: string;
  userName: string | null;
}

/** `q` matches the receipt reference or the supplier name. */
function searchFilter(q: string | undefined): Prisma.Sql {
  if (!q) return Prisma.empty;
  const like = `%${q}%`;
  return Prisma.sql`AND (sm."reference" ILIKE ${like} OR s."nameAr" ILIKE ${like})`;
}

function money(value: string | number | null | undefined): string {
  return Number(value ?? 0).toFixed(2);
}

// ---------------------------------------------------------------------------
// GET /purchases — paginated goods-receipt history with totals
// ---------------------------------------------------------------------------

purchasesRouter.get(
  '/',
  authorize('purchases:read'),
  validate({ query: purchaseQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as PurchaseQuery;
    const offset = (query.page - 1) * query.pageSize;
    const filter = searchFilter(query.q);

    const [rows, counted, totals] = await Promise.all([
      prisma.$queryRaw<ReceiptGroupRow[]>`
        SELECT sm."reference" AS reference,
               MIN(sm."createdAt") AS "createdAt",
               MAX(sm."warehouseId") AS "warehouseId",
               MAX(w."nameAr") AS "warehouseNameAr",
               MAX(b."supplierId") AS "supplierId",
               MAX(s."nameAr") AS "supplierNameAr",
               COUNT(*)::int AS "linesCount",
               COALESCE(SUM(sm."quantity"), 0)::int AS "unitsCount",
               COALESCE(SUM(sm."quantity" * sm."unitCost"), 0)::text AS "totalCost",
               MAX(u."fullName") AS "userName"
        FROM "stock_movements" sm
        LEFT JOIN "batches" b ON b."id" = sm."batchId"
        LEFT JOIN "suppliers" s ON s."id" = b."supplierId"
        LEFT JOIN "warehouses" w ON w."id" = sm."warehouseId"
        LEFT JOIN "users" u ON u."id" = sm."userId"
        WHERE sm."type" = 'RECEIPT' AND sm."reference" IS NOT NULL
          ${filter}
        GROUP BY sm."reference"
        ORDER BY MIN(sm."createdAt") DESC
        LIMIT ${query.pageSize} OFFSET ${offset}
      `,
      prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(DISTINCT sm."reference")::int AS total
        FROM "stock_movements" sm
        LEFT JOIN "batches" b ON b."id" = sm."batchId"
        LEFT JOIN "suppliers" s ON s."id" = b."supplierId"
        WHERE sm."type" = 'RECEIPT' AND sm."reference" IS NOT NULL
          ${filter}
      `,
      prisma.$queryRaw<Array<{ totalCost: string; receiptsTotal: number; unitsTotal: number }>>`
        SELECT COALESCE(SUM(t."totalCost"), 0)::text AS "totalCost",
               COUNT(*)::int AS "receiptsTotal",
               COALESCE(SUM(t."unitsCount"), 0)::int AS "unitsTotal"
        FROM (
          SELECT sm."reference",
                 SUM(sm."quantity" * sm."unitCost") AS "totalCost",
                 SUM(sm."quantity") AS "unitsCount"
          FROM "stock_movements" sm
          LEFT JOIN "batches" b ON b."id" = sm."batchId"
          LEFT JOIN "suppliers" s ON s."id" = b."supplierId"
          WHERE sm."type" = 'RECEIPT' AND sm."reference" IS NOT NULL
            ${filter}
          GROUP BY sm."reference"
        ) t
      `,
    ]);

    const items: PurchaseReceiptRowDto[] = rows.map((row) => ({
      reference: row.reference,
      createdAt: toIso(row.createdAt),
      warehouseId: row.warehouseId,
      warehouseNameAr: row.warehouseNameAr,
      supplierId: row.supplierId,
      supplierNameAr: row.supplierNameAr,
      linesCount: row.linesCount,
      unitsCount: row.unitsCount,
      totalCost: money(row.totalCost),
      userName: row.userName,
    }));

    const summaryRow = totals[0];
    const summary: PurchaseSummaryDto = {
      totalCost: money(summaryRow?.totalCost),
      receiptsTotal: summaryRow?.receiptsTotal ?? 0,
      unitsTotal: summaryRow?.unitsTotal ?? 0,
    };

    res.status(200).json({
      ...buildPaginated(items, counted[0]?.total ?? 0, query.page, query.pageSize),
      summary,
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /purchases/:reference — one receipt with its lines
// ---------------------------------------------------------------------------

purchasesRouter.get(
  '/:reference',
  authorize('purchases:read'),
  validate({ params: referenceParams }),
  asyncHandler(async (req, res) => {
    const { reference } = req.params as z.infer<typeof referenceParams>;

    const movements = await prisma.stockMovement.findMany({
      where: { type: 'RECEIPT', reference },
      orderBy: { createdAt: 'asc' },
      include: {
        product: { select: { id: true, sku: true, nameAr: true } },
        batch: {
          select: {
            id: true,
            lotNumber: true,
            expiryDate: true,
            supplier: { select: { id: true, nameAr: true } },
          },
        },
        warehouse: { select: { id: true, nameAr: true } },
        user: { select: { id: true, fullName: true } },
      },
    });

    if (movements.length === 0) throw new NotFoundError('فاتورة المشتريات غير موجودة');

    const first = movements[0]!;
    const lines: PurchaseReceiptLineDto[] = movements.map((movement) => ({
      id: movement.id,
      productId: movement.productId,
      sku: movement.product.sku,
      productNameAr: movement.product.nameAr,
      batchId: movement.batchId,
      lotNumber: movement.batch?.lotNumber ?? null,
      expiryDate: movement.batch ? toDateOnly(movement.batch.expiryDate) : null,
      quantity: movement.quantity,
      unitCost: movement.unitCost ? movement.unitCost.toFixed(2) : '0.00',
      lineTotal: movement.unitCost
        ? movement.unitCost.mul(movement.quantity).toFixed(2)
        : '0.00',
    }));

    const detail: PurchaseReceiptDetailDto = {
      reference,
      createdAt: toIso(first.createdAt),
      warehouseId: first.warehouseId,
      warehouseNameAr: first.warehouse.nameAr,
      supplierId: first.batch?.supplier?.id ?? null,
      supplierNameAr: first.batch?.supplier?.nameAr ?? null,
      userName: first.user?.fullName ?? null,
      linesCount: lines.length,
      unitsCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      totalCost: money(lines.reduce((sum, line) => sum + Number(line.lineTotal), 0)),
      lines,
    };

    res.status(200).json(detail);
  }),
);

// ---------------------------------------------------------------------------
// POST /purchases — record a goods receipt (stock in + supplier payable)
// ---------------------------------------------------------------------------

purchasesRouter.post(
  '/',
  authorize('purchases:write'),
  rateLimit({ name: 'purchases:create', windowMs: 60_000, max: 120 }),
  validate({ body: stockReceiptSchema }),
  asyncHandler(async (req, res) => {
    const result = await receiveStock(req.body as StockReceiptInput, req.user!.id);
    res.status(201).json(result);
  }),
);

// ---------------------------------------------------------------------------
// PATCH /purchases/:reference — reverse and replace a posted receipt
// ---------------------------------------------------------------------------

purchasesRouter.patch(
  '/:reference',
  authorize('purchases:write'),
  rateLimit({ name: 'purchases:update', windowMs: 60_000, max: 60 }),
  validate({ params: referenceParams, body: stockReceiptSchema }),
  asyncHandler(async (req, res) => {
    const { reference } = req.params as z.infer<typeof referenceParams>;
    const result = await replacePurchase(reference, req.body as StockReceiptInput, req.user!.id);
    res.status(200).json(result);
  }),
);

// ---------------------------------------------------------------------------
// DELETE /purchases/:reference — reverse (void) a posted receipt
// ---------------------------------------------------------------------------

purchasesRouter.delete(
  '/:reference',
  authorize('purchases:delete'),
  rateLimit({ name: 'purchases:delete', windowMs: 60_000, max: 60 }),
  validate({ params: referenceParams }),
  asyncHandler(async (req, res) => {
    const { reference } = req.params as z.infer<typeof referenceParams>;
    const result = await reversePurchase(reference, req.user!.id);
    res.status(200).json(result);
  }),
);
