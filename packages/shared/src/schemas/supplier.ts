import { z } from 'zod';
import { optionalTrimmedString, paginationSchema } from './common.js';

export const createSupplierSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/u, 'كود المورد غير صالح'),
    nameAr: z.string().trim().min(2, 'اسم المورد مطلوب').max(150),
    nameEn: optionalTrimmedString(150),
    phone: optionalTrimmedString(40),
    email: optionalTrimmedString(120),
    address: optionalTrimmedString(300),
    taxNumber: optionalTrimmedString(60),
    openingBalance: z
      .union([z.number(), z.string()])
      .transform((v) => Number(v).toFixed(2))
      .default('0.00'),
    isActive: z.boolean().default(true),
  })
  .strict();
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

/**
 * PATCH field that can be cleared by sending `''` (stored as `null`).
 * `undefined` leaves the current value untouched.
 */
const clearableString = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v));

/**
 * PATCH body. `code` and `openingBalance` are deliberately absent: the code is
 * immutable and the opening balance is ledger data fixed at creation time.
 */
export const updateSupplierSchema = z
  .object({
    nameAr: z.string().trim().min(2, 'اسم المورد مطلوب').max(150).optional(),
    nameEn: clearableString(150),
    phone: clearableString(40),
    email: clearableString(120),
    address: clearableString(300),
    taxNumber: clearableString(60),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const supplierQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
});
export type SupplierQuery = z.infer<typeof supplierQuerySchema>;
