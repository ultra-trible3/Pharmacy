import { Prisma } from '@prisma/client';
import {
  buildPaginated,
  generateInternalEan13,
  hasPermission,
  INTERNAL_BARCODE_PREFIX,
  sniffProductImageMimeType,
  type CreateProductInput,
  type Paginated,
  type ProductListItem,
  type ProductQuery,
  type Role,
  type SetProductImageInput,
  type UpdateProductInput,
} from '@pharmacy/shared';
import { prisma } from '../../prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import * as repo from './products.repository.js';
import type { ProductRow } from './products.repository.js';

function decimalToString(value: Prisma.Decimal | null | undefined, fallback = '0.00'): string {
  if (value === null || value === undefined) return fallback;
  return value.toFixed(2);
}

/** Maps a database row to the public API shape, hiding cost data when disallowed. */
export function toProductListItem(
  row: ProductRow & { totalStock: number; nearestExpiry: string | null },
  canViewCost: boolean,
): ProductListItem {
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    brand: row.brand,
    manufacturer: row.manufacturer,
    categoryId: row.categoryId,
    categoryNameAr: row.category?.nameAr ?? null,
    dosageForm: row.dosageForm,
    strength: row.strength,
    packSize: row.packSize,
    unit: row.unit,
    costPrice: canViewCost ? decimalToString(row.costPrice) : '0.00',
    salePrice: decimalToString(row.salePrice),
    taxRate: decimalToString(row.taxRate),
    minStock: row.minStock,
    prescriptionClass: row.prescriptionClass,
    isActive: row.isActive,
    totalStock: row.totalStock,
    nearestExpiry: row.nearestExpiry,
    hasImage: row.imageUpdatedAt !== null,
  };
}

export async function listProducts(
  query: ProductQuery,
  role: Role,
): Promise<Paginated<ProductListItem>> {
  const canViewCost = hasPermission(role, 'cost:view');
  const { rows, total } = await repo.listProducts(query);
  return buildPaginated(
    rows.map((row) => toProductListItem(row, canViewCost)),
    total,
    query.page,
    query.pageSize,
  );
}

export async function getProduct(id: string, role: Role) {
  const product = await repo.getProduct(id);
  if (!product) throw new NotFoundError('المنتج غير موجود');
  const canViewCost = hasPermission(role, 'cost:view');
  // Aggregated so the detail view carries the same derived fields as the list
  // (current quantity plus the earliest expiry across live batches).
  const totals = await prisma.batch.aggregate({
    where: { productId: id, quantity: { gt: 0 } },
    _sum: { quantity: true },
    _min: { expiryDate: true },
  });
  const { imageUpdatedAt, ...rest } = product;
  return {
    ...rest,
    costPrice: canViewCost ? decimalToString(product.costPrice) : '0.00',
    salePrice: decimalToString(product.salePrice),
    taxRate: decimalToString(product.taxRate),
    totalStock: totals._sum.quantity ?? 0,
    nearestExpiry: totals._min.expiryDate
      ? totals._min.expiryDate.toISOString().slice(0, 10)
      : null,
    hasImage: imageUpdatedAt !== null,
  };
}

export async function lookupByBarcode(code: string, role: Role): Promise<ProductListItem> {
  const trimmed = code.trim();
  if (!trimmed) throw new ValidationError('الباركود مطلوب');

  const product = await repo.findProductByBarcode(trimmed);
  if (!product) throw new NotFoundError(`لا يوجد منتج بالباركود: ${trimmed}`);

  const totals = await prisma.batch.aggregate({
    where: { productId: product.id, quantity: { gt: 0 } },
    _sum: { quantity: true },
    _min: { expiryDate: true },
  });

  return toProductListItem(
    {
      ...(product as unknown as ProductRow),
      totalStock: totals._sum.quantity ?? 0,
      nearestExpiry: totals._min.expiryDate ? totals._min.expiryDate.toISOString().slice(0, 10) : null,
    },
    hasPermission(role, 'cost:view'),
  );
}

// ---------------------------------------------------------------------------
// Product images
// ---------------------------------------------------------------------------

export interface ProductImageDto {
  mimeType: string;
  dataBase64: string;
  updatedAt: string;
}

/** Returns the stored photo bytes for a product, or 404 when none is set. */
export async function getProductImage(id: string): Promise<ProductImageDto> {
  const product = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!product) throw new NotFoundError('المنتج غير موجود');

  const image = await prisma.productImage.findUnique({ where: { productId: id } });
  if (!image) throw new NotFoundError('لا توجد صورة لهذا الصنف');

  return {
    mimeType: image.mimeType,
    dataBase64: Buffer.from(image.data).toString('base64'),
    updatedAt: image.updatedAt.toISOString(),
  };
}

/**
 * Stores (or replaces) the product photo. The MIME type declared in the data
 * URL is only a hint: the stored type is sniffed from the file's magic bytes
 * so a renamed or mislabelled upload can never be served back as something it
 * is not.
 */
