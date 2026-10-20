import {
  type CreateWarehouseInput,
  type Role,
  type UpdateWarehouseInput,
  type WarehouseQuery,
  hasPermission,
} from '@pharmacy/shared';
import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { parseDateOnly, todayInBusinessTimezone } from '../../lib/dates.js';
import { prisma } from '../../prisma.js';

export interface WarehouseStatsDto {
  skuCount: number;
  batchCount: number;
  unitCount: number;
  /** Decimal string, or `null` when the caller lacks `cost:view`. */
  stockValue: string | null;
  expiringSoonCount: number;
  expiredCount: number;
  openShiftCount: number;
}

export interface WarehouseDto {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  address: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stats?: WarehouseStatsDto;
}

interface WarehouseRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  address: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface StatsRow {
  warehouseId: string;
  skuCount: number;
  batchCount: number;
  unitCount: number;
  stockValue: Prisma.Decimal | string | null;
  expiringSoonCount: number;
  expiredCount: number;
}

const NEAR_EXPIRY_DAYS = 90;

function toWarehouseDto(warehouse: WarehouseRow, stats?: WarehouseStatsDto): WarehouseDto {
  return {
    id: warehouse.id,
    code: warehouse.code,
    nameAr: warehouse.nameAr,
    nameEn: warehouse.nameEn,
    address: warehouse.address,
    isDefault: warehouse.isDefault,
    isActive: warehouse.isActive,
    createdAt: warehouse.createdAt.toISOString(),
    updatedAt: warehouse.updatedAt.toISOString(),
    ...(stats ? { stats } : {}),
  };
}

/**
 * Live stock counters for every matching warehouse in one grouped query, plus
 * one grouped query for open shifts. Cost valuation is only serialised when the
 * caller holds `cost:view`; the SQL aggregate itself never crosses the wire
 * for those roles.
 */
async function statsForWarehouses(
  warehouses: WarehouseRow[],
  role: Role,
): Promise<Map<string, WarehouseStatsDto>> {
  const ids = warehouses.map((warehouse) => warehouse.id);
  if (ids.length === 0) return new Map();

  const today = todayInBusinessTimezone();
  const todayDate = parseDateOnly(today);
  const nearExpiryLimit = new Date(
    parseDateOnly(today).getTime() + NEAR_EXPIRY_DAYS * 86_400_000,
  );
  const canViewCost = hasPermission(role, 'cost:view');

  const [batchStats, shiftStats] = await Promise.all([
    prisma.$queryRaw<StatsRow[]>`
      SELECT "warehouseId",
             COUNT(DISTINCT "productId")::int AS "skuCount",
             COUNT(*)::int AS "batchCount",
             SUM(quantity)::int AS "unitCount",
             SUM(quantity * "costPrice")::numeric(14,2) AS "stockValue",
             COUNT(*) FILTER (
               WHERE "expiryDate" >= ${todayDate} AND "expiryDate" <= ${nearExpiryLimit}
             )::int AS "expiringSoonCount",
             COUNT(*) FILTER (
               WHERE "expiryDate" < ${todayDate}
             )::int AS "expiredCount"
      FROM batches
      WHERE quantity > 0 AND "warehouseId" = ANY(${ids})
      GROUP BY "warehouseId"
    `,
    prisma.cashDrawer.groupBy({
      by: ['warehouseId'],
      where: { warehouseId: { in: ids }, status: 'OPEN' },
      _count: { _all: true },
    }),
  ]);

  const openShifts = new Map(
    shiftStats.map((row) => [row.warehouseId, row._count._all] as const),
  );
  const byWarehouse = new Map<string, WarehouseStatsDto>();

  for (const row of batchStats) {
    byWarehouse.set(row.warehouseId, {
      skuCount: Number(row.skuCount),
      batchCount: Number(row.batchCount),
      unitCount: Number(row.unitCount),
      stockValue: canViewCost ? new Prisma.Decimal(row.stockValue ?? 0).toFixed(2) : null,
      expiringSoonCount: Number(row.expiringSoonCount),
      expiredCount: Number(row.expiredCount),
      openShiftCount: openShifts.get(row.warehouseId) ?? 0,
    });
  }

  // A warehouse with only open shifts and no stock still needs its counter.
  for (const warehouse of warehouses) {
    if (byWarehouse.has(warehouse.id)) continue;
    byWarehouse.set(warehouse.id, {
      skuCount: 0,
      batchCount: 0,
      unitCount: 0,
      stockValue: canViewCost ? '0.00' : null,
      expiringSoonCount: 0,
      expiredCount: 0,
      openShiftCount: openShifts.get(warehouse.id) ?? 0,
    });
  }

  return byWarehouse;
}

