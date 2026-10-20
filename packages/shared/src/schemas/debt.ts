import { z } from 'zod';
import { optionalTrimmedString, paginationSchema } from './common.js';
import { moneySchema } from './product.js';

/** Methods a customer debt payment can be collected with (credit is not a payment). */
export const DEBT_PAYMENT_METHODS = ['cash', 'card', 'wallet'] as const;
export type DebtPaymentMethod = (typeof DEBT_PAYMENT_METHODS)[number];

/** POST /debts/:customerId/payments — one collection against the customer balance. */
export const debtPaymentSchema = z
  .object({
    amount: moneySchema.refine((value) => Number(value) > 0, 'المبلغ يجب أن يكون أكبر من صفر'),
    method: z.enum(DEBT_PAYMENT_METHODS),
    reference: optionalTrimmedString(120),
    note: optionalTrimmedString(300),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.method === 'card' || value.method === 'wallet') && !value.reference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reference'],
        message: 'مرجع الدفع مطلوب لهذه الوسيلة',
      });
    }
  });
export type DebtPaymentInput = z.infer<typeof debtPaymentSchema>;

/** GET /debts — paginated receivables list (POS-style search via `?q=`). */
export const debtQuerySchema = paginationSchema.extend({
  q: optionalTrimmedString(120),
});
export type DebtQuery = z.infer<typeof debtQuerySchema>;
