import { describe, expect, it } from 'vitest';
import {
  createProductSchema,
  moneySchema,
  percentSchema,
  productImageDataUrlSchema,
  setProductImageSchema,
  sniffProductImageMimeType,
  updateProductSchema,
} from './product.js';
import { stockReceiptSchema, stockAdjustmentSchema, stockTransferSchema } from './inventory.js';
import { loginSchema } from './auth.js';
import { paginationSchema } from './common.js';
import { debtPaymentSchema, debtQuerySchema } from './debt.js';
import { purchaseQuerySchema } from './purchase.js';
import { cashMovementSchema, closeShiftSchema, openShiftSchema } from './shift.js';
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  warehouseQuerySchema,
} from './warehouse.js';

describe('money and percent schemas', () => {
  it('normalises monetary input to a fixed 2-decimal string', () => {
    expect(moneySchema.parse(10)).toBe('10.00');
    expect(moneySchema.parse('10.5')).toBe('10.50');
    expect(moneySchema.parse('1.005')).toBe('1.01');
    expect(moneySchema.parse(0)).toBe('0.00');
  });

  it('rejects negative and non-numeric money', () => {
    expect(moneySchema.safeParse('-1').success).toBe(false);
    expect(moneySchema.safeParse('abc').success).toBe(false);
    expect(moneySchema.safeParse('').success).toBe(false);
  });

  it('bounds percentages to 0..100', () => {
    expect(percentSchema.parse('14')).toBe('14.00');
    expect(percentSchema.safeParse('101').success).toBe(false);
    expect(percentSchema.safeParse('-1').success).toBe(false);
  });
});

describe('shift schemas', () => {
  it('normalises shift money fields and rejects unknown keys', () => {
    expect(openShiftSchema.parse({ warehouseId: 'w1', openingBalance: '50' }).openingBalance).toBe(
      '50.00',
    );
    expect(
      openShiftSchema.safeParse({ warehouseId: 'w1', openingBalance: '0.00', extra: true }).success,
    ).toBe(false);
    expect(closeShiftSchema.parse({ closingBalance: 100 }).closingBalance).toBe('100.00');
  });

  it('validates explicit cash movements', () => {
    const parsed = cashMovementSchema.parse({
      type: 'paid_in',
      amount: '25.5',
      reason: 'إيداع من الخزنة',
    });
    expect(parsed.amount).toBe('25.50');
    expect(cashMovementSchema.safeParse({ type: 'paid_in', amount: '0', reason: 'سبب' }).success).toBe(
      false,
    );
    expect(
      cashMovementSchema.safeParse({ type: 'paid_out', amount: '5.00', reason: 'x' }).success,
    ).toBe(false);
    expect(
      cashMovementSchema.safeParse({ type: 'transfer', amount: '5.00', reason: 'سبب' }).success,
    ).toBe(false);
  });
});

describe('product schema', () => {
  const valid = {
    sku: 'MED-0001',
    nameAr: 'باراسيتامول 500 مجم',
    salePrice: '12.50',
  };

  it('accepts a minimal product and applies defaults', () => {
    const parsed = createProductSchema.parse(valid);
    expect(parsed.costPrice).toBe('0.00');
    expect(parsed.taxRate).toBe('0.00');
    expect(parsed.minStock).toBe(5);
    expect(parsed.prescriptionClass).toBe('OTC');
    expect(parsed.dosageForm).toBe('OTHER');
    expect(parsed.isActive).toBe(true);
    expect(parsed.altBarcodes).toEqual([]);
  });

  it('rejects invalid SKUs, unknown fields and bad barcodes', () => {
    expect(createProductSchema.safeParse({ ...valid, sku: '-bad' }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, unexpected: 1 }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, barcode: '12345' }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, barcode: '4006381333931' }).success).toBe(true);
    expect(createProductSchema.safeParse({ ...valid, salePrice: '-3' }).success).toBe(false);
  });

  it('requires the Arabic name', () => {
    expect(createProductSchema.safeParse({ sku: 'X1', salePrice: '1' }).success).toBe(false);
  });

  it('supports partial updates without re-applying create defaults', () => {
    const parsed = updateProductSchema.parse({ salePrice: '20' });
    expect(parsed.salePrice).toBe('20.00');
    expect(parsed.costPrice).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(['salePrice']);
  });
});

