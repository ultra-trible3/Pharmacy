import { z } from 'zod';
import { dateOnlySchema } from './common.js';

/**
 * Query for the dashboard sales report (`GET /reports/sales`).
 *
 * Both bounds are business dates (`YYYY-MM-DD`); the server interprets them in
 * the pharmacy's business timezone and rejects ranges longer than one year.
 * When a bound is omitted it defaults to "today" in the business timezone.
 */
export const salesReportQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
