import { z } from 'zod';
import { MOVEMENT_TYPES } from '../constants.js';
import { dateOnlySchema, optionalTrimmedString, paginationSchema } from './common.js';
import { moneySchema } from './product.js';

export const batchUpdateSchema = z
  .object({
    quantity: z.coerce.number().int().min(0, 'الكمية غير صالحة').max(10_000_000).optional(),
    costPrice: moneySchema.optional(),
    salePrice: moneySchema.optional(),
    expiryDate: dateOnlySchema.optional(),
    manufactureDate: dateOnlySchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'لا توجد بيانات للتحديث' });
export type BatchUpdateInput = z.infer<typeof batchUpdateSchema>;

export const stockReceiptItemSchema = z
  .object({
    productId: z.string().trim().min(1, 'المنتج مطلوب'),
    lotNumber: z.string().trim().min(1, 'رقم التشغيلة مطلوب').max(60),
    expiryDate: dateOnlySchema,
    manufactureDate: dateOnlySchema.optional(),
    quantity: z.coerce.number().int().min(1, 'الكمية يجب أن تكون أكبر من صفر').max(1_000_000),
    costPrice: moneySchema,
    salePrice: moneySchema.optional(),
  })
  .strict();
export type StockReceiptItem = z.infer<typeof stockReceiptItemSchema>;

export const stockReceiptSchema = z
  .object({
    warehouseId: z.string().trim().min(1, 'المخزن مطلوب'),
    supplierId: optionalTrimmedString(64),
    reference: optionalTrimmedString(60),
    notes: optionalTrimmedString(500),
    items: z.array(stockReceiptItemSchema).min(1, 'يجب إضافة صنف واحد على الأقل').max(500),
  })
  .strict();
export type StockReceiptInput = z.infer<typeof stockReceiptSchema>;

export const stockAdjustmentSchema = z
  .object({
    productId: z.string().trim().min(1),
    warehouseId: z.string().trim().min(1),
    batchId: optionalTrimmedString(64),
    lotNumber: optionalTrimmedString(60),
    expiryDate: dateOnlySchema.optional(),
    costPrice: moneySchema.optional(),
    type: z.enum(MOVEMENT_TYPES),
    quantity: z.coerce.number().int().min(1, 'الكمية يجب أن تكون أكبر من صفر').max(1_000_000),
    reason: z.string().trim().min(3, 'سبب التسوية مطلوب').max(300),
  })
  .strict();
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

export const inventoryQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  warehouseId: z.string().trim().max(64).optional(),
  productId: z.string().trim().max(64).optional(),
  expiringInDays: z.coerce.number().int().min(0).max(3650).optional(),
  includeExpired: z.enum(['true', 'false']).transform((v) => v === 'true').default('true'),
  inStockOnly: z.enum(['true', 'false']).transform((v) => v === 'true').default('false'),
  sortBy: z.enum(['expiryDate', 'productName', 'quantity', 'lotNumber']).default('expiryDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;

export interface InventoryBatchRow {
  batchId: string;
  productId: string;
  sku: string;
  productNameAr: string;
  productNameEn: string | null;
  barcode: string | null;
  warehouseId: string;
  warehouseNameAr: string;
  lotNumber: string;
  expiryDate: string;
  manufactureDate: string | null;
  quantity: number;
  costPrice: string;
  salePrice: string;
  daysToExpiry: number;
  isExpired: boolean;
  isNearExpiry: boolean;
  stockValue: string;
}

export interface StockLevelRow {
  productId: string;
  sku: string;
  nameAr: string;
  nameEn: string | null;
  totalQuantity: number;
  minStock: number;
  isLowStock: boolean;
  nearestExpiry: string | null;
  stockValue: string;
}

export const movementQuerySchema = paginationSchema.extend({
  productId: z.string().trim().max(64).optional(),
  batchId: z.string().trim().max(64).optional(),
  warehouseId: z.string().trim().max(64).optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type MovementQuery = z.infer<typeof movementQuerySchema>;

/**
 * Warehouse transfer: one document moving whole batches between warehouses.
 * Lines are batch-level (not product + FEFO) because a transfer physically
 * moves a specific lot; the lot and its expiry follow the stock.
 */
export const stockTransferItemSchema = z
  .object({
    batchId: z.string().trim().min(1, 'الدفعة مطلوبة'),
    quantity: z.coerce
      .number()
      .int()
      .min(1, 'الكمية يجب أن تكون 1 على الأقل')
      .max(1_000_000),
  })
  .strict();
export type StockTransferItem = z.infer<typeof stockTransferItemSchema>;

export const stockTransferSchema = z
  .object({
    fromWarehouseId: z.string().trim().min(1, 'المخزن المصدر مطلوب'),
    toWarehouseId: z.string().trim().min(1, 'المخزن الوجهة مطلوب'),
    reference: optionalTrimmedString(60),
    notes: optionalTrimmedString(500),
    items: z
      .array(stockTransferItemSchema)
      .min(1, 'يجب إضافة صنف واحد على الأقل')
      .max(200, 'عدد الأصناف يتجاوز الحد المسموح'),
  })
  .strict()
  .refine((value) => value.fromWarehouseId !== value.toWarehouseId, {
    message: 'لا يمكن النقل إلى نفس المخزن',
    path: ['toWarehouseId'],
  });
export type StockTransferInput = z.infer<typeof stockTransferSchema>;
