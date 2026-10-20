import { z } from 'zod';
import { optionalTrimmedString, paginationSchema } from './common.js';

/**
 * GET /purchases — goods-receipt (supplier purchase) history.
 * `q` matches the receipt reference or the supplier name.
 */
export const purchaseQuerySchema = paginationSchema.extend({
  q: optionalTrimmedString(120),
});
export type PurchaseQuery = z.infer<typeof purchaseQuerySchema>;
