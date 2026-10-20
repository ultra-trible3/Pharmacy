import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  BUSINESS_DEFAULTS,
  buildPaginated,
  hasPermission,
  type InventoryBatchRow,
  type InventoryQuery,
  type MovementQuery,
  type Paginated,
  type Role,
  type StockAdjustmentInput,
  type StockLevelRow,
  type StockReceiptInput,
  type StockTransferInput,
} from '@pharmacy/shared';
import { prisma } from '../../prisma.js';
import { recordAudit } from '../../lib/audit.js';
import { daysUntil, parseDateOnly, toDateOnly, todayInBusinessTimezone } from '../../lib/dates.js';
import {
  InsufficientStockError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { allocateFefo, signedQuantity, type FefoCandidate } from './fefo.js';

type Tx = Prisma.TransactionClient;

function money(value: Prisma.Decimal | null | undefined, fallback = '0.00'): string {
  return value === null || value === undefined ? fallback : value.toFixed(2);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listBatches(
  query: InventoryQuery,
  role: Role,
): Promise<Paginated<InventoryBatchRow>> {
  const canViewCost = hasPermission(role, 'cost:view');
  const today = todayInBusinessTimezone();
  const nearExpiryLimit = new Date(
    parseDateOnly(today).getTime() + BUSINESS_DEFAULTS.nearExpiryDays * 86_400_000,
  );

  const and: Prisma.BatchWhereInput[] = [];
  if (query.warehouseId) and.push({ warehouseId: query.warehouseId });
  if (query.productId) and.push({ productId: query.productId });
  if (query.inStockOnly) and.push({ quantity: { gt: 0 } });

  if (query.expiringInDays !== undefined) {
    const limit = new Date(parseDateOnly(today).getTime() + query.expiringInDays * 86_400_000);
    and.push({ expiryDate: { lte: limit } });
  }
  if (!query.includeExpired) {
    and.push({ expiryDate: { gte: parseDateOnly(today) } });
  }
  if (query.q) {
    and.push({
      OR: [
        { lotNumber: { contains: query.q, mode: 'insensitive' } },
        { product: { nameAr: { contains: query.q, mode: 'insensitive' } } },
        { product: { nameEn: { contains: query.q, mode: 'insensitive' } } },
        { product: { sku: { contains: query.q, mode: 'insensitive' } } },
        { product: { barcode: { equals: query.q } } },
      ],
    });
  }

  const where: Prisma.BatchWhereInput = and.length > 0 ? { AND: and } : {};

  const orderBy: Prisma.BatchOrderByWithRelationInput[] =
    query.sortBy === 'quantity'
      ? [{ quantity: query.sortOrder }, { expiryDate: 'asc' }]
      : query.sortBy === 'lotNumber'
        ? [{ lotNumber: query.sortOrder }, { expiryDate: 'asc' }]
        : query.sortBy === 'productName'
          ? [{ product: { nameAr: query.sortOrder } }, { expiryDate: 'asc' }]
          : [{ expiryDate: query.sortOrder }, { productId: 'asc' }, { id: 'asc' }];

  const [rows, total] = await Promise.all([
    prisma.batch.findMany({
      where,
      include: {
        product: { select: { sku: true, nameAr: true, nameEn: true, barcode: true, salePrice: true } },
        warehouse: { select: { nameAr: true } },
      },
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.batch.count({ where }),
  ]);

  const items: InventoryBatchRow[] = rows.map((row) => {
    const expiry = toDateOnly(row.expiryDate);
    const remaining = daysUntil(expiry, today);
    const unitSale = row.salePrice ?? row.product.salePrice;
    return {
      batchId: row.id,
      productId: row.productId,
      sku: row.product.sku,
      productNameAr: row.product.nameAr,
      productNameEn: row.product.nameEn,
      barcode: row.product.barcode,
      warehouseId: row.warehouseId,
      warehouseNameAr: row.warehouse.nameAr,
      lotNumber: row.lotNumber,
      expiryDate: expiry,
      manufactureDate: row.manufactureDate ? toDateOnly(row.manufactureDate) : null,
      quantity: row.quantity,
      costPrice: canViewCost ? money(row.costPrice) : '0.00',
      salePrice: money(unitSale),
      daysToExpiry: remaining,
      isExpired: remaining < 0,
      isNearExpiry: remaining >= 0 && row.expiryDate <= nearExpiryLimit,
      stockValue: canViewCost
        ? new Prisma.Decimal(row.costPrice).mul(row.quantity).toFixed(2)
        : '0.00',
    };
  });

  return buildPaginated(items, total, query.page, query.pageSize);
}

export async function listStockLevels(
  query: InventoryQuery,
  role: Role,
): Promise<Paginated<StockLevelRow>> {
  const canViewCost = hasPermission(role, 'cost:view');
  const where: Prisma.ProductWhereInput = query.q
    ? {
        OR: [
          { nameAr: { contains: query.q, mode: 'insensitive' } },
          { nameEn: { contains: query.q, mode: 'insensitive' } },
          { sku: { contains: query.q, mode: 'insensitive' } },
          { barcode: { equals: query.q } },
        ],
      }
    : {};

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ nameAr: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  if (products.length === 0) return buildPaginated([], total, query.page, query.pageSize);
  const ids = products.map((p) => p.id);

  const [aggregates, expiries] = await Promise.all([
    query.warehouseId
      ? prisma.$queryRaw<{ productId: string; quantity: number; value: Prisma.Decimal }[]>`
          SELECT "productId",
                 SUM(quantity)::int AS quantity,
                 SUM(quantity * "costPrice")::numeric(14,2) AS value
          FROM batches
          WHERE "productId" = ANY(${ids}) AND quantity > 0 AND "warehouseId" = ${query.warehouseId}
          GROUP BY "productId"
        `
      : prisma.$queryRaw<{ productId: string; quantity: number; value: Prisma.Decimal }[]>`
          SELECT "productId",
                 SUM(quantity)::int AS quantity,
                 SUM(quantity * "costPrice")::numeric(14,2) AS value
          FROM batches
          WHERE "productId" = ANY(${ids}) AND quantity > 0
          GROUP BY "productId"
        `,
    prisma.batch.groupBy({
      by: ['productId'],
      where: {
        productId: { in: ids },
        quantity: { gt: 0 },
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      },
      _min: { expiryDate: true },
    }),
  ]);

  const totalsMap = new Map(aggregates.map((a) => [a.productId, Number(a.quantity)]));
  // Prisma deserialises Postgres NUMERIC into a Decimal whose string form drops
  // trailing zeros ("15"), so money must be re-fixed to 2 decimals here.
  const valueMap = new Map(
    aggregates.map((a) => [a.productId, new Prisma.Decimal(a.value).toFixed(2)]),
  );
  const expiryMap = new Map(
    expiries.map((e) => [e.productId, e._min.expiryDate ? toDateOnly(e._min.expiryDate) : null]),
  );

  const items: StockLevelRow[] = products.map((product) => {
    const totalQuantity = totalsMap.get(product.id) ?? 0;
    return {
      productId: product.id,
      sku: product.sku,
      nameAr: product.nameAr,
      nameEn: product.nameEn,
      totalQuantity,
      minStock: product.minStock,
      isLowStock: totalQuantity <= product.minStock,
      nearestExpiry: expiryMap.get(product.id) ?? null,
      stockValue: canViewCost ? (valueMap.get(product.id) ?? '0.00') : '0.00',
    };
  });

  return buildPaginated(items, total, query.page, query.pageSize);
}

export interface InventoryAlerts {
  generatedAt: string;
  nearExpiryDays: number;
  summary: {
    lowStockCount: number;
    nearExpiryCount: number;
    expiredCount: number;
    totalStockUnits: number;
  };
  lowStock: StockLevelRow[];
  nearExpiry: InventoryBatchRow[];
  expired: InventoryBatchRow[];
}

/** Derives every warehouse alert from live database queries (no cached state). */
export async function getAlerts(role: Role, warehouseId?: string): Promise<InventoryAlerts> {
  const today = todayInBusinessTimezone();
  const nearExpiryLimit = new Date(
    parseDateOnly(today).getTime() + BUSINESS_DEFAULTS.nearExpiryDays * 86_400_000,
  );

  const lowStockSql = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id
    FROM products p
    LEFT JOIN batches b ON b."productId" = p.id
    WHERE p."isActive" = true
    GROUP BY p.id, p."minStock"
    HAVING COALESCE(SUM(b.quantity), 0) <= p."minStock"
  `;
  const lowStockIds = lowStockSql.map((r) => r.id);

  const [lowStockProducts, nearExpiryBatches, expiredBatches, stockUnits] = await Promise.all([
    lowStockIds.length > 0
      ? prisma.product.findMany({
          where: { id: { in: lowStockIds } },
          include: { batches: { where: { quantity: { gt: 0 } }, select: { quantity: true } } },
          orderBy: { nameAr: 'asc' },
          take: 100,
        })
      : Promise.resolve([]),
    prisma.batch.findMany({
      where: {
        quantity: { gt: 0 },
        expiryDate: { gte: parseDateOnly(today), lte: nearExpiryLimit },
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: { product: { select: { nameAr: true, sku: true } }, warehouse: { select: { nameAr: true } } },
      orderBy: { expiryDate: 'asc' },
      take: 100,
    }),
    prisma.batch.findMany({
      where: {
        quantity: { gt: 0 },
        expiryDate: { lt: parseDateOnly(today) },
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: { product: { select: { nameAr: true, sku: true } }, warehouse: { select: { nameAr: true } } },
      orderBy: { expiryDate: 'asc' },
      take: 100,
    }),
    prisma.batch.aggregate({
      where: { quantity: { gt: 0 }, ...(warehouseId ? { warehouseId } : {}) },
      _sum: { quantity: true },
    }),
  ]);

  const toBatchRow = (
    row: (typeof nearExpiryBatches)[number],
  ): InventoryBatchRow => {
    const expiry = toDateOnly(row.expiryDate);
    const remaining = daysUntil(expiry, today);
    return {
      batchId: row.id,
      productId: row.productId,
      sku: row.product.sku,
      productNameAr: row.product.nameAr,
      productNameEn: null,
      barcode: null,
      warehouseId: row.warehouseId,
      warehouseNameAr: row.warehouse.nameAr,
      lotNumber: row.lotNumber,
      expiryDate: expiry,
      manufactureDate: null,
      quantity: row.quantity,
      costPrice: '0.00',
      salePrice: '0.00',
      daysToExpiry: remaining,
      isExpired: remaining < 0,
      isNearExpiry: remaining >= 0,
      stockValue: '0.00',
    };
  };

  return {
    generatedAt: new Date().toISOString(),
    nearExpiryDays: BUSINESS_DEFAULTS.nearExpiryDays,
    summary: {
      lowStockCount: lowStockProducts.length,
      nearExpiryCount: nearExpiryBatches.length,
      expiredCount: expiredBatches.length,
      totalStockUnits: stockUnits._sum.quantity ?? 0,
    },
    lowStock: lowStockProducts.map((product) => {
      const totalQuantity = product.batches.reduce((sum, b) => sum + b.quantity, 0);
      return {
        productId: product.id,
        sku: product.sku,
        nameAr: product.nameAr,
        nameEn: product.nameEn,
        totalQuantity,
        minStock: product.minStock,
        isLowStock: true,
        nearestExpiry: null,
        stockValue: '0.00',
      };
    }),
    nearExpiry: nearExpiryBatches.map(toBatchRow),
    expired: expiredBatches.map(toBatchRow),
  };
}

export async function listMovements(query: MovementQuery) {
  const where: Prisma.StockMovementWhereInput = {
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.batchId ? { batchId: query.batchId } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
            ...(query.to
              ? { lte: new Date(parseDateOnly(query.to).getTime() + 86_400_000 - 1) }
              : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      include: {
        product: { select: { sku: true, nameAr: true } },
        warehouse: { select: { nameAr: true } },
        user: { select: { fullName: true, username: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return buildPaginated(
    rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      sku: row.product.sku,
      productNameAr: row.product.nameAr,
      warehouseNameAr: row.warehouse.nameAr,
      type: row.type,
      quantity: row.quantity,
      unitCost: money(row.unitCost),
      reason: row.reason,
      reference: row.reference,
      userName: row.user?.fullName ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    query.page,
    query.pageSize,
  );
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function assertWarehouse(tx: Tx, warehouseId: string) {
  const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new NotFoundError('المخزن غير موجود');
  if (!warehouse.isActive) throw new ValidationError('المخزن غير مُفعّل');
  return warehouse;
}

/**
 * Replenishment upsert used by receipts.
 *
 * Uses `INSERT ... ON CONFLICT ... DO UPDATE SET quantity = batches.quantity + EXCLUDED.quantity`
 * so that two terminals receiving the same lot simultaneously cannot lose stock
 * (read-modify-write races are impossible at the SQL level).
 */
async function upsertBatch(
  tx: Tx,
  params: {
    productId: string;
    warehouseId: string;
    supplierId: string | null;
    lotNumber: string;
    expiryDate: string;
    manufactureDate: string | null;
    quantity: number;
    costPrice: string;
    salePrice: string | null;
  },
): Promise<{ id: string; quantity: number }> {
  const id = randomUUID();
  const rows = await tx.$queryRaw<{ id: string; quantity: number }[]>`
    INSERT INTO batches (
      id, "productId", "warehouseId", "supplierId", "lotNumber",
      "expiryDate", "manufactureDate", quantity, "costPrice", "salePrice",
      "receivedAt", "createdAt", "updatedAt"
    )
    VALUES (
      ${id}, ${params.productId}, ${params.warehouseId}, ${params.supplierId}, ${params.lotNumber},
      ${params.expiryDate}::date, ${params.manufactureDate}::date, ${params.quantity},
      ${params.costPrice}::numeric, ${params.salePrice}::numeric,
      now(), now(), now()
    )
    ON CONFLICT ("productId", "warehouseId", "lotNumber", "expiryDate")
    DO UPDATE SET
      quantity = batches.quantity + EXCLUDED.quantity,
      "costPrice" = EXCLUDED."costPrice",
      "salePrice" = COALESCE(EXCLUDED."salePrice", batches."salePrice"),
      "updatedAt" = now()
    RETURNING id, quantity
  `;
  const row = rows[0];
  if (!row) throw new Error('failed to upsert batch');
  return row;
}

/** Raw input for creating / topping up a single batch (one receipt line). */
export interface UpsertBatchRawInput {
  productId: string;
  warehouseId: string;
  lotNumber: string;
  expiryDate: string;
  manufactureDate?: string;
  quantity: number;
  costPrice: string;
  salePrice?: string;
}

/** Create or top-up a single batch plus its stock ledger entry and audit trail. */
export async function upsertBatchRaw(
  input: UpsertBatchRawInput,
  userId: string,
): Promise<{ id: string; quantity: number }> {
  return prisma.$transaction(async (tx) => {
    await assertWarehouse(tx, input.warehouseId);

    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { id: true, nameAr: true, isActive: true },
    });
    if (!product) throw new NotFoundError('المنتج غير موجود');
    if (!product.isActive) throw new ValidationError(`المنتج مُوقف: ${product.nameAr}`);

    const batch = await upsertBatch(tx, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      supplierId: null,
      lotNumber: input.lotNumber.trim(),
      expiryDate: input.expiryDate,
      manufactureDate: input.manufactureDate ?? null,
      quantity: input.quantity,
      costPrice: input.costPrice,
      salePrice: input.salePrice ?? null,
    });

    await tx.stockMovement.create({
      data: {
        productId: input.productId,
        batchId: batch.id,
        warehouseId: input.warehouseId,
        type: 'RECEIPT',
        quantity: input.quantity,
        unitCost: new Prisma.Decimal(input.costPrice),
        reason: 'إضافة تشغيلة',
        reference: `BATCH-${Date.now().toString(36).toUpperCase()}`,
        userId,
      },
    });

    await recordAudit(
      {
        action: 'inventory.batch.upsert',
        entityType: 'Batch',
        entityId: batch.id,
        after: {
          productId: input.productId,
          warehouseId: input.warehouseId,
          lotNumber: input.lotNumber,
          expiryDate: input.expiryDate,
          quantity: input.quantity,
          costPrice: input.costPrice,
          salePrice: input.salePrice ?? null,
        },
        userId,
      },
      tx,
    );

    return { id: batch.id, quantity: batch.quantity };
  });
}

/** Fields the batch edit endpoint accepts. */
export interface BatchUpdateInput {
  quantity?: number;
  costPrice?: string;
  salePrice?: string;
  expiryDate?: string;
}

/** Update a batch's quantity / prices / expiry. Quantity corrections write a balancing
 * stock movement so the ledger stays complete. */
export async function updateBatch(
  id: string,
  input: BatchUpdateInput,
  userId: string,
): Promise<{ id: string; quantity: number }> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.batch.findUnique({
      where: { id },
      include: { product: true, warehouse: true },
    });
    if (!before) throw new NotFoundError('التشغيلة غير موجودة');

    const data: Prisma.BatchUpdateInput = {};
    if (input.costPrice !== undefined) data.costPrice = new Prisma.Decimal(input.costPrice);
    if (input.salePrice !== undefined)
      data.salePrice = input.salePrice === '' || input.salePrice === null ? null : new Prisma.Decimal(input.salePrice);
    if (input.expiryDate !== undefined) data.expiryDate = parseDateOnly(input.expiryDate);
    if (input.quantity !== undefined) data.quantity = input.quantity;

    const after = await tx.batch.update({ where: { id }, data });

    if (input.quantity !== undefined && input.quantity !== before.quantity) {
      const delta = input.quantity - before.quantity;
      await tx.stockMovement.create({
        data: {
          productId: before.productId,
          batchId: before.id,
          warehouseId: before.warehouseId,
          type: delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          quantity: Math.abs(delta),
          unitCost: after.costPrice,
          reason: 'تصحيح كمية تشغيلة',
          reference: null,
          userId,
        },
      });
    }

    await recordAudit(
      {
        action: 'inventory.batch.updated',
        entityType: 'Batch',
        entityId: id,
        before: {
          quantity: before.quantity,
          costPrice: before.costPrice.toString(),
          salePrice: before.salePrice?.toString() ?? null,
          expiryDate: before.expiryDate.toISOString(),
        },
        after: {
          quantity: after.quantity,
          costPrice: after.costPrice.toString(),
          salePrice: after.salePrice?.toString() ?? null,
          expiryDate: after.expiryDate.toISOString(),
        },
        userId,
      },
      tx,
    );

    return { id: after.id, quantity: after.quantity };
  });
}

/** Delete a batch that holds no stock. Stocked batches must be corrected to zero first
 * so the ledger is never broken by a disappearing lot. */
export async function deactivateBatch(
  id: string,
  userId: string,
): Promise<{ id: string; deleted: boolean; deactivated: boolean; reason?: string }> {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findUnique({
      where: { id },
      include: { product: true },
    });
    if (!batch) throw new NotFoundError('التشغيلة غير موجودة');

    if (batch.quantity > 0) {
      throw new ValidationError('لا يمكن حذف تشغيلة بها رصيد، صفّر الكمية أولاً');
    }

    await tx.batch.delete({ where: { id } });

    await recordAudit(
      {
        action: 'inventory.batch.deleted',
        entityType: 'Batch',
        entityId: id,
        before: {
          productId: batch.productId,
          lotNumber: batch.lotNumber,
          quantity: batch.quantity,
        },
        after: null,
        userId,
      },
      tx,
    );

    return { id: batch.id, deleted: true, deactivated: false };
  });
}

export interface ReceiptResult {
  reference: string;
  warehouseId: string;
  supplierId: string | null;
  linesReceived: number;
  unitsReceived: number;
  totalCost: string;
  batches: Array<{ batchId: string; productId: string; lotNumber: string; quantity: number }>;
}

/** Atomic goods-receipt note: batches + stock ledger + payables in one transaction. */
export async function receiveStock(input: StockReceiptInput, userId: string): Promise<ReceiptResult> {
  return prisma.$transaction(async (tx) => {
    return receiveStockInTx(tx, input, userId);
  });
}

/** Core receipt logic executed inside an already-open transaction (used by replace). */
async function receiveStockInTx(
  tx: Prisma.TransactionClient,
  input: StockReceiptInput,
  userId: string,
): Promise<ReceiptResult> {
  await assertWarehouse(tx, input.warehouseId);

  if (input.supplierId) {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw new NotFoundError('المورد غير موجود');
  }

  const reference = input.reference?.trim() || `GRN-${Date.now().toString(36).toUpperCase()}`;
  const batches: ReceiptResult['batches'] = [];
  let unitsReceived = 0;
  let totalCost = new Prisma.Decimal(0);

  for (const item of input.items) {
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: { id: true, nameAr: true, isActive: true },
    });
    if (!product) throw new NotFoundError(`المنتج غير موجود: ${item.productId}`);
    if (!product.isActive) throw new ValidationError(`المنتج مُوقف: ${product.nameAr}`);

    const batch = await upsertBatch(tx, {
      productId: item.productId,
      warehouseId: input.warehouseId,
      supplierId: input.supplierId ?? null,
      lotNumber: item.lotNumber.trim(),
      expiryDate: item.expiryDate,
      manufactureDate: item.manufactureDate ?? null,
      quantity: item.quantity,
      costPrice: item.costPrice,
      salePrice: item.salePrice ?? null,
    });

    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        batchId: batch.id,
        warehouseId: input.warehouseId,
        type: 'RECEIPT',
        quantity: item.quantity,
        unitCost: new Prisma.Decimal(item.costPrice),
        reason: 'استلام مشتريات',
        reference,
        userId,
      },
    });

    unitsReceived += item.quantity;
    totalCost = totalCost.add(new Prisma.Decimal(item.costPrice).mul(item.quantity));
    batches.push({
      batchId: batch.id,
      productId: item.productId,
      lotNumber: item.lotNumber,
      quantity: item.quantity,
    });
  }

  if (input.supplierId) {
    await tx.supplier.update({
      where: { id: input.supplierId },
      data: { balance: { increment: totalCost } },
    });
  }

  const result: ReceiptResult = {
    reference,
    warehouseId: input.warehouseId,
    supplierId: input.supplierId ?? null,
    linesReceived: input.items.length,
    unitsReceived,
    totalCost: totalCost.toFixed(2),
    batches,
  };

  await recordAudit(
    {
      action: 'inventory.receipt',
      entityType: 'StockReceipt',
      entityId: reference,
      after: {
        reference,
        warehouseId: input.warehouseId,
        supplierId: input.supplierId ?? null,
        lines: input.items.length,
        units: unitsReceived,
        totalCost: result.totalCost,
      },
      userId,
    },
    tx,
  );

  return result;
}

/** Reverse a posted purchase receipt: reduce batch quantities, credit back the
 * supplier balance, remove the receipt's stock movements, and leave an audit
 * trail. Safe to call only on receipts whose stock has not yet been fully sold;
 * batch quantities are clamped at zero so the ledger never goes negative. */
export async function reversePurchase(
  reference: string,
  userId: string,
): Promise<{ reference: string; reversed: boolean; unitsReversed: number }> {
  return prisma.$transaction(async (tx) => {
    const movements = await tx.stockMovement.findMany({
      where: { type: 'RECEIPT', reference },
      include: { batch: true, product: true },
    });
    if (movements.length === 0) throw new NotFoundError('فاتورة المشتريات غير موجودة');

    const supplierId = movements[0]!.batch?.supplierId ?? null;
    let unitsReversed = 0;
    let totalReversed = new Prisma.Decimal(0);

    for (const movement of movements) {
      unitsReversed += movement.quantity;
      totalReversed = totalReversed.add(new Prisma.Decimal(movement.unitCost ?? 0).mul(movement.quantity));

      if (movement.batchId && movement.batch) {
        await tx.batch.update({
          where: { id: movement.batchId },
          data: {
            quantity: Math.max(0, movement.batch.quantity - movement.quantity),
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          productId: movement.productId,
          batchId: movement.batchId,
          warehouseId: movement.warehouseId,
          type: 'ADJUSTMENT_OUT',
          quantity: movement.quantity,
          unitCost: movement.unitCost,
          reason: 'إلغاء فاتورة مشتريات',
          reference: `REV-${reference}`,
          userId,
        },
      });
    }

    if (supplierId) {
      await tx.supplier.update({
        where: { id: supplierId },
        data: { balance: { decrement: totalReversed } },
      });
    }

    await tx.stockMovement.deleteMany({ where: { type: 'RECEIPT', reference } });

    await recordAudit(
      {
        action: 'inventory.receipt.reversed',
        entityType: 'StockReceipt',
        entityId: reference,
        before: {
          reference,
          units: unitsReversed,
          totalCost: totalReversed.toFixed(2),
        },
        after: null,
        userId,
      },
      tx,
    );

    return { reference, reversed: true, unitsReversed };
  });
}

/** Replace a posted purchase receipt: reverse the original then record a new
 * receipt with the supplied input, all in one transaction. */
export async function replacePurchase(
  reference: string,
  input: StockReceiptInput,
  userId: string,
): Promise<ReceiptResult> {
  return prisma.$transaction(async (tx) => {
    await reversePurchaseInTx(tx, reference, userId);
    return receiveStockInTx(tx, input, userId);
  });
}

/** Core reversal executed inside an already-open transaction. */
async function reversePurchaseInTx(
  tx: Prisma.TransactionClient,
  reference: string,
  userId: string,
): Promise<{ unitsReversed: number; totalReversed: Prisma.Decimal; supplierId: string | null }> {
  const movements = await tx.stockMovement.findMany({
    where: { type: 'RECEIPT', reference },
    include: { batch: true },
  });
  if (movements.length === 0) throw new NotFoundError('فاتورة المشتريات غير موجودة');

  const supplierId = movements[0]!.batch?.supplierId ?? null;
  let unitsReversed = 0;
  let totalReversed = new Prisma.Decimal(0);

  for (const movement of movements) {
    unitsReversed += movement.quantity;
    totalReversed = totalReversed.add(new Prisma.Decimal(movement.unitCost ?? 0).mul(movement.quantity));

    if (movement.batchId && movement.batch) {
      await tx.batch.update({
        where: { id: movement.batchId },
        data: {
          quantity: Math.max(0, movement.batch.quantity - movement.quantity),
        },
      });
    }

    await tx.stockMovement.create({
      data: {
        productId: movement.productId,
        batchId: movement.batchId,
        warehouseId: movement.warehouseId,
        type: 'ADJUSTMENT_OUT',
        quantity: movement.quantity,
        unitCost: movement.unitCost,
        reason: 'إلغاء فاتورة مشتريات',
        reference: `REV-${reference}`,
        userId,
      },
    });
  }

  if (supplierId) {
    await tx.supplier.update({
      where: { id: supplierId },
      data: { balance: { decrement: totalReversed } },
    });
  }

  await tx.stockMovement.deleteMany({ where: { type: 'RECEIPT', reference } });

  return { unitsReversed, totalReversed, supplierId };
}

export interface AdjustmentResult {
  productId: string;
  warehouseId: string;
  type: string;
  quantity: number;
  allocations: Array<{ batchId: string; quantity: number; remainingQuantity: number }>;
}

/**
 * Atomic stock adjustment / count correction.
 *
 * Guard rails:
 *  - outbound quantities are applied with `WHERE quantity + delta >= 0`, so a
 *    concurrent sale can never drive a batch negative;
 *  - balances are mutated in SQL (`quantity = quantity + delta`), never
 *    read-modify-written in JavaScript.
 */
export async function adjustStock(
  input: StockAdjustmentInput,
  userId: string,
): Promise<AdjustmentResult> {
  const delta = signedQuantity(input.type, input.quantity);

  return prisma.$transaction(async (tx) => {
    await assertWarehouse(tx, input.warehouseId);

    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { id: true, nameAr: true },
    });
    if (!product) throw new NotFoundError('المنتج غير موجود');

    const allocations: AdjustmentResult['allocations'] = [];

    if (input.batchId) {
      const rows = await tx.$queryRaw<{ id: string; quantity: number }[]>`
        UPDATE batches
        SET quantity = quantity + ${delta}, "updatedAt" = now()
        WHERE id = ${input.batchId}
          AND "productId" = ${input.productId}
          AND "warehouseId" = ${input.warehouseId}
          AND quantity + ${delta} >= 0
        RETURNING id, quantity
      `;
      const row = rows[0];
      if (!row) {
        throw new InsufficientStockError('الكمية غير كافية في هذه التشغيلة أو أن التشغيلة غير مطابقة');
      }
      await tx.stockMovement.create({
        data: {
          productId: input.productId,
          batchId: input.batchId,
          warehouseId: input.warehouseId,
          type: input.type,
          quantity: delta,
          reason: input.reason,
          userId,
        },
      });
      allocations.push({ batchId: row.id, quantity: delta, remainingQuantity: row.quantity });
    } else if (delta > 0) {
      if (!input.lotNumber || !input.expiryDate) {
        throw new ValidationError('رقم التشغيلة وتاريخ الانتهاء مطلوبان عند إضافة كمية جديدة');
      }
      const batch = await upsertBatch(tx, {
        productId: input.productId,
        warehouseId: input.warehouseId,
        supplierId: null,
        lotNumber: input.lotNumber.trim(),
        expiryDate: input.expiryDate,
        manufactureDate: null,
        quantity: delta,
        costPrice: input.costPrice ?? '0.00',
        salePrice: null,
      });
      await tx.stockMovement.create({
        data: {
          productId: input.productId,
          batchId: batch.id,
          warehouseId: input.warehouseId,
          type: input.type,
          quantity: delta,
          unitCost: input.costPrice ? new Prisma.Decimal(input.costPrice) : null,
          reason: input.reason,
          userId,
        },
      });
      allocations.push({ batchId: batch.id, quantity: delta, remainingQuantity: batch.quantity });
    } else {
      // Outbound without an explicit batch: FEFO allocation across all batches.
      const candidates = await tx.batch.findMany({
        where: { productId: input.productId, warehouseId: input.warehouseId, quantity: { gt: 0 } },
        select: { id: true, expiryDate: true, quantity: true },
      });

      const plan = allocateFefo(
        candidates.map<FefoCandidate>((batch) => ({
          batchId: batch.id,
          expiryDate: toDateOnly(batch.expiryDate),
          quantity: batch.quantity,
        })),
        input.quantity,
      );

      for (const allocation of plan) {
        const rows = await tx.$queryRaw<{ id: string; quantity: number }[]>`
          UPDATE batches
          SET quantity = quantity - ${allocation.quantity}, "updatedAt" = now()
          WHERE id = ${allocation.batchId} AND quantity >= ${allocation.quantity}
          RETURNING id, quantity
        `;
        const row = rows[0];
        if (!row) {
          throw new InsufficientStockError('تغيرت الكميات المتاحة أثناء العملية، أعد المحاولة', {
            batchId: allocation.batchId,
          });
        }
        await tx.stockMovement.create({
          data: {
            productId: input.productId,
            batchId: allocation.batchId,
            warehouseId: input.warehouseId,
            type: input.type,
            quantity: -allocation.quantity,
            reason: input.reason,
            userId,
          },
        });
        allocations.push({
          batchId: allocation.batchId,
          quantity: -allocation.quantity,
          remainingQuantity: row.quantity,
        });
      }
    }

    const result: AdjustmentResult = {
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: input.type,
      quantity: delta,
      allocations,
    };

    await recordAudit(
      {
        action: 'inventory.adjusted',
        entityType: 'Product',
        entityId: input.productId,
        before: null,
        after: { type: input.type, quantity: delta, reason: input.reason, allocations },
        userId,
      },
      tx,
    );

    return result;
  });
}

// ---------------------------------------------------------------------------
// Warehouse transfers
// ---------------------------------------------------------------------------

export interface TransferResult {
  reference: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  linesTransferred: number;
  unitsTransferred: number;
  items: Array<{
    productId: string;
    nameAr: string;
    lotNumber: string;
    expiryDate: string;
    quantity: number;
    fromBatchId: string;
    toBatchId: string;
    remainingQuantity: number;
  }>;
}

/**
 * Atomic warehouse-to-warehouse transfer.
 *
 * Whole batches move (lot + expiry follow the stock), which is why lines are
 * batch-level rather than product + FEFO:
 *  - the source batch is decremented with `WHERE quantity >= q`, so a
 *    concurrent sale or adjustment can never drive it negative;
 *  - the destination batch is upserted on (product, warehouse, lot, expiry),
 *    so moving a lot that already exists there merges quantities instead of
 *    duplicating the batch row;
 *  - both ledger rows share one `TRF-` reference, so the pair stays
 *    traceable (and reversible) as a single document.
 */
export async function transferStock(
  input: StockTransferInput,
  userId: string,
): Promise<TransferResult> {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new ValidationError('لا يمكن النقل إلى نفس المخزن');
  }

  return prisma.$transaction(async (tx) => {
    await assertWarehouse(tx, input.fromWarehouseId);
    await assertWarehouse(tx, input.toWarehouseId);

    const reference = input.reference?.trim() || `TRF-${Date.now().toString(36).toUpperCase()}`;
    const reason = 'تحويل بين المخازن';
    const items: TransferResult['items'] = [];
    let unitsTransferred = 0;

    for (const item of input.items) {
      const batch = await tx.batch.findUnique({
        where: { id: item.batchId },
        select: {
          id: true,
          productId: true,
          warehouseId: true,
          supplierId: true,
          lotNumber: true,
          expiryDate: true,
          manufactureDate: true,
          costPrice: true,
          salePrice: true,
          product: { select: { nameAr: true, isActive: true } },
        },
      });
      if (!batch) throw new NotFoundError(`الدفعة غير موجودة: ${item.batchId}`);
      if (batch.warehouseId !== input.fromWarehouseId) {
        throw new ValidationError(`الدفعة ${batch.lotNumber} لا تنتمي إلى المخزن المصدر`);
      }
      if (!batch.product.isActive) {
        throw new ValidationError(`المنتج موقوف: ${batch.product.nameAr}`);
      }

      const decremented = await tx.$queryRaw<{ id: string; quantity: number }[]>`
        UPDATE batches
        SET quantity = quantity - ${item.quantity}, "updatedAt" = now()
        WHERE id = ${item.batchId} AND quantity >= ${item.quantity}
        RETURNING id, quantity
      `;
      const source = decremented[0];
      if (!source) {
        throw new InsufficientStockError(
          `الكمية غير كافية في الدفعة ${batch.lotNumber} (${batch.product.nameAr})`,
          { batchId: item.batchId },
        );
      }

      const destination = await upsertBatch(tx, {
        productId: batch.productId,
        warehouseId: input.toWarehouseId,
        supplierId: batch.supplierId,
        lotNumber: batch.lotNumber,
        expiryDate: toDateOnly(batch.expiryDate),
        manufactureDate: batch.manufactureDate ? toDateOnly(batch.manufactureDate) : null,
        quantity: item.quantity,
        costPrice: money(batch.costPrice),
        salePrice: batch.salePrice === null ? null : money(batch.salePrice),
      });

      await tx.stockMovement.createMany({
        data: [
          {
            productId: batch.productId,
            batchId: batch.id,
            warehouseId: input.fromWarehouseId,
            type: 'TRANSFER_OUT',
            quantity: -item.quantity,
            unitCost: batch.costPrice,
            reason,
            reference,
            userId,
          },
          {
            productId: batch.productId,
            batchId: destination.id,
            warehouseId: input.toWarehouseId,
            type: 'TRANSFER_IN',
            quantity: item.quantity,
            unitCost: batch.costPrice,
            reason,
            reference,
            userId,
          },
        ],
      });

      unitsTransferred += item.quantity;
      items.push({
        productId: batch.productId,
        nameAr: batch.product.nameAr,
        lotNumber: batch.lotNumber,
        expiryDate: toDateOnly(batch.expiryDate),
        quantity: item.quantity,
        fromBatchId: batch.id,
        toBatchId: destination.id,
        remainingQuantity: source.quantity,
      });
    }

    const result: TransferResult = {
      reference,
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      linesTransferred: items.length,
      unitsTransferred,
      items,
    };

    await recordAudit(
      {
        action: 'inventory.transferred',
        entityType: 'Warehouse',
        entityId: input.fromWarehouseId,
        before: null,
        after: {
          reference,
          toWarehouseId: input.toWarehouseId,
          notes: input.notes ?? null,
          items,
        },
        userId,
      },
      tx,
    );

    return result;
  });
}
