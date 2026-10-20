import { z } from 'zod';
import { dateOnlySchema, idSchema, optionalTrimmedString, paginationSchema } from './common.js';
import { moneySchema } from './product.js';

/** Payment methods accepted by the POS, mapped to `PaymentMethod` on the server. */
export const PAYMENT_METHODS = ['cash', 'card', 'wallet', 'credit'] as const;
export type PaymentMethodCode = (typeof PAYMENT_METHODS)[number];

export const SALE_STATUSES = ['completed', 'suspended', 'voided'] as const;
export type SaleStatusCode = (typeof SALE_STATUSES)[number];

/** Reporting windows used by the POS "best sellers" widget. */
export const SALE_PERIODS = ['today', 'week', 'month'] as const;
export type SalePeriod = (typeof SALE_PERIODS)[number];

/** A single line of a sale as sent by the POS client. */
export const saleItemInputSchema = z
  .object({
    productId: idSchema,
    /** FIFO/FEFO batch the units are taken from. Resolved server-side when omitted. */
    batchId: idSchema.nullable().optional(),
    quantity: z.coerce.number().int().min(1, 'الكمية يجب أن تكون أكبر من صفر').max(1_000_000),
    unitPrice: moneySchema,
    discount: moneySchema.default('0.00'),
    /**
     * Echoed back by the client for its own rendering; the server always
     * recomputes and persists `unitPrice * quantity - discount`.
     */
    lineTotal: moneySchema.optional(),
  })
  .strict();
export type SaleItemInput = z.infer<typeof saleItemInputSchema>;

export const paymentInputSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amount: moneySchema,
    reference: optionalTrimmedString(80),
  })
  .strict();
export type PaymentInput = z.infer<typeof paymentInputSchema>;

/** POST /sales — completed checkout. Totals are recomputed server-side. */
export const saleCreateSchema = z
  .object({
    invoiceNumber: optionalTrimmedString(40),
    customerId: z.string().trim().min(1).max(64).nullable().optional(),
    warehouseId: optionalTrimmedString(64),
    subtotal: moneySchema,
    itemDiscount: moneySchema.default('0.00'),
    invoiceDiscount: moneySchema.default('0.00'),
    taxAmount: moneySchema,
    total: moneySchema,
    /** Loyalty points redeemed for discount (100 points = 1 currency unit). */
    pointsUsed: z.coerce.number().int().nonnegative().default(0),
    note: optionalTrimmedString(500),
    items: z.array(saleItemInputSchema).min(1, 'يجب إضافة صنف واحد على الأقل').max(500),
    payments: z.array(paymentInputSchema).min(1, 'يجب تحديد طريقة دفع واحدة على الأقل').max(10),
  })
  .strict();
export type SaleCreateInput = z.infer<typeof saleCreateSchema>;

/** POST /sales/suspend — same shape but payment may be deferred. */
export const saleSuspendSchema = saleCreateSchema.extend({
  payments: z.array(paymentInputSchema).max(10).default([]),
});
export type SaleSuspendInput = z.infer<typeof saleSuspendSchema>;

export const saleVoidSchema = z
  .object({
    reason: z.string().trim().min(3, 'سبب الإلغاء مطلوب').max(300),
  })
  .strict();
export type SaleVoidInput = z.infer<typeof saleVoidSchema>;

export const saleQuerySchema = paginationSchema.extend({
  status: z.enum(SALE_STATUSES).optional(),
  q: optionalTrimmedString(120),
  customerId: optionalTrimmedString(64),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type SaleQuery = z.infer<typeof saleQuerySchema>;

export const bestSellerQuerySchema = z.object({
  period: z.enum(SALE_PERIODS).default('week'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(8),
  categoryId: optionalTrimmedString(64),
});
export type BestSellerQuery = z.infer<typeof bestSellerQuerySchema>;

export const recentSalesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  period: z.enum(['today', 'week', 'month', '7d', '30d']).default('7d'),
});
export type RecentSalesQuery = z.infer<typeof recentSalesQuerySchema>;