export async function setProductImage(id: string, input: SetProductImageInput, userId: string) {
  const base64 = input.dataUrl.slice(input.dataUrl.indexOf(',') + 1);
  const data = Buffer.from(base64, 'base64');
  if (data.byteLength === 0) throw new ValidationError('الصورة فارغة');

  const mimeType = sniffProductImageMimeType(data);
  if (!mimeType) {
    throw new ValidationError('محتوى الملف ليس صورة صالحة (PNG أو JPG أو WebP)');
  }

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) throw new NotFoundError('المنتج غير موجود');

    const now = new Date();
    await tx.productImage.upsert({
      where: { productId: id },
      create: { productId: id, mimeType, data },
      update: { mimeType, data },
    });
    await tx.product.update({ where: { id }, data: { imageUpdatedAt: now } });

    await recordAudit(
      {
        action: 'product.image_updated',
        entityType: 'Product',
        entityId: id,
        after: { mimeType, bytes: data.byteLength },
        userId,
      },
      tx,
    );

    return { hasImage: true, updatedAt: now.toISOString() };
  });
}

/** Removes the product photo. Idempotent: removing a missing photo succeeds. */
export async function removeProductImage(id: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id },
      select: { id: true, imageUpdatedAt: true },
    });
    if (!product) throw new NotFoundError('المنتج غير موجود');

    await tx.productImage.deleteMany({ where: { productId: id } });
    if (product.imageUpdatedAt !== null) {
      await tx.product.update({ where: { id }, data: { imageUpdatedAt: null } });
      await recordAudit(
        {
          action: 'product.image_removed',
          entityType: 'Product',
          entityId: id,
          userId,
        },
        tx,
      );
    }

    return { hasImage: false };
  });
}

/** How many times a create may re-allocate an internal barcode after a race. */
const CREATE_BARCODE_RETRIES = 3;

/** True when `error` is a unique-constraint violation on the product barcode. */
function isBarcodeConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((field) => field.includes('barcode'));
}

/**
 * Reserve `count` unused internal EAN-13 codes inside the GS1 in-store range
 * (prefix 2), continuing after the highest internal code already in use so a
 * code is never reused.
 *
 * Must be called inside the caller's transaction. Two creators running at once
 * are separated by the unique index on `Product.barcode`; `createProduct`
 * retries with a fresh allocation when it loses that race.
 */
async function allocateInternalBarcodes(
  tx: Prisma.TransactionClient,
  count: number,
): Promise<string[]> {
  const existing = await tx.product.findMany({
    where: { barcode: { startsWith: INTERNAL_BARCODE_PREFIX } },
    select: { barcode: true },
  });

  const used = new Set<string>();
  let next = 1;
  for (const row of existing) {
    const code = row.barcode;
    if (!code || !/^\d{13}$/u.test(code)) continue;
    used.add(code);
    const sequence = Number(code.slice(1, 12));
    if (Number.isFinite(sequence) && sequence >= next) next = sequence + 1;
  }

  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    let candidate = generateInternalEan13(next);
    while (used.has(candidate)) {
      next += 1;
      candidate = generateInternalEan13(next);
    }
    next += 1;
    used.add(candidate);
    codes.push(candidate);
  }
  return codes;
}

