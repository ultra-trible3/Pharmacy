import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isValidEan13, PRODUCT_IMAGE_MAX_BYTES } from '@pharmacy/shared';
import { prisma } from '../src/prisma.js';
import {
  bearer,
  createBatchFixture,
  createProductFixture,
  disconnect,
  resetDatabase,
  seedFixtures,
  testApp,
  tokenFor,
  type Fixtures,
} from './helpers.js';

// A real 1×1 PNG — the server sniffs the signature to decide what is stored.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG.toString('base64')}`;
// Minimal JFIF header — enough for the magic-byte sniff.
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

describe('product catalogue', () => {
  let fixtures: Fixtures;
  let ownerToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    await resetDatabase();
    fixtures = await seedFixtures();
    ownerToken = await tokenFor('OWNER');
    cashierToken = await tokenFor('CASHIER');
  });

  afterAll(async () => {
    await disconnect();
  });

  it('creates a product, normalising money to fixed 2-decimal strings', async () => {
    const response = await request(testApp)
      .post('/api/v1/products')
      .set(bearer(ownerToken))
      .send({
        sku: 'AUG-0001',
        barcode: '6221000000010',
        nameAr: 'أوجمنتين 1 جم',
        nameEn: 'Augmentin 1g',
        categoryId: fixtures.categoryId,
        dosageForm: 'TABLET',
        costPrice: '120',
        salePrice: 155.5,
        taxRate: '14',
        minStock: 10,
        prescriptionClass: 'PRESCRIPTION',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      sku: 'AUG-0001',
      barcode: '6221000000010',
      nameAr: 'أوجمنتين 1 جم',
      costPrice: '120.00',
      salePrice: '155.50',
      taxRate: '14.00',
      minStock: 10,
      prescriptionClass: 'PRESCRIPTION',
      totalStock: 0,
    });
  });

  it('auto-assigns a unique internal barcode when a new product has none', async () => {
    const first = await request(testApp)
      .post('/api/v1/products')
      .set(bearer(ownerToken))
      .send({ sku: 'AUTO-1', nameAr: 'صنف بلا باركود', salePrice: '12.00' });
    const second = await request(testApp)
      .post('/api/v1/products')
      .set(bearer(ownerToken))
      .send({ sku: 'AUTO-2', nameAr: 'صنف بلا باركود آخر', salePrice: '13.00' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const firstCode = first.body.barcode as string;
    const secondCode = second.body.barcode as string;
    expect(isValidEan13(firstCode)).toBe(true);
    expect(firstCode.startsWith('2')).toBe(true);
    // Two different products must never share a code.
    expect(secondCode).not.toBe(firstCode);
    expect(isValidEan13(secondCode)).toBe(true);
  });

  it('rejects a duplicate SKU with 409 CONFLICT', async () => {
    const response = await request(testApp)
      .post('/api/v1/products')
      .set(bearer(ownerToken))
      .send({ sku: 'AUG-0001', nameAr: 'صنف مكرر', salePrice: '5.00' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects an invalid payload with a field-level 400', async () => {
    const response = await request(testApp)
      .post('/api/v1/products')
      .set(bearer(ownerToken))
      .send({ sku: 'X', nameAr: '', salePrice: '-1' });

    expect(response.status).toBe(400);
    const fields = response.body.error.details.map((issue: { field: string }) => issue.field);
    expect(fields).toContain('body.nameAr');
    expect(fields).toContain('body.salePrice');
  });

  it('finds a product by Arabic name, by SKU and by barcode', async () => {
    const byName = await request(testApp)
      .get('/api/v1/products')
      .query({ q: 'أوجمنتين' })
      .set(bearer(ownerToken));
    expect(byName.status).toBe(200);
    expect(byName.body.items.map((item: { sku: string }) => item.sku)).toContain('AUG-0001');

    const bySku = await request(testApp)
      .get('/api/v1/products')
      .query({ q: 'AUG-0001' })
      .set(bearer(ownerToken));
    expect(bySku.body.items.map((item: { sku: string }) => item.sku)).toContain('AUG-0001');

    const byBarcode = await request(testApp)
      .get('/api/v1/products')
      .query({ q: '6221000000010' })
      .set(bearer(ownerToken));
    expect(byBarcode.body.items.map((item: { sku: string }) => item.sku)).toContain('AUG-0001');

    const byIngredient = await request(testApp)
      .get('/api/v1/products')
      .query({ q: 'Augmentin' })
      .set(bearer(ownerToken));
    expect(byIngredient.body.items.map((item: { sku: string }) => item.sku)).toContain('AUG-0001');
  });

  it('resolves a scanned barcode through the lookup endpoint', async () => {
    const found = await request(testApp)
      .get('/api/v1/products/lookup/6221000000010')
      .set(bearer(ownerToken));
    expect(found.status).toBe(200);
    expect(found.body.sku).toBe('AUG-0001');

    const missing = await request(testApp)
      .get('/api/v1/products/lookup/6229999999999')
      .set(bearer(ownerToken));
    expect(missing.status).toBe(404);
  });

  it('paginates results and reports totalPages', async () => {
    for (let index = 0; index < 5; index += 1) {
      await createProductFixture({ sku: `PAGE-${index}`, nameAr: `صنف صفحة ${index}` });
    }

    const page1 = await request(testApp)
      .get('/api/v1/products')
      .query({ page: 1, pageSize: 2, sortBy: 'sku', sortOrder: 'asc' })
      .set(bearer(ownerToken));

    expect(page1.status).toBe(200);
    expect(page1.body.items.length).toBe(2);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(2);
    expect(page1.body.total).toBeGreaterThanOrEqual(6);
    expect(page1.body.totalPages).toBe(Math.ceil(page1.body.total / 2));
  });

  it('hides cost price from roles without cost:view', async () => {
    const asOwner = await request(testApp)
      .get('/api/v1/products')
      .query({ q: 'AUG-0001' })
      .set(bearer(ownerToken));
    expect(asOwner.body.items[0].costPrice).toBe('120.00');

    const asCashier = await request(testApp)
      .get('/api/v1/products')
      .query({ q: 'AUG-0001' })
      .set(bearer(cashierToken));
    expect(asCashier.status).toBe(200);
    expect(asCashier.body.items[0].costPrice).toBe('0.00');
  });

  it('updates a product and records an audit entry', async () => {
    const created = await createProductFixture({ sku: 'UPD-1', nameAr: 'صنف للتحديث' });

    const response = await request(testApp)
      .patch(`/api/v1/products/${created.id}`)
      .set(bearer(ownerToken))
      .send({ salePrice: '77.25', minStock: 3 });

    expect(response.status).toBe(200);
    expect(response.body.salePrice).toBe('77.25');
    expect(response.body.minStock).toBe(3);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'Product', entityId: created.id, action: 'product.updated' },
    });
    expect(audit).not.toBeNull();
  });

  it('soft-deletes a product that already has stock, but hard-deletes an untouched one', async () => {
    // Untouched product -> real delete.
    const clean = await createProductFixture({ sku: 'DEL-CLEAN' });
    const deleted = await request(testApp)
      .delete(`/api/v1/products/${clean.id}`)
      .set(bearer(ownerToken));
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ deleted: true, deactivated: false });
    expect(await prisma.product.findUnique({ where: { id: clean.id } })).toBeNull();

    // Product with stock history -> soft deactivate so the ledger stays intact.
    const stocked = await createProductFixture({ sku: 'DEL-STOCK' });
    await createBatchFixture({
      productId: stocked.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'LOT-DEL',
      expiryDate: '2027-01-31',
      quantity: 4,
    });

    const soft = await request(testApp)
      .delete(`/api/v1/products/${stocked.id}`)
      .set(bearer(ownerToken));
    expect(soft.status).toBe(200);
    expect(soft.body).toMatchObject({ deleted: false, deactivated: true });

    const row = await prisma.product.findUnique({ where: { id: stocked.id } });
    expect(row).not.toBeNull();
    expect(row!.isActive).toBe(false);
    // The batch is preserved untouched.
    expect(
      await prisma.batch.count({ where: { productId: stocked.id } }),
    ).toBe(1);
  });

  it('aggregates stock and nearest expiry onto the list item', async () => {
    const product = await createProductFixture({ sku: 'AGG-1', nameAr: 'صنف تجميعي' });
    await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'NEAR',
      expiryDate: '2029-06-30',
      quantity: 7,
    });
    await createBatchFixture({
      productId: product.id,
      warehouseId: fixtures.warehouseId,
      lotNumber: 'FAR',
      expiryDate: '2030-12-31',
      quantity: 3,
    });

    const response = await request(testApp)
      .get(`/api/v1/products/${product.id}`)
      .set(bearer(ownerToken));

    expect(response.status).toBe(200);
    expect(response.body.totalStock).toBe(10);
    expect(response.body.nearestExpiry).toBe('2029-06-30');
  });

  it('assigns unique internal barcodes to products that have none', async () => {
    const bare1 = await createProductFixture({ sku: 'BAR-1', nameAr: 'صنف بدون باركود 1' });
    const bare2 = await createProductFixture({ sku: 'BAR-2', nameAr: 'صنف بدون باركود 2' });
    const kept = await createProductFixture({ sku: 'BAR-KEEP', barcode: '6221000000027' });

    const response = await request(testApp)
      .post('/api/v1/products/barcodes/assign')
      .set(bearer(ownerToken));

    expect(response.status).toBe(200);
    expect(response.body.assigned).toBeGreaterThanOrEqual(2);
    expect(response.body.remaining).toBe(0);

    const rows = await prisma.product.findMany({
      where: { id: { in: [bare1.id, bare2.id] } },
      select: { barcode: true },
    });
    const codes = rows.map((row) => row.barcode ?? '');
    expect(codes).toHaveLength(2);
    for (const code of codes) {
      expect(isValidEan13(code)).toBe(true);
      expect(code.startsWith('2')).toBe(true);
    }
    // Two different products must never share a code.
    expect(new Set(codes).size).toBe(2);

    // An existing manufacturer barcode is never overwritten.
    const keptRow = await prisma.product.findUnique({ where: { id: kept.id } });
    expect(keptRow?.barcode).toBe('6221000000027');

    // The assignment is audited, and a second pass is a no-op.
    expect(
      await prisma.auditLog.count({ where: { action: 'product.barcodes_assigned' } }),
    ).toBe(1);
    const second = await request(testApp)
      .post('/api/v1/products/barcodes/assign')
      .set(bearer(ownerToken));
    expect(second.body).toMatchObject({ assigned: 0, remaining: 0 });
  });

  it('refuses the barcode assignment without products:write', async () => {
    const response = await request(testApp)
      .post('/api/v1/products/barcodes/assign')
      .set(bearer(cashierToken));

    expect(response.status).toBe(403);
  });

  it('stores, replaces and removes a product photo', async () => {
    const product = await createProductFixture({ sku: 'IMG-1', nameAr: 'صنف له صورة' });

    const upload = await request(testApp)
      .put(`/api/v1/products/${product.id}/image`)
      .set(bearer(ownerToken))
      .send({ dataUrl: TINY_PNG_DATA_URL });

    expect(upload.status).toBe(200);
    expect(upload.body).toMatchObject({ hasImage: true });

    // List and detail advertise the photo without shipping any bytes.
    const list = await request(testApp)
      .get('/api/v1/products')
      .query({ q: 'IMG-1' })
      .set(bearer(ownerToken));
    expect(list.body.items[0].hasImage).toBe(true);
    expect(list.body.items[0].imageUrl).toBeUndefined();

    const detail = await request(testApp)
      .get(`/api/v1/products/${product.id}`)
      .set(bearer(ownerToken));
    expect(detail.body.hasImage).toBe(true);

    // The bytes come back through the dedicated endpoint, intact.
    const image = await request(testApp)
      .get(`/api/v1/products/${product.id}/image`)
      .set(bearer(ownerToken));
    expect(image.status).toBe(200);
    expect(image.body.mimeType).toBe('image/png');
    expect(Buffer.from(image.body.dataBase64, 'base64')).toEqual(TINY_PNG);

    // Replacing stores the sniffed content type, not the declared one.
    const replace = await request(testApp)
      .put(`/api/v1/products/${product.id}/image`)
      .set(bearer(ownerToken))
      .send({ dataUrl: `data:image/png;base64,${TINY_JPEG.toString('base64')}` });
    expect(replace.status).toBe(200);

    const afterReplace = await request(testApp)
      .get(`/api/v1/products/${product.id}/image`)
      .set(bearer(ownerToken));
    expect(afterReplace.body.mimeType).toBe('image/jpeg');

    // Removal clears both the marker and the bytes.
    const removed = await request(testApp)
      .delete(`/api/v1/products/${product.id}/image`)
      .set(bearer(ownerToken));
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ hasImage: false });

    const gone = await request(testApp)
      .get(`/api/v1/products/${product.id}/image`)
      .set(bearer(ownerToken));
    expect(gone.status).toBe(404);

    const afterRemove = await request(testApp)
      .get(`/api/v1/products/${product.id}`)
      .set(bearer(ownerToken));
    expect(afterRemove.body.hasImage).toBe(false);

    // Two uploads plus one removal are audited.
    const auditCount = await prisma.auditLog.count({
      where: {
        entityId: product.id,
        action: { in: ['product.image_updated', 'product.image_removed'] },
      },
    });
    expect(auditCount).toBe(3);
  });

  it('rejects a photo whose bytes are not a supported image', async () => {
    const product = await createProductFixture({ sku: 'IMG-BAD' });
    const response = await request(testApp)
      .put(`/api/v1/products/${product.id}/image`)
      .set(bearer(ownerToken))
      .send({
        dataUrl: `data:image/png;base64,${Buffer.from('definitely not an image').toString('base64')}`,
      });

    expect(response.status).toBe(400);
    expect(await prisma.productImage.count({ where: { productId: product.id } })).toBe(0);
  });

  it('rejects an unsupported format declared in the data URL', async () => {
    const product = await createProductFixture({ sku: 'IMG-GIF' });
    const response = await request(testApp)
      .put(`/api/v1/products/${product.id}/image`)
      .set(bearer(ownerToken))
      .send({ dataUrl: `data:image/gif;base64,${TINY_PNG.toString('base64')}` });

    expect(response.status).toBe(400);
  });

  it('rejects a photo above the size cap', async () => {
    const product = await createProductFixture({ sku: 'IMG-BIG' });
    const oversized = Buffer.concat([TINY_PNG, Buffer.alloc(PRODUCT_IMAGE_MAX_BYTES)]);
    const response = await request(testApp)
      .put(`/api/v1/products/${product.id}/image`)
      .set(bearer(ownerToken))
      .send({ dataUrl: `data:image/png;base64,${oversized.toString('base64')}` });

    expect(response.status).toBe(400);
  });

  it('requires products:write to change a product photo', async () => {
    const product = await createProductFixture({ sku: 'IMG-AUTH' });

    const upload = await request(testApp)
      .put(`/api/v1/products/${product.id}/image`)
      .set(bearer(cashierToken))
      .send({ dataUrl: TINY_PNG_DATA_URL });
    expect(upload.status).toBe(403);

    const remove = await request(testApp)
      .delete(`/api/v1/products/${product.id}/image`)
      .set(bearer(cashierToken));
    expect(remove.status).toBe(403);
  });

  it('returns 404 for a photo of an unknown product', async () => {
    const response = await request(testApp)
      .get('/api/v1/products/does-not-exist/image')
      .set(bearer(ownerToken));
    expect(response.status).toBe(404);
  });

  it('keeps the photo when the product is edited', async () => {
    const product = await createProductFixture({ sku: 'IMG-KEEP' });
    await request(testApp)
      .put(`/api/v1/products/${product.id}/image`)
      .set(bearer(ownerToken))
      .send({ dataUrl: TINY_PNG_DATA_URL });

    const updated = await request(testApp)
      .patch(`/api/v1/products/${product.id}`)
      .set(bearer(ownerToken))
      .send({ salePrice: '19.99' });

    expect(updated.status).toBe(200);
    expect(updated.body.hasImage).toBe(true);
  });
});
