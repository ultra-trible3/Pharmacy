import { z } from 'zod';
import { dateOnlySchema, optionalTrimmedString, paginationSchema } from './common.js';
import { moneySchema } from './product.js';

export const EXPENSE_CATEGORIES = ['RENT', 'SALARY', 'UTILITIES', 'MAINTENANCE', 'MARKETING', 'OTHER'] as const;
export type ExpenseCategoryCode = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS_AR: Record<ExpenseCategoryCode, string> = {
  RENT: 'إيجار',
  SALARY: 'رواتب',
  UTILITIES: 'فواتير services',
  MAINTENANCE: 'صيانة',
  MARKETING: 'تسويق',
  OTHER: 'أخرى',
};

export const EXPENSE_CATEGORY_LABELS_EN: Record<ExpenseCategoryCode, string> = {
  RENT: 'Rent',
  SALARY: 'Salaries',
  UTILITIES: 'Utilities',
  MAINTENANCE: 'Maintenance',
  MARKETING: 'Marketing',
  OTHER: 'Other',
};

export const createExpenseSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES),
    descriptionAr: z.string().trim().min(2, 'وصف المصروف بالعربية مطلوب').max(200),
    descriptionEn: optionalTrimmedString(200),
    amount: moneySchema,
    paidAt: dateOnlySchema,
    warehouseId: optionalTrimmedString(64),
    notes: optionalTrimmedString(500),
  })
  .strict();
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    descriptionAr: z.string().trim().min(2, 'وصف المصروف بالعربية مطلوب').max(200).optional(),
    descriptionEn: optionalTrimmedString(200),
    amount: moneySchema.optional(),
    paidAt: dateOnlySchema.optional(),
    warehouseId: optionalTrimmedString(64),
    notes: optionalTrimmedString(500),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const expenseQuerySchema = paginationSchema.extend({
  q: optionalTrimmedString(120),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
  includeInactive: z.enum(['true', 'false']).transform((v) => v === 'true').default('false'),
});
export type ExpenseQuery = z.infer<typeof expenseQuerySchema>;

export interface ExpenseDto {
  id: string;
  reference: string;
  category: ExpenseCategoryCode;
  categoryLabelAr: string;
  categoryLabelEn: string;
  descriptionAr: string;
  descriptionEn: string | null;
  amount: string;
  paidAt: string;
  paidBy: string;
  warehouseId: string | null;
  warehouseNameAr: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface ExpenseSummaryDto {
  totalAmount: string;
  totalCount: number;
  thisMonthAmount: string;
  thisMonthCount: number;
}
