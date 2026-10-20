import { z } from 'zod';
import { optionalTrimmedString } from './common.js';

/**
 * A warehouse code is the stable human handle used on receipts and in the
 * warehouse picker. It is trimmed here and normalised to uppercase by the API.
 */
const warehouseCodeSchema = z
  .string()
  .trim()
  .min(2, 'كود المخزن قصير جدًا')
  .max(20, 'كود المخزن طويل جدًا')
  .regex(/^[A-Za-z0-9_-]+$/u, 'كود المخزن غير صالح');

export const createWarehouseSchema = z
  .object({
    code: warehouseCodeSchema,
    nameAr: z.string().trim().min(2, 'اسم المخزن مطلوب').max(120),
    nameEn: optionalTrimmedString(120),
    address: optionalTrimmedString(300),
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((value) => !value.isDefault || value.isActive, {
    message: 'لا يمكن تعيين مخزن غير نشط كوجهة استلام افتراضية',
    path: ['isDefault'],
  });
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

/**
 * PATCH field that can be cleared by sending `''` (stored as `null`).
 * `undefined` leaves the current value untouched.
 */
const clearableString = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => (value === '' ? null : value));

/**
 * PATCH body. `code` is deliberately absent: the code is immutable after the
 * warehouse has been created.
 */
export const updateWarehouseSchema = z
  .object({
    nameAr: z.string().trim().min(2, 'اسم المخزن مطلوب').max(120).optional(),
    nameEn: clearableString(120),
    address: clearableString(300),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !value.isDefault || value.isActive !== false, {
    message: 'لا يمكن تعيين مخزن غير نشط كوجهة استلام افتراضية',
    path: ['isDefault'],
  });
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;

const booleanFromString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(defaultValue);

/** Query accepted by `GET /warehouses` (still an array, for compatibility). */
export const warehouseQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  includeInactive: booleanFromString('false'),
  withStats: booleanFromString('false'),
});
export type WarehouseQuery = z.infer<typeof warehouseQuerySchema>;
