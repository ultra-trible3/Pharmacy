import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Role } from '@pharmacy/shared';
import { createApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { hashPassword } from '../src/lib/password.js';
import { generateRefreshToken, hashToken, signAccessToken } from '../src/lib/tokens.js';

/**
 * Shared fixtures for the API integration suite.
 *
 * Every file starts from an empty schema and seeds the minimum set of rows it
 * needs, so tests never depend on the demo seed or on execution order.
 */

export const TEST_PASSWORD = 'Test@1234';

export const USERNAME_BY_ROLE: Record<Role, string> = {
  OWNER: 'owner',
  MANAGER: 'manager',
  PHARMACIST: 'pharmacist',
  CASHIER: 'cashier',
  INVENTORY_CLERK: 'inventory',
  ACCOUNTANT: 'accountant',
};

export const ALL_ROLES = Object.keys(USERNAME_BY_ROLE) as Role[];

/** The fully-wired Express app (no listening socket required for supertest). */
export const testApp: Express = createApp();

/** Truncates every application table. `_prisma_migrations` is preserved. */
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((table) => `"public"."${table.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export interface Fixtures {
  warehouseId: string;
  categoryId: string;
  supplierId: string;
}

/** Creates the six role users plus one warehouse, category and supplier. */
export async function seedFixtures(): Promise<Fixtures> {
  const passwordHash = await hashPassword(TEST_PASSWORD);

  for (const role of ALL_ROLES) {
    await prisma.user.create({
      data: {
        username: USERNAME_BY_ROLE[role],
        fullName: `مستخدم ${role}`,
        role,
        passwordHash,
      },
    });
  }

  const warehouse = await prisma.warehouse.create({
    data: { code: 'MAIN', nameAr: 'المخزن الرئيسي', isDefault: true, isActive: true },
  });
  const category = await prisma.category.create({
    data: { code: 'CAT-1', nameAr: 'مسكنات' },
  });
  const supplier = await prisma.supplier.create({
    data: { code: 'SUP-1', nameAr: 'شركة الأدوية المصرية' },
  });

  return { warehouseId: warehouse.id, categoryId: category.id, supplierId: supplier.id };
}

/**
 * Mints a valid access token without going through `POST /auth/login`.
 *
 * This keeps the login rate limiter reserved for the tests that actually
 * exercise it, while still producing exactly the tokens the server issues.
 */
export async function tokenFor(role: Role): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { username: USERNAME_BY_ROLE[role] },
  });
  const refreshToken = generateRefreshToken();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 3_600_000),
      ip: '127.0.0.1',
    },
  });
  return signAccessToken({
    sub: user.id,
    username: user.username,
    role: user.role as Role,
    sid: session.id,
  }).token;
}

/** Convenience: `Authorization` header object. */
export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export interface ProductFixture {
  id: string;
  sku: string;
  nameAr: string;
  barcode: string | null;
}

/** Creates a catalogue product with sensible defaults. */
export async function createProductFixture(
  overrides: {
    sku?: string;
    nameAr?: string;
    nameEn?: string;
    barcode?: string;
    categoryId?: string;
    costPrice?: string;
    salePrice?: string;
    minStock?: number;
    prescriptionClass?: 'OTC' | 'PRESCRIPTION' | 'CONTROLLED';
    isActive?: boolean;
    activeIngredient?: string;
  } = {},
): Promise<ProductFixture> {
  const product = await prisma.product.create({
    data: {
      sku: overrides.sku ?? `SKU-${randomUUID().slice(0, 8)}`,
      nameAr: overrides.nameAr ?? 'باراسيتامول 500 مجم',
      nameEn: overrides.nameEn ?? 'Paracetamol 500mg',
      barcode: overrides.barcode ?? null,
      categoryId: overrides.categoryId ?? null,
      activeIngredient: overrides.activeIngredient ?? null,
      costPrice: overrides.costPrice ?? '5.00',
      salePrice: overrides.salePrice ?? '9.50',
      minStock: overrides.minStock ?? 5,
      prescriptionClass: overrides.prescriptionClass ?? 'OTC',
      isActive: overrides.isActive ?? true,
    },
    select: { id: true, sku: true, nameAr: true, barcode: true },
  });
  return product;
}

/** Creates a stock batch directly (bypassing the receipt endpoint). */
export async function createBatchFixture(params: {
  productId: string;
  warehouseId: string;
  lotNumber: string;
  expiryDate: string;
  quantity: number;
  costPrice?: string;
  salePrice?: string | null;
  supplierId?: string | null;
}): Promise<{ id: string; quantity: number }> {
  return prisma.batch.create({
    data: {
      productId: params.productId,
      warehouseId: params.warehouseId,
      supplierId: params.supplierId ?? null,
      lotNumber: params.lotNumber,
      expiryDate: new Date(`${params.expiryDate}T00:00:00.000Z`),
      quantity: params.quantity,
      costPrice: params.costPrice ?? '5.00',
      salePrice: params.salePrice ?? null,
    },
    select: { id: true, quantity: true },
  });
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
