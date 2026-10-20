import { z } from 'zod';
import { optionalTrimmedString, paginationSchema } from './common.js';

export const createCategorySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/u, 'كود التصنيف غير صالح'),
    nameAr: z.string().trim().min(2, 'اسم التصنيف مطلوب').max(120),
    nameEn: optionalTrimmedString(120),
    parentId: optionalTrimmedString(64),
    isActive: z.boolean().default(true),
  })
  .strict();
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial().strict();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const categoryQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
});
export type CategoryQuery = z.infer<typeof categoryQuerySchema>;
