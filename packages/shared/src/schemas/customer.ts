import { z } from 'zod';
import { optionalTrimmedString, paginationSchema } from './common.js';

/** Optional string that may hold a non-negative decimal with up to 2dp. Empty input becomes undefined. */
const optionalMoneyString = (max = 20) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .refine((v) => v === undefined || /^\d+(\.\d{1,2})?$/.test(v), 'مبلغ غير صحيح');

export const customerCreateSchema = z
  .object({
    name: z.string().trim().min(2, 'اسم العميل مطلوب').max(120),
    phone: optionalTrimmedString(30),
    notes: optionalTrimmedString(500),
    loyaltyPoints: z.number().int().nonnegative().default(0),
    creditLimit: optionalMoneyString(20).default('0.00'),
    currentBalance: optionalMoneyString(20).default('0.00'),
  })
  .strict();
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'اسم العميل مطلوب')
      .max(120)
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    phone: optionalTrimmedString(30),
    notes: optionalTrimmedString(500),
    loyaltyPoints: z.number().int().nonnegative().optional(),
    creditLimit: optionalMoneyString(20),
    currentBalance: optionalMoneyString(20),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'لا توجد بيانات للتحديث',
  });
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

export const customerQuerySchema = paginationSchema.extend({
  q: optionalTrimmedString(120),
});
export type CustomerQuery = z.infer<typeof customerQuerySchema>;
