import { Prisma, type PrismaClient } from '@prisma/client';
import type { CreateProductInput, ProductQuery, UpdateProductInput } from '@pharmacy/shared';
import { prisma } from '../../prisma.js';
import { toDateOnly } from '../../lib/dates.js';

export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface ProductRow {
  id: string;
  sku: string;
  barcode: string | null;
  nameAr: string;
  nameEn: string | null;
  brand: string | null;
  manufacturer: string | null;
  categoryId: string | null;
  dosageForm: string;
  strength: string | null;
  packSize: string | null;
  unit: string | null;
  activeIngredient: string | null;
  costPrice: Prisma.Decimal;
  salePrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  minStock: number;
  prescriptionClass: string;
  isActive: boolean;
  imageUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category?: { nameAr: string } | null;
}

/**
 * Product ids whose aggregated stock across all warehouses is at or below the
 * product's own minimum threshold. Executed as a single parameterised query so
 * the `lowStock` filter composes with normal pagination.
 */
async function findLowStockProductIds(client: PrismaLike): Promise<string[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT p.id
    FROM products p
    LEFT JOIN batches b ON b."productId" = p.id
    WHERE p."isActive" = true
    GROUP BY p.id, p."minStock"
    HAVING COALESCE(SUM(b.quantity), 0) <= p."minStock"
  `;
  return rows.map((row) => row.id);
}

function buildWhere(
  query: ProductQuery,
  lowStockIds: string[] | null,
): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [];

  const q = query.q?.trim();
  if (q) {
    and.push({
      OR: [
        { nameAr: { contains: q, mode: 'insensitive' } },
        { nameEn: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { barcode: { equals: q } },
        { altBarcodes: { has: q } },
        { activeIngredient: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
        { manufacturer: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (query.categoryId) and.push({ categoryId: query.categoryId });
  if (query.prescriptionClass) and.push({ prescriptionClass: query.prescriptionClass });
  if (query.dosageForm) and.push({ dosageForm: query.dosageForm });
  if (query.isActive !== undefined) and.push({ isActive: query.isActive });
  if (lowStockIds) and.push({ id: { in: lowStockIds } });

  return and.length > 0 ? { AND: and } : {};
}

async function decorate(rows: ProductRow[]): Promise<
  Array<ProductRow & { totalStock: number; nearestExpiry: string | null }>
> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [totals, expiries] = await Promise.all([
    prisma.batch.groupBy({
      by: ['productId'],
      where: { productId: { in: ids }, quantity: { gt: 0 } },
      _sum: { quantity: true },
    }),
    prisma.batch.groupBy({
      by: ['productId'],
      where: { productId: { in: ids }, quantity: { gt: 0 } },
      _min: { expiryDate: true },
    }),
  ]);

  const totalMap = new Map(totals.map((t) => [t.productId, t._sum.quantity ?? 0]));
  const expiryMap = new Map(
    expiries.map((e) => [e.productId, e._min.expiryDate ? toDateOnly(e._min.expiryDate) : null]),
  );

  return rows.map((row) => ({
    ...row,
    totalStock: totalMap.get(row.id) ?? 0,
    nearestExpiry: expiryMap.get(row.id) ?? null,
  }));
}

function buildOrderBy(query: ProductQuery): Prisma.ProductOrderByWithRelationInput[] {
  const direction = query.sortOrder;
  switch (query.sortBy) {
    case 'sku':
      return [{ sku: direction }, { id: 'asc' }];
    case 'nameEn':
      return [{ nameEn: direction }, { id: 'asc' }];
    case 'salePrice':
      return [{ salePrice: direction }, { id: 'asc' }];
    case 'createdAt':
      return [{ createdAt: direction }, { id: 'asc' }];
    case 'updatedAt':
      return [{ updatedAt: direction }, { id: 'asc' }];
    case 'nameAr':
    default:
      return [{ nameAr: direction }, { id: 'asc' }];
  }
}

export async function listProducts(query: ProductQuery): Promise<{
  rows: Awaited<ReturnType<typeof decorate>>;
  total: number;
}> {
  const lowStockIds = query.lowStock ? await findLowStockProductIds(prisma) : null;
  const where = buildWhere(query, lowStockIds);

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: { select: { nameAr: true } } },
      orderBy: buildOrderBy(query),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return { rows: await decorate(rows as unknown as ProductRow[]), total };
}

export async function getProduct(id: string, client: PrismaLike = prisma) {
  return client.product.findUnique({
    where: { id },
    include: { category: { select: { id: true, nameAr: true, nameEn: true } } },
  });
}

export async function findProductByBarcode(barcode: string) {
  return prisma.product.findFirst({
    where: {
      OR: [{ barcode }, { sku: barcode }, { altBarcodes: { has: barcode } }],
      isActive: true,
    },
    include: { category: { select: { id: true, nameAr: true, nameEn: true } } },
  });
}

export function toPrismaCreateData(
  input: CreateProductInput,
  createdById: string,
): Prisma.ProductUncheckedCreateInput {
  return {
    sku: input.sku.trim().toUpperCase(),
    barcode: input.barcode ?? null,
    altBarcodes: input.altBarcodes,
    nameAr: input.nameAr,
    nameEn: input.nameEn ?? null,
    brand: input.brand ?? null,
    manufacturer: input.manufacturer ?? null,
    activeIngredient: input.activeIngredient ?? null,
    categoryId: input.categoryId ?? null,
    dosageForm: input.dosageForm,
    strength: input.strength ?? null,
    packSize: input.packSize ?? null,
    unit: input.unit ?? null,
    costPrice: new Prisma.Decimal(input.costPrice),
    salePrice: new Prisma.Decimal(input.salePrice),
    taxRate: new Prisma.Decimal(input.taxRate),
    minStock: input.minStock,
    prescriptionClass: input.prescriptionClass,
    notes: input.notes ?? null,
    isActive: input.isActive,
    createdById,
  };
}

export function toPrismaUpdateData(input: UpdateProductInput): Prisma.ProductUncheckedUpdateInput {
  const data: Prisma.ProductUncheckedUpdateInput = {};
  if (input.sku !== undefined) data.sku = input.sku.trim().toUpperCase();
  if (input.barcode !== undefined) data.barcode = input.barcode ?? null;
  if (input.altBarcodes !== undefined) data.altBarcodes = input.altBarcodes;
  if (input.nameAr !== undefined) data.nameAr = input.nameAr;
  if (input.nameEn !== undefined) data.nameEn = input.nameEn ?? null;
  if (input.brand !== undefined) data.brand = input.brand ?? null;
  if (input.manufacturer !== undefined) data.manufacturer = input.manufacturer ?? null;
  if (input.activeIngredient !== undefined) data.activeIngredient = input.activeIngredient ?? null;
  if (input.categoryId !== undefined) data.categoryId = input.categoryId ?? null;
  if (input.dosageForm !== undefined) data.dosageForm = input.dosageForm;
  if (input.strength !== undefined) data.strength = input.strength ?? null;
  if (input.packSize !== undefined) data.packSize = input.packSize ?? null;
  if (input.unit !== undefined) data.unit = input.unit ?? null;
  if (input.costPrice !== undefined) data.costPrice = new Prisma.Decimal(input.costPrice);
  if (input.salePrice !== undefined) data.salePrice = new Prisma.Decimal(input.salePrice);
  if (input.taxRate !== undefined) data.taxRate = new Prisma.Decimal(input.taxRate);
  if (input.minStock !== undefined) data.minStock = input.minStock;
  if (input.prescriptionClass !== undefined) data.prescriptionClass = input.prescriptionClass;
  if (input.notes !== undefined) data.notes = input.notes ?? null;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return data;
}