export async function createProduct(input: CreateProductInput, userId: string, role: Role) {
  const sku = input.sku.trim().toUpperCase();
  // A product saved without a barcode is given a unique internal EAN-13, so
  // every catalogue item can be labelled the moment it is created.
  const needsBarcode = input.barcode === undefined || input.barcode.trim() === '';

  let lastError: unknown = new ConflictError('تعذر توليد باركود فريد');
  for (let attempt = 0; attempt < CREATE_BARCODE_RETRIES; attempt += 1) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const duplicate = await tx.product.findFirst({
          where: {
            OR: [
              { sku },
              ...(input.barcode ? [{ barcode: input.barcode }] : []),
              ...(input.altBarcodes.length > 0 ? [{ barcode: { in: input.altBarcodes } }] : []),
            ],
          },
          select: { id: true, sku: true, barcode: true },
        });
        if (duplicate) {
          throw new ConflictError(
            duplicate.sku === sku
              ? `كود المنتج مستخدم بالفعل: ${sku}`
              : `الباركود مستخدم بالفعل في المنتج: ${duplicate.sku}`,
          );
        }

        const data = repo.toPrismaCreateData(input, userId);
        if (needsBarcode) {
          const [barcode] = await allocateInternalBarcodes(tx, 1);
          data.barcode = barcode ?? null;
        }

        const created = await tx.product.create({ data });

        await recordAudit(
          {
            action: 'product.created',
            entityType: 'Product',
            entityId: created.id,
            after: {
              sku: created.sku,
              nameAr: created.nameAr,
              barcode: created.barcode,
              salePrice: created.salePrice.toString(),
            },
            userId,
          },
          tx,
        );

        return created;
      });

      return getProduct(created.id, role);
    } catch (error) {
      lastError = error;
      // Only a lost barcode race is retryable; a duplicate SKU or a validation
      // failure must surface untouched.
      if (!needsBarcode || !isBarcodeConflict(error)) throw error;
    }
  }

  throw lastError;
}

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
  userId: string,
  role: Role,
) {
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('المنتج غير موجود');

    if (input.sku) {
      const sku = input.sku.trim().toUpperCase();
      const clash = await tx.product.findFirst({
        where: { sku, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictError(`كود المنتج مستخدم بالفعل: ${sku}`);
    }

    if (input.barcode) {
      const clash = await tx.product.findFirst({
        where: { barcode: input.barcode, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictError(`الباركود مستخدم بالفعل: ${input.barcode}`);
    }

    const after = await tx.product.update({
      where: { id },
      data: repo.toPrismaUpdateData(input),
    });

    await recordAudit(
      {
        action: 'product.updated',
        entityType: 'Product',
        entityId: id,
        before: {
          sku: before.sku,
          nameAr: before.nameAr,
          salePrice: before.salePrice.toString(),
          costPrice: before.costPrice.toString(),
          isActive: before.isActive,
        },
        after: {
          sku: after.sku,
          nameAr: after.nameAr,
          salePrice: after.salePrice.toString(),
          costPrice: after.costPrice.toString(),
          isActive: after.isActive,
        },
        userId,
      },
      tx,
    );

    return after;
  });

  return getProduct(updated.id, role);
}

/**
 * Deletes a product only when it has never been transacted. Any product with
 * batches or movements is deactivated instead, preserving the stock ledger.
 */
export async function deleteProduct(
  id: string,
  userId: string,
): Promise<{ deleted: boolean; deactivated: boolean; reason?: string }> {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id },
      include: { _count: { select: { batches: true, movements: true } } },
    });
    if (!product) throw new NotFoundError('المنتج غير موجود');

    const hasHistory = (product._count?.batches ?? 0) > 0 || (product._count?.movements ?? 0) > 0;

    if (hasHistory) {
      await tx.product.update({ where: { id }, data: { isActive: false } });
      await recordAudit(
        {
          action: 'product.deactivated',
          entityType: 'Product',
          entityId: id,
          before: { isActive: product.isActive },
          after: { isActive: false },
          userId,
        },
        tx,
      );
      return {
        deleted: false,
        deactivated: true,
        reason: 'المنتج له حركات مخزنية، تم إيقافه بدلًا من الحذف للحفاظ على السجل',
      };
    }

    await tx.product.delete({ where: { id } });
    await recordAudit(
      { action: 'product.deleted', entityType: 'Product', entityId: id, before: { sku: product.sku }, userId },
      tx,
    );
    return { deleted: true, deactivated: false };
  });
}

/** Upper bound on how many products one assignment pass may touch. */
const ASSIGN_BATCH_LIMIT = 500;

/**
 * Give every product that has no barcode a unique internal EAN-13 code, so the
 * whole catalogue can be labelled in one step.
 *
 * The block is reserved inside the GS1 "in-store" range (prefix 2), continuing
 * after the highest internal code already in use, so it never collides with
 * codes issued by the product form's generator. Capped at `ASSIGN_BATCH_LIMIT`
 * items per call; the caller can repeat until `remaining` reaches zero.
 */
export async function assignMissingBarcodes(
  userId: string,
): Promise<{ assigned: number; remaining: number }> {
  return prisma.$transaction(async (tx) => {
    const targets = await tx.product.findMany({
      where: { OR: [{ barcode: null }, { barcode: '' }] },
      select: { id: true, sku: true, nameAr: true },
      orderBy: { createdAt: 'asc' },
      take: ASSIGN_BATCH_LIMIT,
    });

    if (targets.length === 0) return { assigned: 0, remaining: 0 };

    const codes = await allocateInternalBarcodes(tx, targets.length);

    const assigned: Array<{ id: string; sku: string; barcode: string }> = [];
    for (const [index, product] of targets.entries()) {
      const barcode = codes[index];
      if (barcode === undefined) continue;
      await tx.product.update({ where: { id: product.id }, data: { barcode } });
      assigned.push({ id: product.id, sku: product.sku, barcode });
    }

    await recordAudit(
      {
        action: 'product.barcodes_assigned',
        entityType: 'Product',
        entityId: null,
        after: { assigned: assigned.length, barcodes: assigned.map((item) => item.barcode) },
        userId,
      },
      tx,
    );

    const remaining = await tx.product.count({
      where: { OR: [{ barcode: null }, { barcode: '' }] },
    });

    return { assigned: assigned.length, remaining };
  });
}