describe('product image schemas', () => {
  const pngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('accepts a well-formed PNG data URL', () => {
    expect(setProductImageSchema.safeParse({ dataUrl: pngDataUrl }).success).toBe(true);
  });

  it('rejects unsupported formats, malformed base64 and extra fields', () => {
    expect(productImageDataUrlSchema.safeParse('data:image/gif;base64,AAAA').success).toBe(false);
    expect(productImageDataUrlSchema.safeParse('https://example.com/a.png').success).toBe(false);
    expect(productImageDataUrlSchema.safeParse('data:image/png;base64,not base64 !!').success).toBe(
      false,
    );
    expect(setProductImageSchema.safeParse({ dataUrl: pngDataUrl, extra: 1 }).success).toBe(false);
  });

  it('rejects a decoded image above the size cap', () => {
    const oversized = `data:image/png;base64,${'A'.repeat(1_400_000)}`;
    expect(productImageDataUrlSchema.safeParse(oversized).success).toBe(false);
  });

  it('sniffs PNG, JPEG and WebP magic bytes', () => {
    expect(
      sniffProductImageMimeType(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ),
    ).toBe('image/png');
    expect(
      sniffProductImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])),
    ).toBe('image/jpeg');
    expect(
      sniffProductImageMimeType(
        Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('image/webp');
    expect(sniffProductImageMimeType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
    expect(sniffProductImageMimeType(Uint8Array.from([]))).toBeNull();
  });
});

describe('inventory schemas', () => {
  it('validates a supplier receipt with at least one line', () => {
    const receipt = {
      warehouseId: 'wh_main',
      items: [
        {
          productId: 'p1',
          lotNumber: 'LOT-1',
          expiryDate: '2027-06-30',
          quantity: 10,
          costPrice: '5.25',
        },
      ],
    };
    const parsed = stockReceiptSchema.parse(receipt);
    expect(parsed.items[0]?.expiryDate).toBe('2027-06-30');
    expect(parsed.items[0]?.costPrice).toBe('5.25');
    expect(stockReceiptSchema.safeParse({ ...receipt, items: [] }).success).toBe(false);
  });

  it('rejects malformed expiry dates and zero quantities', () => {
    const base = {
      warehouseId: 'wh_main',
      items: [
        { productId: 'p1', lotNumber: 'L', expiryDate: '30-06-2027', quantity: 0, costPrice: '1' },
      ],
    };
    expect(stockReceiptSchema.safeParse(base).success).toBe(false);
  });

  it('requires a reason and positive quantity for adjustments', () => {
    const ok = stockAdjustmentSchema.parse({
      productId: 'p1',
      warehouseId: 'wh_main',
      type: 'ADJUSTMENT_OUT',
      quantity: 3,
      reason: 'تلف بالعبوة',
    });
    expect(ok.quantity).toBe(3);
    expect(
      stockAdjustmentSchema.safeParse({
        productId: 'p1',
        warehouseId: 'wh_main',
        type: 'ADJUSTMENT_OUT',
        quantity: 0,
        reason: 'x',
      }).success,
    ).toBe(false);
  });

  it('validates a warehouse transfer and rejects same-warehouse or empty lines', () => {
    const transfer = {
      fromWarehouseId: 'wh_main',
      toWarehouseId: 'wh_shop',
      items: [{ batchId: 'b1', quantity: 5 }],
    };
    const parsed = stockTransferSchema.parse(transfer);
    expect(parsed.items[0]?.quantity).toBe(5);
    expect(parsed.reference).toBeUndefined();

    expect(
      stockTransferSchema.safeParse({ ...transfer, toWarehouseId: 'wh_main' }).success,
    ).toBe(false);
    expect(stockTransferSchema.safeParse({ ...transfer, items: [] }).success).toBe(false);
    expect(
      stockTransferSchema.safeParse({ ...transfer, items: [{ batchId: 'b1', quantity: 0 }] })
        .success,
    ).toBe(false);
  });
});