export async function listWarehouses(query: WarehouseQuery, role: Role): Promise<WarehouseDto[]> {
  const where: Prisma.WarehouseWhereInput = {
    ...(query.includeInactive ? {} : { isActive: true }),
    ...(query.q
      ? {
          OR: [
            { code: { contains: query.q, mode: 'insensitive' as const } },
            { nameAr: { contains: query.q, mode: 'insensitive' as const } },
            { nameEn: { contains: query.q, mode: 'insensitive' as const } },
            { address: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const warehouses = await prisma.warehouse.findMany({
    where,
    orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { nameAr: 'asc' }],
  });

  if (!query.withStats) return warehouses.map((warehouse) => toWarehouseDto(warehouse));

  const stats = await statsForWarehouses(warehouses, role);
  return warehouses.map((warehouse) =>
    toWarehouseDto(warehouse, stats.get(warehouse.id)),
  );
}

export async function createWarehouse(
  input: CreateWarehouseInput,
  userId: string,
): Promise<WarehouseDto> {
  const code = input.code.trim().toUpperCase();
  const clash = await prisma.warehouse.findUnique({ where: { code } });
  if (clash) throw new ConflictError(`كود المخزن مستخدم بالفعل: ${code}`);

  return prisma.$transaction(async (tx) => {
    const activeCount = await tx.warehouse.count({ where: { isActive: true } });
    if (activeCount === 0 && !input.isActive) {
      throw new ValidationError('لا يمكن إنشاء أول مخزن غير نشط');
    }

    // The first active warehouse always becomes the receiving point.
    const isDefault = input.isDefault || activeCount === 0;
    if (isDefault) {
      await tx.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }

    const created = await tx.warehouse.create({
      data: {
        code,
        nameAr: input.nameAr,
        nameEn: input.nameEn ?? null,
        address: input.address ?? null,
        isDefault,
        isActive: input.isActive,
      },
    });

    await recordAudit(
      {
        action: 'warehouse.created',
        entityType: 'Warehouse',
        entityId: created.id,
        after: { code: created.code, nameAr: created.nameAr, isDefault: created.isDefault },
        userId,
      },
      tx,
    );

    return toWarehouseDto(created);
  });
}

export async function updateWarehouse(
  id: string,
  input: UpdateWarehouseInput,
  userId: string,
): Promise<WarehouseDto> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.warehouse.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('المخزن غير موجود');

    const nextActive = input.isActive ?? existing.isActive;
    if (input.isDefault === true && !nextActive) {
      throw new ValidationError('لا يمكن تعيين مخزن غير نشط كوجهة استلام افتراضية');
    }

    // Guard only true deactivations; re-sending `isActive: false` is harmless.
    if (input.isActive === false && existing.isActive) {
      if (existing.isDefault) {
        throw new ConflictError(
          'لا يمكن إيقاف المخزن الافتراضي. اختر مخزنًا آخر كوجهة استلام افتراضية أولًا',
        );
      }

      const stock = await tx.batch.aggregate({
        where: { warehouseId: id, quantity: { gt: 0 } },
        _sum: { quantity: true },
      });
      const units = stock._sum.quantity ?? 0;
      if (units > 0) {
        throw new ConflictError(`لا يمكن إيقاف المخزن لوجود ${units} وحدة مخزون فيه`);
      }

      const openShifts = await tx.cashDrawer.count({
        where: { warehouseId: id, status: 'OPEN' },
      });
      if (openShifts > 0) {
        throw new ConflictError('لا يمكن إيقاف المخزن لوجود وردية مفتوحة عليه');
      }

      const otherActive = await tx.warehouse.count({
        where: { isActive: true, id: { not: id } },
      });
      if (otherActive === 0) {
        throw new ConflictError('لا يمكن إيقاف آخر مخزن نشط');
      }
    }

    if (input.isDefault === true) {
      await tx.warehouse.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const updated = await tx.warehouse.update({
      where: { id },
      data: {
        ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
        ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await recordAudit(
      {
        action: 'warehouse.updated',
        entityType: 'Warehouse',
        entityId: updated.id,
        before: {
          nameAr: existing.nameAr,
          nameEn: existing.nameEn,
          address: existing.address,
          isDefault: existing.isDefault,
          isActive: existing.isActive,
        },
        after: {
          nameAr: updated.nameAr,
          nameEn: updated.nameEn,
          address: updated.address,
          isDefault: updated.isDefault,
          isActive: updated.isActive,
        },
        userId,
      },
      tx,
    );

    return toWarehouseDto(updated);
  });
}