describe('login schema', () => {
  it('enforces minimum credential strength', () => {
    expect(loginSchema.safeParse({ username: 'admin', password: '12345678' }).success).toBe(true);
    expect(loginSchema.safeParse({ username: 'ab', password: '12345678' }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'admin', password: 'short' }).success).toBe(false);
  });
});

describe('pagination schema', () => {
  it('coerces and clamps page size', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(paginationSchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
    expect(paginationSchema.safeParse({ pageSize: '5000' }).success).toBe(false);
  });
});

describe('debt schemas', () => {
  it('normalises payment amounts and accepts cash without a reference', () => {
    const parsed = debtPaymentSchema.parse({ amount: 25.5, method: 'cash' });
    expect(parsed.amount).toBe('25.50');
    expect(parsed.method).toBe('cash');
  });

  it('requires a reference for card and wallet payments', () => {
    expect(
      debtPaymentSchema.safeParse({ amount: '10.00', method: 'card' }).success,
    ).toBe(false);
    expect(
      debtPaymentSchema
        .safeParse({ amount: '10.00', method: 'card', reference: 'AUTH-1' })
        .success,
    ).toBe(true);
    expect(
      debtPaymentSchema.safeParse({ amount: '10.00', method: 'wallet' }).success,
    ).toBe(false);
  });

  it('rejects zero amounts, the credit method and unknown fields', () => {
    expect(debtPaymentSchema.safeParse({ amount: '0.00', method: 'cash' }).success).toBe(false);
    expect(debtPaymentSchema.safeParse({ amount: '-5', method: 'cash' }).success).toBe(false);
    expect(debtPaymentSchema.safeParse({ amount: '5', method: 'credit' }).success).toBe(false);
    expect(
      debtPaymentSchema.safeParse({ amount: '5', method: 'cash', extra: 1 }).success,
    ).toBe(false);
  });

  it('defaults the receivables query pagination', () => {
    expect(debtQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(debtQuerySchema.parse({ q: 'منى' }).q).toBe('منى');
  });
});

describe('purchase schema', () => {
  it('defaults pagination and trims the search term', () => {
    expect(purchaseQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(purchaseQuerySchema.parse({ q: ' GRN-1 ' })).toMatchObject({ q: 'GRN-1' });
    expect(purchaseQuerySchema.safeParse({ pageSize: '5000' }).success).toBe(false);
  });
});

describe('warehouse schemas', () => {
  const valid = { code: 'WH-01', nameAr: 'المخزن الرئيسي' };

  it('trims the code and applies sensible defaults', () => {
    const parsed = createWarehouseSchema.parse({ ...valid, code: '  wh-01  ' });
    expect(parsed.code).toBe('wh-01');
    expect(parsed.isDefault).toBe(false);
    expect(parsed.isActive).toBe(true);
    expect(parsed.address).toBeUndefined();
  });

  it('rejects short or non-alphanumeric codes and unknown fields', () => {
    expect(createWarehouseSchema.safeParse({ ...valid, code: 'A' }).success).toBe(false);
    expect(createWarehouseSchema.safeParse({ ...valid, code: 'WH 01' }).success).toBe(false);
    expect(createWarehouseSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });

  it('never allows an inactive warehouse to be the default', () => {
    expect(
      createWarehouseSchema.safeParse({ ...valid, isDefault: true, isActive: false }).success,
    ).toBe(false);
    expect(updateWarehouseSchema.safeParse({ isDefault: true, isActive: false }).success).toBe(
      false,
    );
    expect(
      updateWarehouseSchema.safeParse({ isDefault: true, isActive: true }).success,
    ).toBe(true);
  });

  it('clears optional fields with an empty string and keeps the code immutable', () => {
    expect(updateWarehouseSchema.parse({ nameEn: '', address: '' })).toEqual({
      nameEn: null,
      address: null,
    });
    expect(updateWarehouseSchema.safeParse({ code: 'WH-02' }).success).toBe(false);
  });

  it('parses the list query flags from strings', () => {
    expect(warehouseQuerySchema.parse({})).toEqual({
      includeInactive: false,
      withStats: false,
    });
    expect(
      warehouseQuerySchema.parse({ includeInactive: 'true', withStats: 'true', q: ' main ' }),
    ).toEqual({ includeInactive: true, withStats: true, q: 'main' });
  });
});
